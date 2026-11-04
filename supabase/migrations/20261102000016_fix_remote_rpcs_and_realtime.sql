-- =====================================================================
-- QUICKBITE MIGRATION 20261102000016: CONSOLIDATED REMOTE RPCS & REALTIME
-- Fixes Collect Cash, Order Status Transitions, Menu CRUD, and Multi-Device Realtime
-- =====================================================================

-- 1. Allow Public & Staff to View All Products (both available & sold-out)
DROP POLICY IF EXISTS "Public can view available products" ON public.products;
DROP POLICY IF EXISTS "Public can view all products" ON public.products;
CREATE POLICY "Public can view all products"
ON public.products FOR SELECT
TO anon, authenticated
USING (true);

-- 2. Cash Collection RPC (Permits Counter Staff / Cashier / Terminal to collect cash)
DROP FUNCTION IF EXISTS public.collect_cash_order(UUID);
DROP FUNCTION IF EXISTS public.update_order_status(UUID, VARCHAR, TEXT);
DROP FUNCTION IF EXISTS public.get_merchant_orders(UUID);
DROP FUNCTION IF EXISTS public.get_merchant_orders();

CREATE OR REPLACE FUNCTION public.collect_cash_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
BEGIN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found: %', p_order_id;
    END IF;

    UPDATE public.orders
    SET payment_status = 'PAID',
        status = CASE WHEN status = 'PLACED' THEN 'PREPARING' ELSE status END,
        updated_at = now()
    WHERE id = p_order_id
    RETURNING * INTO v_order;

    -- Record status transition in audit history if table exists
    BEGIN
        INSERT INTO public.order_status_history (
            order_id,
            previous_status,
            new_status,
            note
        )
        VALUES (
            p_order_id,
            'PLACED',
            v_order.status,
            'Cash collected at counter & dispatched to kitchen'
        );
    EXCEPTION WHEN OTHERS THEN
        -- Non-blocking history record
    END;

    RETURN jsonb_build_object(
        'id', v_order.id,
        'business_id', v_order.business_id,
        'branch_id', v_order.branch_id,
        'order_number', v_order.order_number,
        'secure_access_token', v_order.secure_access_token,
        'customer_name', v_order.customer_name,
        'customer_phone', v_order.customer_phone,
        'status', v_order.status,
        'payment_status', v_order.payment_status,
        'payment_method', v_order.payment_method,
        'subtotal_paisa', v_order.subtotal_paisa,
        'discount_paisa', v_order.discount_paisa,
        'tax_paisa', v_order.tax_paisa,
        'total_paisa', v_order.total_paisa,
        'notes', v_order.notes,
        'created_at', v_order.created_at,
        'updated_at', v_order.updated_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.collect_cash_order(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collect_cash_order(UUID) TO anon, authenticated, service_role;

-- 3. Update Order Status RPC (KDS & Staff transitions: PREPARING -> READY -> COMPLETED)
CREATE OR REPLACE FUNCTION public.update_order_status(
    p_order_id UUID,
    p_next_status VARCHAR,
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_prev_status VARCHAR(20);
BEGIN
    IF p_next_status NOT IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Invalid order status: %', p_next_status;
    END IF;

    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found: %', p_order_id;
    END IF;

    IF v_order.status IN ('COMPLETED', 'CANCELLED') AND p_next_status <> v_order.status THEN
        RAISE EXCEPTION 'Cannot change status of an already % order', v_order.status;
    END IF;

    v_prev_status := v_order.status;

    UPDATE public.orders
    SET status = p_next_status,
        updated_at = now()
    WHERE id = p_order_id
    RETURNING * INTO v_order;

    BEGIN
        INSERT INTO public.order_status_history (
            order_id,
            previous_status,
            new_status,
            note
        )
        VALUES (
            p_order_id,
            v_prev_status,
            p_next_status,
            COALESCE(p_note, 'Status updated via KDS/Staff operations')
        );
    EXCEPTION WHEN OTHERS THEN
        -- Non-blocking history record
    END;

    RETURN jsonb_build_object(
        'id', v_order.id,
        'business_id', v_order.business_id,
        'branch_id', v_order.branch_id,
        'order_number', v_order.order_number,
        'secure_access_token', v_order.secure_access_token,
        'customer_name', v_order.customer_name,
        'customer_phone', v_order.customer_phone,
        'status', v_order.status,
        'payment_status', v_order.payment_status,
        'payment_method', v_order.payment_method,
        'subtotal_paisa', v_order.subtotal_paisa,
        'discount_paisa', v_order.discount_paisa,
        'tax_paisa', v_order.tax_paisa,
        'total_paisa', v_order.total_paisa,
        'notes', v_order.notes,
        'created_at', v_order.created_at,
        'updated_at', v_order.updated_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.update_order_status(UUID, VARCHAR, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_order_status(UUID, VARCHAR, TEXT) TO anon, authenticated, service_role;

-- 4. Get Merchant Orders RPC (Securely loads live order feed with tokens & line items)
CREATE OR REPLACE FUNCTION public.get_merchant_orders(p_business_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', o.id,
            'business_id', o.business_id,
            'branch_id', o.branch_id,
            'order_number', o.order_number,
            'secure_access_token', o.secure_access_token,
            'customer_name', o.customer_name,
            'customer_phone', o.customer_phone,
            'status', o.status,
            'payment_status', o.payment_status,
            'payment_method', o.payment_method,
            'subtotal_paisa', o.subtotal_paisa,
            'discount_paisa', o.discount_paisa,
            'tax_paisa', o.tax_paisa,
            'total_paisa', o.total_paisa,
            'notes', o.notes,
            'created_at', o.created_at,
            'updated_at', o.updated_at,
            'pickup_tokens', (
                SELECT COALESCE(jsonb_agg(
                    jsonb_build_object(
                        'id', pt.id,
                        'order_id', pt.order_id,
                        'business_id', pt.business_id,
                        'branch_id', pt.branch_id,
                        'token_display', pt.token_display,
                        'sequence_num', pt.sequence_num,
                        'token_date', pt.token_date,
                        'created_at', pt.created_at
                    )
                ), '[]'::jsonb)
                FROM public.pickup_tokens pt
                WHERE pt.order_id = o.id
            ),
            'order_items', (
                SELECT COALESCE(jsonb_agg(
                    jsonb_build_object(
                        'id', oi.id,
                        'order_id', oi.order_id,
                        'product_id', oi.product_id,
                        'item_name_snapshot', oi.item_name_snapshot,
                        'variant_name_snapshot', oi.variant_name_snapshot,
                        'unit_price_paisa', oi.unit_price_paisa,
                        'quantity', oi.quantity,
                        'addons_snapshot', oi.addons_snapshot,
                        'line_total_paisa', oi.line_total_paisa
                    )
                ), '[]'::jsonb)
                FROM public.order_items oi
                WHERE oi.order_id = o.id
            )
        ) ORDER BY o.created_at DESC
    ), '[]'::jsonb) INTO v_result
    FROM public.orders o
    WHERE (p_business_id IS NULL OR o.business_id = p_business_id);

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_merchant_orders(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_merchant_orders(UUID) TO anon, authenticated, service_role;

-- 5. Admin Toggle Product Availability RPC
CREATE OR REPLACE FUNCTION public.admin_toggle_product_availability(
    p_product_id UUID,
    p_is_available BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_prod public.products%ROWTYPE;
BEGIN
    UPDATE public.products
    SET is_available = p_is_available,
        updated_at = now()
    WHERE id = p_product_id
    RETURNING * INTO v_prod;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found: %', p_product_id;
    END IF;

    RETURN jsonb_build_object(
        'id', v_prod.id,
        'business_id', v_prod.business_id,
        'name', v_prod.name,
        'is_available', v_prod.is_available,
        'updated_at', v_prod.updated_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_toggle_product_availability(UUID, BOOLEAN) TO anon, authenticated, service_role;

-- 6. Admin Update Product Price RPC
CREATE OR REPLACE FUNCTION public.admin_update_product_price(
    p_product_id UUID,
    p_base_price_paisa BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_prod public.products%ROWTYPE;
BEGIN
    IF p_base_price_paisa < 0 THEN
        RAISE EXCEPTION 'Base price cannot be negative';
    END IF;

    UPDATE public.products
    SET base_price_paisa = p_base_price_paisa,
        updated_at = now()
    WHERE id = p_product_id
    RETURNING * INTO v_prod;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found: %', p_product_id;
    END IF;

    RETURN jsonb_build_object(
        'id', v_prod.id,
        'business_id', v_prod.business_id,
        'name', v_prod.name,
        'base_price_paisa', v_prod.base_price_paisa,
        'updated_at', v_prod.updated_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_product_price(UUID, BIGINT) TO anon, authenticated, service_role;

-- 7. Admin Create Product RPC
CREATE OR REPLACE FUNCTION public.admin_create_product(
    p_business_id UUID,
    p_category_id UUID,
    p_name TEXT,
    p_description TEXT,
    p_base_price_paisa BIGINT,
    p_is_veg BOOLEAN,
    p_is_available BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_prod public.products%ROWTYPE;
    v_prod_id UUID := gen_random_uuid();
BEGIN
    IF p_name IS NULL OR length(trim(p_name)) < 1 THEN
        RAISE EXCEPTION 'Product name is required';
    END IF;

    IF p_base_price_paisa < 0 THEN
        RAISE EXCEPTION 'Base price cannot be negative';
    END IF;

    INSERT INTO public.products (
        id,
        business_id,
        category_id,
        name,
        description,
        base_price_paisa,
        is_veg,
        is_available,
        created_at,
        updated_at
    )
    VALUES (
        v_prod_id,
        p_business_id,
        p_category_id,
        trim(p_name),
        COALESCE(p_description, 'Freshly prepared item'),
        p_base_price_paisa,
        p_is_veg,
        p_is_available,
        now(),
        now()
    )
    RETURNING * INTO v_prod;

    RETURN jsonb_build_object(
        'id', v_prod.id,
        'business_id', v_prod.business_id,
        'category_id', v_prod.category_id,
        'name', v_prod.name,
        'description', v_prod.description,
        'base_price_paisa', v_prod.base_price_paisa,
        'is_veg', v_prod.is_veg,
        'is_available', v_prod.is_available,
        'created_at', v_prod.created_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_product(UUID, UUID, TEXT, TEXT, BIGINT, BOOLEAN, BOOLEAN) TO anon, authenticated, service_role;

-- 8. Admin Delete Product RPC
CREATE OR REPLACE FUNCTION public.admin_delete_product(
    p_product_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_prod_id UUID;
BEGIN
    DELETE FROM public.products
    WHERE id = p_product_id
    RETURNING id INTO v_prod_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found: %', p_product_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'deleted_product_id', v_prod_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_product(UUID) TO anon, authenticated, service_role;

-- 9. Admin Toggle Business Status RPC
CREATE OR REPLACE FUNCTION public.admin_toggle_business_status(
    p_business_id UUID,
    p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_biz public.businesses%ROWTYPE;
BEGIN
    UPDATE public.businesses
    SET is_active = p_is_active,
        updated_at = now()
    WHERE id = p_business_id
    RETURNING * INTO v_biz;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Business not found: %', p_business_id;
    END IF;

    RETURN jsonb_build_object(
        'id', v_biz.id,
        'name', v_biz.name,
        'is_active', v_biz.is_active,
        'updated_at', v_biz.updated_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_toggle_business_status(UUID, BOOLEAN) TO anon, authenticated, service_role;

-- 10. Admin Update Business Tier RPC
CREATE OR REPLACE FUNCTION public.admin_update_business_tier(
    p_business_id UUID,
    p_tier VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_biz public.businesses%ROWTYPE;
BEGIN
    IF p_tier NOT IN ('Starter', 'Growth', 'Pro') THEN
        RAISE EXCEPTION 'Invalid tier: %', p_tier;
    END IF;

    UPDATE public.businesses
    SET tier = p_tier,
        updated_at = now()
    WHERE id = p_business_id
    RETURNING * INTO v_biz;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Business not found: %', p_business_id;
    END IF;

    RETURN jsonb_build_object(
        'id', v_biz.id,
        'name', v_biz.name,
        'tier', v_biz.tier,
        'updated_at', v_biz.updated_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_business_tier(UUID, VARCHAR) TO anon, authenticated, service_role;

-- 11. Admin Create Business RPC
CREATE OR REPLACE FUNCTION public.admin_create_business(
    p_name TEXT,
    p_slug TEXT,
    p_phone TEXT,
    p_city TEXT,
    p_tier VARCHAR DEFAULT 'Starter'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_biz public.businesses%ROWTYPE;
    v_biz_id UUID := gen_random_uuid();
    v_branch_id UUID := gen_random_uuid();
BEGIN
    IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
        RAISE EXCEPTION 'Business name must be at least 2 characters';
    END IF;

    IF p_slug IS NULL OR length(trim(p_slug)) < 2 THEN
        RAISE EXCEPTION 'Business slug must be at least 2 characters';
    END IF;

    INSERT INTO public.businesses (
        id,
        name,
        slug,
        phone,
        address,
        city,
        tier,
        is_active,
        created_at,
        updated_at
    )
    VALUES (
        v_biz_id,
        trim(p_name),
        lower(trim(p_slug)),
        COALESCE(p_phone, '+91 9876543210'),
        'Central Counter',
        COALESCE(p_city, 'India'),
        COALESCE(p_tier, 'Starter'),
        true,
        now(),
        now()
    )
    RETURNING * INTO v_biz;

    INSERT INTO public.branches (
        id,
        business_id,
        name,
        code,
        address,
        phone,
        is_primary,
        is_active
    )
    VALUES (
        v_branch_id,
        v_biz_id,
        'Main Outlet',
        'MAIN',
        'Central Counter',
        COALESCE(p_phone, '+91 9876543210'),
        true,
        true
    );

    INSERT INTO public.business_settings (
        business_id,
        allow_cash,
        allow_online,
        auto_accept_orders,
        tax_gst_percentage,
        service_charge_percentage,
        order_prefix,
        estimated_prep_minutes
    )
    VALUES (
        v_biz_id,
        true,
        true,
        true,
        5.00,
        0.00,
        'A',
        10
    );

    RETURN jsonb_build_object(
        'id', v_biz.id,
        'name', v_biz.name,
        'slug', v_biz.slug,
        'tier', v_biz.tier,
        'city', v_biz.city,
        'is_active', v_biz.is_active,
        'created_at', v_biz.created_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_business(TEXT, TEXT, TEXT, TEXT, VARCHAR) TO anon, authenticated, service_role;

-- 12. Admin Delete Business RPC
CREATE OR REPLACE FUNCTION public.admin_delete_business(
    p_business_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_biz_id UUID;
BEGIN
    DELETE FROM public.businesses
    WHERE id = p_business_id
    RETURNING id INTO v_biz_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Business not found: %', p_business_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'deleted_business_id', v_biz_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_business(UUID) TO anon, authenticated, service_role;
