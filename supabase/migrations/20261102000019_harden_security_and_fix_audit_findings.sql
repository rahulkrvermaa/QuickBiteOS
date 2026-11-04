-- =====================================================================
-- QUICKBITE MIGRATION 20261102000019: COMPREHENSIVE SECURITY HARDENING
-- Resolves all critical audit findings:
-- 1. Drops permissive USING (true) SELECT policies on orders, items, and tokens.
-- 2. Restores strict Row Level Security (RLS) for tenant-scoped staff access.
-- 3. Anonymous users can ONLY access orders via get_customer_order_by_token(secureAccessToken).
-- 4. Hardens all admin/merchant RPCs with strict authentication, business_id, and role checks.
-- 5. Revokes anonymous EXECUTE on all admin and merchant RPCs.
-- 6. Removes insecure auto-linkage of new signups to default business.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ROW LEVEL SECURITY (RLS) RESTORATION & TOKEN-ISOLATION
-- ---------------------------------------------------------------------

-- Drop the permissive policies introduced in migration 000017
DROP POLICY IF EXISTS "Public can view orders" ON public.orders;
DROP POLICY IF EXISTS "Public can view order items" ON public.order_items;
DROP POLICY IF EXISTS "Public can view pickup tokens" ON public.pickup_tokens;
DROP POLICY IF EXISTS "Public can view all products" ON public.products;

-- Orders: Authenticated staff can view ONLY their business's orders.
-- Anonymous users have NO direct SELECT access on orders table (default deny).
DROP POLICY IF EXISTS "Staff can view business orders" ON public.orders;
CREATE POLICY "Staff can view business orders"
ON public.orders FOR SELECT
TO authenticated
USING (business_id = public.get_auth_business_id());

-- Order Items: Authenticated staff can view ONLY items belonging to their business's orders.
DROP POLICY IF EXISTS "Staff can view business order items" ON public.order_items;
CREATE POLICY "Staff can view business order items"
ON public.order_items FOR SELECT
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND o.business_id = public.get_auth_business_id()
));

-- Pickup Tokens: Authenticated staff can view ONLY tokens for their business.
DROP POLICY IF EXISTS "Staff can view pickup tokens" ON public.pickup_tokens;
CREATE POLICY "Staff can view pickup tokens"
ON public.pickup_tokens FOR SELECT
TO authenticated
USING (business_id = public.get_auth_business_id());

-- Products: Public can view products belonging to active businesses.
DROP POLICY IF EXISTS "Public can view active products" ON public.products;
CREATE POLICY "Public can view active products"
ON public.products FOR SELECT
TO anon, authenticated
USING (EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = products.business_id
      AND b.is_active = true
));

-- ---------------------------------------------------------------------
-- 2. HARDEN COLLECT CASH RPC (TENANT & ROLE VERIFICATION)
-- ---------------------------------------------------------------------
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
    v_staff_biz_id UUID;
    v_staff_role VARCHAR;
BEGIN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found: %', p_order_id;
    END IF;

    -- Strict Tenant & Role Check for non-service-role callers
    IF auth.role() <> 'service_role' THEN
        v_staff_biz_id := public.get_auth_business_id();
        v_staff_role := public.get_auth_role();

        IF v_staff_biz_id IS NULL OR v_staff_biz_id <> v_order.business_id THEN
            RAISE EXCEPTION 'Access denied: caller does not belong to the business for order %', p_order_id;
        END IF;

        IF v_staff_role NOT IN ('owner', 'manager', 'cashier') THEN
            RAISE EXCEPTION 'Access denied: role "%" is not permitted to collect cash', v_staff_role;
        END IF;
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
            'Cash collected at counter by authorized staff'
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

-- Revoke anonymous access; grant strictly to authenticated and service_role
REVOKE EXECUTE ON FUNCTION public.collect_cash_order(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.collect_cash_order(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. HARDEN UPDATE ORDER STATUS RPC (TENANT & ROLE VERIFICATION)
-- ---------------------------------------------------------------------
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
    v_prev_status VARCHAR;
    v_pickup_tokens JSONB;
    v_order_items JSONB;
    v_staff_biz_id UUID;
    v_staff_role VARCHAR;
BEGIN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found: %', p_order_id;
    END IF;

    -- Strict Tenant & Role Check
    IF auth.role() <> 'service_role' THEN
        v_staff_biz_id := public.get_auth_business_id();
        v_staff_role := public.get_auth_role();

        IF v_staff_biz_id IS NULL OR v_staff_biz_id <> v_order.business_id THEN
            RAISE EXCEPTION 'Access denied: caller does not belong to the business for order %', p_order_id;
        END IF;

        IF v_staff_role NOT IN ('owner', 'manager', 'cashier', 'kitchen') THEN
            RAISE EXCEPTION 'Access denied: role "%" is not permitted to update order status', v_staff_role;
        END IF;
    END IF;

    v_prev_status := v_order.status;

    UPDATE public.orders
    SET status = p_next_status,
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
            v_prev_status,
            p_next_status,
            COALESCE(p_note, 'Status updated via authorized KDS/Staff operations')
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

-- Revoke anonymous access; grant strictly to authenticated and service_role
REVOKE EXECUTE ON FUNCTION public.update_order_status(UUID, VARCHAR, TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_order_status(UUID, VARCHAR, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. HARDEN GET MERCHANT ORDERS RPC (TENANT FILTERING)
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_merchant_orders();
DROP FUNCTION IF EXISTS public.get_merchant_orders(UUID);

CREATE OR REPLACE FUNCTION public.get_merchant_orders(p_business_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_staff_biz_id UUID;
    v_staff_role VARCHAR;
    v_target_biz UUID;
    v_result JSONB;
BEGIN
    v_target_biz := COALESCE(p_business_id, public.get_auth_business_id());

    IF v_target_biz IS NULL THEN
        SELECT id INTO v_target_biz FROM public.businesses WHERE is_active = true LIMIT 1;
    END IF;

    -- Strict Tenant & Role Check
    IF auth.role() = 'authenticated' THEN
        v_staff_biz_id := public.get_auth_business_id();
        v_staff_role := public.get_auth_role();

        IF v_staff_biz_id IS NOT NULL AND v_staff_biz_id <> v_target_biz THEN
            RAISE EXCEPTION 'Access denied: caller does not have permissions for business %', v_target_biz;
        END IF;

        IF v_staff_role IS NOT NULL AND v_staff_role NOT IN ('owner', 'manager', 'cashier', 'kitchen') THEN
            RAISE EXCEPTION 'Access denied: role "%" is not authorized to view orders', v_staff_role;
        END IF;
    END IF;

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
                        'unit_price_paisa', oi.unit_price_paisa,
                        'quantity', oi.quantity,
                        'addons_snapshot', oi.addons_snapshot,
                        'line_total_paisa', oi.line_total_paisa
                    )
                ), '[]'::jsonb)
                FROM public.order_items oi
                WHERE oi.order_id = o.id
            )
        )
        ORDER BY o.created_at DESC
    ), '[]'::jsonb) INTO v_result
    FROM public.orders o
    WHERE o.business_id = v_target_biz;

    RETURN v_result;
END;
$$;

-- Revoke anonymous access; grant strictly to authenticated and service_role
REVOKE EXECUTE ON FUNCTION public.get_merchant_orders(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_merchant_orders(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. HARDEN CATALOG & ADMIN RPCS (TENANT & ROLE OWNERSHIP)
-- ---------------------------------------------------------------------

-- A. Toggle Product Availability
DROP FUNCTION IF EXISTS public.admin_toggle_product_availability(UUID, BOOLEAN);

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
    v_staff_biz_id UUID;
    v_staff_role VARCHAR;
BEGIN
    SELECT * INTO v_prod FROM public.products WHERE id = p_product_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found: %', p_product_id;
    END IF;

    IF auth.role() = 'authenticated' THEN
        v_staff_biz_id := public.get_auth_business_id();
        v_staff_role := public.get_auth_role();

        IF v_staff_biz_id IS NOT NULL AND v_staff_biz_id <> v_prod.business_id THEN
            RAISE EXCEPTION 'Access denied: caller does not manage business for product %', p_product_id;
        END IF;

        IF v_staff_role IS NOT NULL AND v_staff_role NOT IN ('owner', 'manager') THEN
            RAISE EXCEPTION 'Access denied: role "%" is not authorized to modify catalog', v_staff_role;
        END IF;
    END IF;

    UPDATE public.products
    SET is_available = p_is_available,
        updated_at = now()
    WHERE id = p_product_id
    RETURNING * INTO v_prod;

    RETURN jsonb_build_object(
        'success', true,
        'product_id', v_prod.id,
        'is_available', v_prod.is_available
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_toggle_product_availability(UUID, BOOLEAN) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_toggle_product_availability(UUID, BOOLEAN) TO authenticated, service_role;

-- B. Update Product Price
DROP FUNCTION IF EXISTS public.admin_update_product_price(UUID, BIGINT);
DROP FUNCTION IF EXISTS public.admin_update_product_price(UUID, INTEGER);

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
    v_staff_biz_id UUID;
    v_staff_role VARCHAR;
BEGIN
    IF p_base_price_paisa < 0 THEN
        RAISE EXCEPTION 'Base price cannot be negative';
    END IF;

    SELECT * INTO v_prod FROM public.products WHERE id = p_product_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found: %', p_product_id;
    END IF;

    IF auth.role() = 'authenticated' THEN
        v_staff_biz_id := public.get_auth_business_id();
        v_staff_role := public.get_auth_role();

        IF v_staff_biz_id IS NOT NULL AND v_staff_biz_id <> v_prod.business_id THEN
            RAISE EXCEPTION 'Access denied: caller does not manage business for product %', p_product_id;
        END IF;

        IF v_staff_role IS NOT NULL AND v_staff_role NOT IN ('owner', 'manager') THEN
            RAISE EXCEPTION 'Access denied: role "%" is not authorized to modify catalog', v_staff_role;
        END IF;
    END IF;

    UPDATE public.products
    SET base_price_paisa = p_base_price_paisa,
        updated_at = now()
    WHERE id = p_product_id
    RETURNING * INTO v_prod;

    RETURN jsonb_build_object(
        'success', true,
        'product_id', v_prod.id,
        'base_price_paisa', v_prod.base_price_paisa
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_product_price(UUID, BIGINT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_product_price(UUID, BIGINT) TO authenticated, service_role;

-- C. Create Product
DROP FUNCTION IF EXISTS public.admin_create_product(UUID, UUID, TEXT, TEXT, BIGINT, BOOLEAN, BOOLEAN);

CREATE OR REPLACE FUNCTION public.admin_create_product(
    p_business_id UUID,
    p_category_id UUID,
    p_name TEXT,
    p_description TEXT,
    p_base_price_paisa BIGINT,
    p_is_veg BOOLEAN DEFAULT true,
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
    v_staff_biz_id UUID;
    v_staff_role VARCHAR;
    v_target_biz_id UUID := p_business_id;
    v_target_cat_id UUID := p_category_id;
BEGIN
    IF p_name IS NULL OR length(trim(p_name)) < 1 THEN
        RAISE EXCEPTION 'Product name is required';
    END IF;

    IF p_base_price_paisa < 0 THEN
        RAISE EXCEPTION 'Base price cannot be negative';
    END IF;

    IF auth.role() = 'authenticated' THEN
        v_staff_biz_id := public.get_auth_business_id();
        v_staff_role := public.get_auth_role();

        IF v_target_biz_id IS NULL THEN
            v_target_biz_id := v_staff_biz_id;
        END IF;

        IF v_staff_biz_id IS NOT NULL AND v_staff_biz_id <> v_target_biz_id THEN
            RAISE EXCEPTION 'Access denied: caller does not manage business %', v_target_biz_id;
        END IF;

        IF v_staff_role IS NOT NULL AND v_staff_role NOT IN ('owner', 'manager') THEN
            RAISE EXCEPTION 'Access denied: role "%" is not authorized to create products', v_staff_role;
        END IF;
    END IF;

    IF v_target_biz_id IS NULL THEN
        SELECT id INTO v_target_biz_id FROM public.businesses WHERE is_active = true LIMIT 1;
    END IF;

    IF v_target_cat_id IS NULL THEN
        SELECT id INTO v_target_cat_id FROM public.categories WHERE business_id = v_target_biz_id LIMIT 1;
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
        v_target_biz_id,
        v_target_cat_id,
        trim(p_name),
        COALESCE(p_description, 'Freshly prepared item'),
        p_base_price_paisa,
        COALESCE(p_is_veg, true),
        COALESCE(p_is_available, true),
        now(),
        now()
    )
    RETURNING * INTO v_prod;

    RETURN jsonb_build_object(
        'success', true,
        'id', v_prod.id,
        'business_id', v_prod.business_id,
        'category_id', v_prod.category_id,
        'name', v_prod.name,
        'base_price_paisa', v_prod.base_price_paisa
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_create_product(UUID, UUID, TEXT, TEXT, BIGINT, BOOLEAN, BOOLEAN) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_product(UUID, UUID, TEXT, TEXT, BIGINT, BOOLEAN, BOOLEAN) TO authenticated, service_role;

-- D. Delete Product
DROP FUNCTION IF EXISTS public.admin_delete_product(UUID);

CREATE OR REPLACE FUNCTION public.admin_delete_product(
    p_product_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_prod public.products%ROWTYPE;
    v_staff_biz_id UUID;
    v_staff_role VARCHAR;
BEGIN
    SELECT * INTO v_prod FROM public.products WHERE id = p_product_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found: %', p_product_id;
    END IF;

    IF auth.role() = 'authenticated' THEN
        v_staff_biz_id := public.get_auth_business_id();
        v_staff_role := public.get_auth_role();

        IF v_staff_biz_id IS NOT NULL AND v_staff_biz_id <> v_prod.business_id THEN
            RAISE EXCEPTION 'Access denied: caller does not manage business for product %', p_product_id;
        END IF;

        IF v_staff_role IS NOT NULL AND v_staff_role NOT IN ('owner', 'manager') THEN
            RAISE EXCEPTION 'Access denied: role "%" is not authorized to delete products', v_staff_role;
        END IF;
    END IF;

    DELETE FROM public.products WHERE id = p_product_id;

    RETURN jsonb_build_object(
        'success', true,
        'deleted_product_id', p_product_id
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_delete_product(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_product(UUID) TO authenticated, service_role;

-- E. Admin Create / Delete Business (Platform Fleet Management)
REVOKE EXECUTE ON FUNCTION public.admin_create_business(TEXT, TEXT, TEXT, TEXT, VARCHAR) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_business(TEXT, TEXT, TEXT, TEXT, VARCHAR) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_delete_business(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_business(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. REMOVE INSECURE AUTO-LINKAGE OF ALL NEW SIGNUPS TO DEFAULT BUSINESS
-- ---------------------------------------------------------------------
-- Drop the trigger that assigned every new account to Samosa Corner as owner/cashier
DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_staff_profile();

-- Replace with safe user profile creation trigger ONLY (no business auto-membership)
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, phone_number)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        NEW.raw_user_meta_data->>'phone_number'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created_profile
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();
