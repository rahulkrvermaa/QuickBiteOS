-- =====================================================================
-- QUICKBITE OS: PHASE 3.4 FINAL SECURITY AUDIT REMEDIATION
-- Migration: 20261102000008_final_order_security_fixes.sql
--
-- Fixes:
-- 1. Collision-resistant order number generator using PostgreSQL sequence
-- 2. Deadlock elimination: locks all distinct products in deterministic ascending ID order
-- 3. Duplicate product lines aggregate required quantities to prevent inventory bypass
-- 4. Duplicate add-on IDs aggregate quantities to prevent max_quantity bypass
-- 5. Strict cart validation: bounded 1-50 lines, quantity 1-100, malformed ID rejection
-- 6. Non-negative stock constraint: CHECK (stock_quantity >= 0)
-- 7. Hardened search_path = public, extensions on collect_cash_order and helper functions
-- 8. Direct INSERT revoked on orders and order_items from PUBLIC, anon, authenticated
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Collision-Resistant Sequence for Human-Readable Order Numbers
-- Starts at 1001, guarantees atomic, collision-free, non-blocking sequence generation
CREATE SEQUENCE IF NOT EXISTS public.order_number_seq
    START WITH 1001
    INCREMENT BY 1
    NO CYCLE;

-- 2. Non-Negative Inventory Constraint on products
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_stock_quantity_nonnegative'
    ) THEN
        ALTER TABLE public.products
        ADD CONSTRAINT chk_products_stock_quantity_nonnegative CHECK (stock_quantity >= 0);
    END IF;
END $$;

-- 3. Revoke Direct Client INSERT on orders and order_items
REVOKE INSERT ON public.orders FROM PUBLIC, anon, authenticated;
REVOKE INSERT ON public.order_items FROM PUBLIC, anon, authenticated;

-- 4. Harden SECURITY DEFINER Helper Functions with Explicit search_path
CREATE OR REPLACE FUNCTION public.get_auth_business_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT business_id 
  FROM public.business_members 
  WHERE user_id = auth.uid() AND status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS VARCHAR
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role 
  FROM public.business_members 
  WHERE user_id = auth.uid() AND status = 'active'
  LIMIT 1;
$$;

-- 5. Harden Server-Side Cash Collection with Explicit search_path
CREATE OR REPLACE FUNCTION public.collect_cash_order(p_order_id UUID)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_order public.orders;
    v_staff_biz_id UUID;
    v_staff_role VARCHAR;
BEGIN
    v_staff_biz_id := public.get_auth_business_id();
    v_staff_role := public.get_auth_role();

    IF v_staff_role NOT IN ('owner', 'manager', 'cashier') THEN
        RAISE EXCEPTION 'Unauthorized: Only authorized cashier, manager, or owner can collect cash.';
    END IF;

    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found.';
    END IF;

    IF v_order.business_id <> v_staff_biz_id THEN
        RAISE EXCEPTION 'Forbidden: Order belongs to a different tenant.';
    END IF;

    IF v_order.payment_method <> 'CASH_COUNTER' THEN
        RAISE EXCEPTION 'Invalid operation: Order is not marked for cash counter payment.';
    END IF;

    IF v_order.payment_status = 'PAID' THEN
        RAISE EXCEPTION 'Order is already marked as paid.';
    END IF;

    UPDATE public.orders
    SET payment_status = 'PAID',
        status = CASE WHEN status = 'PLACED' THEN 'PREPARING' ELSE status END,
        updated_at = now()
    WHERE id = p_order_id
    RETURNING * INTO v_order;

    INSERT INTO public.order_status_history (
        order_id, previous_status, new_status, changed_by_user_id, note
    )
    VALUES (
        p_order_id, 'PLACED', v_order.status, auth.uid(), 'Cash collected at counter by staff'
    );

    RETURN v_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.collect_cash_order(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.collect_cash_order(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.collect_cash_order(UUID) TO authenticated, service_role;

-- 6. Server-Authoritative Order Placement Function (Phase 3.4 Hardened)
CREATE OR REPLACE FUNCTION public.place_customer_order(
    p_business_id UUID,
    p_branch_id UUID,
    p_customer_name TEXT,
    p_customer_phone TEXT,
    p_payment_method VARCHAR,
    p_items JSONB,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_business public.businesses%ROWTYPE;
    v_branch public.branches%ROWTYPE;
    v_settings public.business_settings%ROWTYPE;
    v_clean_phone TEXT;
    
    v_order_id UUID := gen_random_uuid();
    v_secure_token VARCHAR(64);
    v_order_num VARCHAR(30);
    v_date_prefix VARCHAR(10);
    v_seq_num BIGINT;
    v_is_cash BOOLEAN;
    v_initial_status VARCHAR(20);
    
    v_subtotal_paisa BIGINT := 0;
    v_gst_pct NUMERIC(4,2) := 5.00;
    v_tax_paisa BIGINT := 0;
    v_total_paisa BIGINT := 0;
    
    v_item_elem JSONB;
    v_item_product_id UUID;
    v_item_variant_id UUID;
    v_item_qty INTEGER;
    v_item_addons JSONB;
    
    v_distinct_req_count INTEGER;
    v_locked_prod_count INTEGER;
    v_stock_req RECORD;
    
    v_product public.products%ROWTYPE;
    v_variant public.product_variants%ROWTYPE;
    v_addon public.product_addons%ROWTYPE;
    
    v_addon_agg RECORD;
    v_addons_total_paisa BIGINT;
    v_addons_snapshot JSONB;
    
    v_base_unit_price BIGINT;
    v_variant_name_snapshot TEXT;
    v_line_unit_price BIGINT;
    v_line_total BIGINT;
    
    v_token_record RECORD;
    v_token_json JSONB := NULL;
    v_order_items_json JSONB := '[]'::jsonb;
    v_item_id UUID;
BEGIN
    -- 1. Validate Business (Must exist and be active)
    SELECT * INTO v_business
    FROM public.businesses
    WHERE id = p_business_id AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Business not found or inactive';
    END IF;

    -- 2. Validate Branch (Must belong to business and be active)
    SELECT * INTO v_branch
    FROM public.branches
    WHERE id = p_branch_id AND business_id = p_business_id AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Branch not found or inactive for this business';
    END IF;

    -- 3. Validate Customer Details
    IF p_customer_name IS NULL OR length(trim(p_customer_name)) < 2 THEN
        RAISE EXCEPTION 'Customer name must be at least 2 characters';
    END IF;

    v_clean_phone := regexp_replace(COALESCE(p_customer_phone, ''), '^\+91|\s+', '', 'g');
    IF NOT (v_clean_phone ~ '^[6-9]\d{9}$') THEN
        RAISE EXCEPTION 'Enter a valid 10-digit Indian mobile number';
    END IF;

    -- 4. Validate Payment Method
    IF p_payment_method NOT IN ('ONLINE_UPI', 'ONLINE_CARD', 'CASH_COUNTER') THEN
        RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
    END IF;

    -- 5. Validate Business Settings & Permissions
    SELECT * INTO v_settings
    FROM public.business_settings
    WHERE business_id = p_business_id;

    IF FOUND THEN
        IF p_payment_method = 'CASH_COUNTER' AND NOT v_settings.allow_cash THEN
            RAISE EXCEPTION 'Cash on pickup is currently disabled for this shop';
        END IF;

        IF p_payment_method IN ('ONLINE_UPI', 'ONLINE_CARD') AND NOT v_settings.allow_online THEN
            RAISE EXCEPTION 'Online payment is currently disabled for this shop';
        END IF;

        IF v_settings.tax_gst_percentage IS NOT NULL THEN
            v_gst_pct := v_settings.tax_gst_percentage;
        END IF;
    END IF;

    -- 6. Validate Items Array Bounds (1 to 50 lines)
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Order must contain at least one item';
    END IF;

    IF jsonb_array_length(p_items) > 50 THEN
        RAISE EXCEPTION 'Order exceeds maximum limit of 50 items';
    END IF;

    -- 7. Pre-validate Item JSON & Quantities
    FOR v_item_elem IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        IF (v_item_elem->>'product_id') IS NULL OR trim(v_item_elem->>'product_id') = '' THEN
            RAISE EXCEPTION 'Every item must specify a valid product_id';
        END IF;

        v_item_qty := COALESCE((v_item_elem->>'quantity')::INTEGER, 1);
        IF v_item_qty < 1 OR v_item_qty > 100 THEN
            RAISE EXCEPTION 'Invalid item quantity: % (must be between 1 and 100)', v_item_qty;
        END IF;
    END LOOP;

    -- 8. Deterministic Row Locking: Lock all distinct product rows in ASCENDING ID order.
    -- This guarantees zero circular wait deadlocks across concurrent checkouts.
    PERFORM 1
    FROM public.products p
    WHERE p.id IN (
        SELECT DISTINCT (item->>'product_id')::UUID
        FROM jsonb_array_elements(p_items) AS item
    )
    AND p.business_id = p_business_id
    ORDER BY p.id ASC
    FOR UPDATE;

    -- Verify all requested product IDs exist and belong to this business
    SELECT COUNT(DISTINCT (item->>'product_id')::UUID)
    INTO v_distinct_req_count
    FROM jsonb_array_elements(p_items) AS item;

    SELECT COUNT(*)
    INTO v_locked_prod_count
    FROM public.products p
    WHERE p.id IN (
        SELECT DISTINCT (item->>'product_id')::UUID
        FROM jsonb_array_elements(p_items) AS item
    )
    AND p.business_id = p_business_id;

    IF v_locked_prod_count <> v_distinct_req_count THEN
        RAISE EXCEPTION 'One or more products do not belong to business or do not exist';
    END IF;

    -- 9. Inventory Stock Enforcement with Aggregated Line Quantities
    -- Prevents multiple cart lines for the same product from bypassing stock checks.
    FOR v_stock_req IN
        SELECT 
            (item->>'product_id')::UUID AS prod_id,
            SUM(COALESCE((item->>'quantity')::INTEGER, 1)) AS total_qty
        FROM jsonb_array_elements(p_items) AS item
        GROUP BY (item->>'product_id')::UUID
        ORDER BY (item->>'product_id')::UUID ASC
    LOOP
        SELECT * INTO v_product
        FROM public.products
        WHERE id = v_stock_req.prod_id;

        IF NOT v_product.is_available THEN
            RAISE EXCEPTION 'Product "%" is currently unavailable', v_product.name;
        END IF;

        IF v_product.track_inventory THEN
            IF v_product.stock_quantity < v_stock_req.total_qty THEN
                RAISE EXCEPTION 'Insufficient stock for product "%" (available: %, requested: %)',
                    v_product.name, v_product.stock_quantity, v_stock_req.total_qty;
            END IF;

            UPDATE public.products
            SET stock_quantity = stock_quantity - v_stock_req.total_qty,
                updated_at = now()
            WHERE id = v_product.id;
        END IF;
    END LOOP;

    -- 10. Process Line Items: Authoritative Pricing & Add-on Aggregation
    FOR v_item_elem IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_product_id := (v_item_elem->>'product_id')::UUID;
        v_item_variant_id := NULLIF(v_item_elem->>'variant_id', '')::UUID;
        v_item_qty := COALESCE((v_item_elem->>'quantity')::INTEGER, 1);
        v_item_addons := COALESCE(v_item_elem->'addons', '[]'::jsonb);

        SELECT * INTO v_product
        FROM public.products
        WHERE id = v_item_product_id;

        -- Variant validation & pricing
        IF v_item_variant_id IS NOT NULL THEN
            SELECT * INTO v_variant
            FROM public.product_variants
            WHERE id = v_item_variant_id AND product_id = v_product.id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Selected variant does not belong to product "%"', v_product.name;
            END IF;

            v_base_unit_price := v_variant.price_override_paisa;
            v_variant_name_snapshot := v_variant.name;
        ELSE
            v_base_unit_price := v_product.base_price_paisa;
            v_variant_name_snapshot := NULL;
        END IF;

        -- Add-on validation, aggregation & pricing
        v_addons_total_paisa := 0;
        v_addons_snapshot := '[]'::jsonb;

        IF jsonb_array_length(v_item_addons) > 0 THEN
            FOR v_addon_agg IN
                SELECT
                    (a->>'addon_id')::UUID AS addon_id,
                    SUM(COALESCE((a->>'quantity')::INTEGER, 1)) AS total_addon_qty
                FROM jsonb_array_elements(v_item_addons) AS a
                WHERE (a->>'addon_id') IS NOT NULL AND trim(a->>'addon_id') <> ''
                GROUP BY (a->>'addon_id')::UUID
            LOOP
                IF v_addon_agg.total_addon_qty <= 0 THEN
                    RAISE EXCEPTION 'Invalid addon quantity';
                END IF;

                SELECT * INTO v_addon
                FROM public.product_addons
                WHERE id = v_addon_agg.addon_id AND product_id = v_product.id;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'Addon does not belong to product "%"', v_product.name;
                END IF;

                IF v_addon_agg.total_addon_qty > v_addon.max_quantity THEN
                    RAISE EXCEPTION 'Addon "%" exceeds maximum allowed quantity of %', v_addon.name, v_addon.max_quantity;
                END IF;

                v_addons_total_paisa := v_addons_total_paisa + (v_addon.price_paisa * v_addon_agg.total_addon_qty);

                v_addons_snapshot := v_addons_snapshot || jsonb_build_object(
                    'addonId', v_addon.id,
                    'name', v_addon.name,
                    'pricePaisa', v_addon.price_paisa,
                    'quantity', v_addon_agg.total_addon_qty
                );
            END LOOP;
        END IF;

        -- Calculate line unit price and total in integer paisa
        v_line_unit_price := v_base_unit_price + v_addons_total_paisa;
        v_line_total := v_line_unit_price * v_item_qty;
        v_subtotal_paisa := v_subtotal_paisa + v_line_total;

        -- Store for deferred atomic insert into order_items
        v_item_id := gen_random_uuid();
        v_order_items_json := v_order_items_json || jsonb_build_object(
            'id', v_item_id,
            'productId', v_product.id,
            'itemNameSnapshot', v_product.name,
            'variantNameSnapshot', v_variant_name_snapshot,
            'unitPricePaisa', v_line_unit_price,
            'quantity', v_item_qty,
            'addonsSnapshot', v_addons_snapshot,
            'lineTotalPaisa', v_line_total
        );
    END LOOP;

    -- 11. Calculate Taxes and Grand Total
    v_tax_paisa := ROUND((v_subtotal_paisa * v_gst_pct) / 100.0);
    v_total_paisa := v_subtotal_paisa + v_tax_paisa;

    -- 12. Generate Cryptographic 64-character Token & Collision-Free Order Number via Sequence
    v_secure_token := 'sec_tok_' || encode(gen_random_bytes(28), 'hex');
    v_date_prefix := to_char(timezone('Asia/Kolkata', now()), 'YYMM');
    v_seq_num := nextval('public.order_number_seq');
    v_order_num := 'QB-' || v_date_prefix || '-' || LPAD(v_seq_num::text, GREATEST(4, LENGTH(v_seq_num::text)), '0');

    v_is_cash := (p_payment_method = 'CASH_COUNTER');
    v_initial_status := CASE WHEN v_is_cash THEN 'PLACED' ELSE 'PENDING_PAYMENT' END;

    -- 13. Atomic Insert into orders
    INSERT INTO public.orders (
        id,
        business_id,
        branch_id,
        order_number,
        secure_access_token,
        customer_name,
        customer_phone,
        status,
        payment_status,
        payment_method,
        subtotal_paisa,
        discount_paisa,
        tax_paisa,
        total_paisa,
        notes,
        created_at,
        updated_at
    )
    VALUES (
        v_order_id,
        p_business_id,
        p_branch_id,
        v_order_num,
        v_secure_token,
        trim(p_customer_name),
        '+91 ' || v_clean_phone,
        v_initial_status,
        'UNPAID',
        p_payment_method,
        v_subtotal_paisa,
        0,
        v_tax_paisa,
        v_total_paisa,
        p_notes,
        now(),
        now()
    );

    -- 14. Atomic Insert into order_items
    FOR v_item_elem IN SELECT * FROM jsonb_array_elements(v_order_items_json)
    LOOP
        INSERT INTO public.order_items (
            id,
            order_id,
            product_id,
            item_name_snapshot,
            variant_name_snapshot,
            unit_price_paisa,
            quantity,
            addons_snapshot,
            line_total_paisa,
            created_at
        )
        VALUES (
            (v_item_elem->>'id')::UUID,
            v_order_id,
            (v_item_elem->>'productId')::UUID,
            v_item_elem->>'itemNameSnapshot',
            v_item_elem->>'variantNameSnapshot',
            (v_item_elem->>'unitPricePaisa')::BIGINT,
            (v_item_elem->>'quantity')::INTEGER,
            v_item_elem->'addonsSnapshot',
            (v_item_elem->>'lineTotalPaisa')::BIGINT,
            now()
        );
    END LOOP;

    -- 15. Token Allocation: Immediate for Cash Orders; Awaiting Verified Payment for Online
    IF v_is_cash THEN
        SELECT * INTO v_token_record
        FROM public.allocate_pickup_token(
            v_order_id,
            p_business_id,
            p_branch_id,
            COALESCE(v_settings.order_prefix, 'A')
        );

        v_token_json := jsonb_build_object(
            'tokenDisplay', v_token_record.token_display,
            'sequenceNum', v_token_record.sequence_num,
            'tokenDate', v_token_record.token_date
        );
    END IF;

    -- 16. Return Authoritative Order Summary
    RETURN jsonb_build_object(
        'id', v_order_id,
        'businessId', p_business_id,
        'branchId', p_branch_id,
        'orderNumber', v_order_num,
        'secureAccessToken', v_secure_token,
        'customerName', trim(p_customer_name),
        'customerPhone', '+91 ' || v_clean_phone,
        'status', v_initial_status,
        'paymentStatus', 'UNPAID',
        'paymentMethod', p_payment_method,
        'subtotalPaisa', v_subtotal_paisa,
        'discountPaisa', 0,
        'taxPaisa', v_tax_paisa,
        'totalPaisa', v_total_paisa,
        'notes', p_notes,
        'pickupToken', v_token_json,
        'items', v_order_items_json,
        'createdAt', now()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_customer_order(
    UUID, UUID, TEXT, TEXT, VARCHAR, JSONB, TEXT
) TO anon, authenticated, service_role;

