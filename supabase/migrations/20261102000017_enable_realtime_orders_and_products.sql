-- =====================================================================
-- QUICKBITE MIGRATION 20261102000017: FULL REALTIME & SECURE RPC ENHANCEMENT
-- Enables multi-device instant CDC updates for Orders, Items, Tokens & Products
-- =====================================================================

-- 1. Enable RLS SELECT for anon & authenticated on orders, items, and tokens
-- This is strictly required for Supabase Realtime (CDC postgres_changes) to broadcast to client devices
DROP POLICY IF EXISTS "Public can view orders" ON public.orders;
CREATE POLICY "Public can view orders"
ON public.orders FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Public can view order items" ON public.order_items;
CREATE POLICY "Public can view order items"
ON public.order_items FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Public can view pickup tokens" ON public.pickup_tokens;
CREATE POLICY "Public can view pickup tokens"
ON public.pickup_tokens FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Public can view all products" ON public.products;
CREATE POLICY "Public can view all products"
ON public.products FOR SELECT
TO anon, authenticated
USING (true);

-- 2. Configure Full Replica Identity for detailed row change broadcasts
ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER TABLE public.order_items REPLICA IDENTITY FULL;
ALTER TABLE public.pickup_tokens REPLICA IDENTITY FULL;
ALTER TABLE public.products REPLICA IDENTITY FULL;
ALTER TABLE public.categories REPLICA IDENTITY FULL;

-- 3. Enhance collect_cash_order to atomically include pickup_tokens and order_items
DROP FUNCTION IF EXISTS public.collect_cash_order(UUID);

CREATE OR REPLACE FUNCTION public.collect_cash_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_pickup_tokens JSONB;
    v_order_items JSONB;
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

    -- Fetch pickup tokens snapshot
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
    ), '[]'::jsonb) INTO v_pickup_tokens
    FROM public.pickup_tokens pt
    WHERE pt.order_id = v_order.id;

    -- Fetch order items snapshot
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
    ), '[]'::jsonb) INTO v_order_items
    FROM public.order_items oi
    WHERE oi.order_id = v_order.id;

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
        'updated_at', v_order.updated_at,
        'pickup_tokens', v_pickup_tokens,
        'order_items', v_order_items
    );
END;
$$;

REVOKE ALL ON FUNCTION public.collect_cash_order(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collect_cash_order(UUID) TO anon, authenticated, service_role;

-- 4. Enhance update_order_status to atomically include pickup_tokens and order_items
DROP FUNCTION IF EXISTS public.update_order_status(UUID, VARCHAR, TEXT);

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
    v_pickup_tokens JSONB;
    v_order_items JSONB;
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

    -- Fetch pickup tokens snapshot
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
    ), '[]'::jsonb) INTO v_pickup_tokens
    FROM public.pickup_tokens pt
    WHERE pt.order_id = v_order.id;

    -- Fetch order items snapshot
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
    ), '[]'::jsonb) INTO v_order_items
    FROM public.order_items oi
    WHERE oi.order_id = v_order.id;

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
        'updated_at', v_order.updated_at,
        'pickup_tokens', v_pickup_tokens,
        'order_items', v_order_items
    );
END;
$$;

REVOKE ALL ON FUNCTION public.update_order_status(UUID, VARCHAR, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_order_status(UUID, VARCHAR, TEXT) TO anon, authenticated, service_role;

-- 5. Enhance admin_create_product to handle fallback business & category UUIDs
DROP FUNCTION IF EXISTS public.admin_create_product(UUID, UUID, TEXT, TEXT, BIGINT, BOOLEAN, BOOLEAN);

CREATE OR REPLACE FUNCTION public.admin_create_product(
    p_business_id UUID DEFAULT NULL,
    p_category_id UUID DEFAULT NULL,
    p_name TEXT DEFAULT 'New Product',
    p_description TEXT DEFAULT 'Freshly prepared item',
    p_base_price_paisa BIGINT DEFAULT 2000,
    p_is_veg BOOLEAN DEFAULT true,
    p_is_available BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_business_id UUID;
    v_category_id UUID;
    v_prod_id UUID;
    v_prod public.products%ROWTYPE;
BEGIN
    IF trim(COALESCE(p_name, '')) = '' THEN
        RAISE EXCEPTION 'Product name cannot be empty';
    END IF;

    IF p_base_price_paisa < 0 THEN
        RAISE EXCEPTION 'Base price cannot be negative';
    END IF;

    -- Auto-resolve business ID if omitted
    IF p_business_id IS NOT NULL THEN
        v_business_id := p_business_id;
    ELSE
        SELECT id INTO v_business_id FROM public.businesses WHERE is_active = true ORDER BY created_at LIMIT 1;
        IF v_business_id IS NULL THEN
            RAISE EXCEPTION 'No active business found for product creation';
        END IF;
    END IF;

    -- Auto-resolve category ID if omitted
    IF p_category_id IS NOT NULL THEN
        v_category_id := p_category_id;
    ELSE
        SELECT id INTO v_category_id FROM public.categories WHERE business_id = v_business_id AND is_active = true ORDER BY display_order LIMIT 1;
        IF v_category_id IS NULL THEN
            SELECT id INTO v_category_id FROM public.categories ORDER BY display_order LIMIT 1;
        END IF;
    END IF;

    v_prod_id := gen_random_uuid();

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
        v_business_id,
        v_category_id,
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

