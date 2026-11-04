-- =====================================================================
-- QUICKBITE MIGRATION 20261102000015: CATALOG & ADMIN RPCS
-- Enables instant, atomic product & tenant management with zero RLS blockages
-- =====================================================================

-- 1. Admin Toggle Product Availability
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

-- 2. Admin Update Product Price
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

-- 3. Admin Create Product
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

-- 4. Admin Delete Product
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

-- 5. Admin Toggle Business Status
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

-- 6. Admin Update Business Tier
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

-- 7. Admin Create Business
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

    -- Create default primary branch for the business
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

    -- Create default business settings
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

-- 8. Admin Delete Business
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

