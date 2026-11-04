-- =====================================================================
-- QUICKBITE OS: PHASE 3.3 SECURE SERVER-SIDE ORDER CREATION
-- Migration: 20261102000007_secure_order_creation.sql
--
-- Security Guarantees:
-- 1. Eliminates direct client INSERT on orders and order_items
-- 2. Eliminates client-side price tampering (prices, GST, and totals calculated in PostgreSQL)
-- 3. Locks stock rows with FOR UPDATE to prevent inventory overselling
-- 4. Validates tenant isolation (products, variants, addons belong to active business/branch)
-- 5. Generates 64-character cryptographically secure access tokens
-- 6. Enforces initial order state (UNPAID, PENDING_PAYMENT or PLACED)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Ensure stock_quantity column exists for atomic inventory tracking
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_quantity INTEGER NOT NULL DEFAULT 100;

-- 2. Revoke direct client INSERT on orders and order_items
DROP POLICY IF EXISTS "Public can insert initial pending or cash orders" ON public.orders;
DROP POLICY IF EXISTS "Public can insert order items for pending or cash orders" ON public.order_items;
DROP POLICY IF EXISTS "Public can insert order items" ON public.order_items;

REVOKE INSERT ON public.orders FROM PUBLIC, anon, authenticated;
REVOKE INSERT ON public.order_items FROM PUBLIC, anon, authenticated;

-- Allow only staff of that business or service_role to insert orders (e.g. pos counter orders)
DROP POLICY IF EXISTS "Staff can insert business orders" ON public.orders;
CREATE POLICY "Staff can insert business orders"
ON public.orders FOR INSERT
WITH CHECK (
    business_id = public.get_auth_business_id()
    AND public.get_auth_role() IN ('owner', 'manager', 'cashier')
);

DROP POLICY IF EXISTS "Staff can insert business order items" ON public.order_items;
CREATE POLICY "Staff can insert business order items"
ON public.order_items FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = order_items.order_id
        AND o.business_id = public.get_auth_business_id()
        AND public.get_auth_role() IN ('owner', 'manager', 'cashier')
    )
);

-- =====================================================================
-- 3. SERVER-AUTHORITATIVE ORDER CREATION FUNCTION
-- =====================================================================

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
    
    v_product public.products%ROWTYPE;
    v_variant public.product_variants%ROWTYPE;
    v_addon public.product_addons%ROWTYPE;
    
    v_addon_elem JSONB;
    v_addon_id UUID;
    v_addon_qty INTEGER;
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

    -- 5. Validate Business Settings & Ordering Permissions
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

    -- 6. Validate Items Array
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Order must contain at least one item';
    END IF;

    -- 7. Process Each Order Item (Authoritative Price Calculation & Concurrency-Safe Stock Lock)
    FOR v_item_elem IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_product_id := (v_item_elem->>'product_id')::UUID;
        v_item_variant_id := NULLIF(v_item_elem->>'variant_id', '')::UUID;
        v_item_qty := COALESCE((v_item_elem->>'quantity')::INTEGER, 1);
        v_item_addons := COALESCE(v_item_elem->'addons', '[]'::jsonb);

        IF v_item_qty <= 0 OR v_item_qty > 100 THEN
            RAISE EXCEPTION 'Invalid item quantity: %', v_item_qty;
        END IF;

        -- Concurrency lock on product row (ensures accurate stock check and prevents race conditions)
        SELECT * INTO v_product
        FROM public.products
        WHERE id = v_item_product_id AND business_id = p_business_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % does not belong to business or does not exist', v_item_product_id;
        END IF;

        IF NOT v_product.is_available THEN
            RAISE EXCEPTION 'Product "%" is currently unavailable', v_product.name;
        END IF;

        -- Stock enforcement
        IF v_product.track_inventory THEN
            IF v_product.stock_quantity < v_item_qty THEN
                RAISE EXCEPTION 'Insufficient stock for product "%" (available: %, requested: %)',
                    v_product.name, v_product.stock_quantity, v_item_qty;
            END IF;

            UPDATE public.products
            SET stock_quantity = stock_quantity - v_item_qty,
                updated_at = now()
            WHERE id = v_product.id;
        END IF;

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

        -- Add-on validation & pricing
        v_addons_total_paisa := 0;
        v_addons_snapshot := '[]'::jsonb;

        IF jsonb_array_length(v_item_addons) > 0 THEN
            FOR v_addon_elem IN SELECT * FROM jsonb_array_elements(v_item_addons)
            LOOP
                v_addon_id := (v_addon_elem->>'addon_id')::UUID;
                v_addon_qty := COALESCE((v_addon_elem->>'quantity')::INTEGER, 1);

                IF v_addon_qty <= 0 THEN
                    RAISE EXCEPTION 'Invalid addon quantity';
                END IF;

                SELECT * INTO v_addon
                FROM public.product_addons
                WHERE id = v_addon_id AND product_id = v_product.id;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'Addon does not belong to product "%"', v_product.name;
                END IF;

                IF v_addon_qty > v_addon.max_quantity THEN
                    RAISE EXCEPTION 'Addon "%" exceeds maximum allowed quantity of %', v_addon.name, v_addon.max_quantity;
                END IF;

                v_addons_total_paisa := v_addons_total_paisa + (v_addon.price_paisa * v_addon_qty);

                v_addons_snapshot := v_addons_snapshot || jsonb_build_object(
                    'addonId', v_addon.id,
                    'name', v_addon.name,
                    'pricePaisa', v_addon.price_paisa,
                    'quantity', v_addon_qty
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

    -- 8. Calculate Taxes and Grand Total
    v_tax_paisa := ROUND((v_subtotal_paisa * v_gst_pct) / 100.0);
    v_total_paisa := v_subtotal_paisa + v_tax_paisa;

    -- 9. Generate Cryptographic 64-character Token & Human-readable Order Number
    v_secure_token := 'sec_tok_' || encode(gen_random_bytes(28), 'hex');
    v_date_prefix := to_char(timezone('Asia/Kolkata', now()), 'YYMM');
    v_order_num := 'QB-' || v_date_prefix || '-' || LPAD(floor(1000 + random() * 9000)::text, 4, '0');

    v_is_cash := (p_payment_method = 'CASH_COUNTER');
    v_initial_status := CASE WHEN v_is_cash THEN 'PLACED' ELSE 'PENDING_PAYMENT' END;

    -- 10. Atomic Insert into orders
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

    -- 11. Atomic Insert into order_items
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

    -- 12. Token Allocation: Immediate for Cash Orders; Awaiting Verified Payment for Online
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

    -- 13. Return Authoritative Order Summary
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
