-- Migration: 20261102000012_fix_staff_rls_authenticated_roles.sql
-- Description: Restrict all staff/management RLS policies explicitly to the 'authenticated' role
-- and ensure public customer catalog SELECT policies explicitly allow 'anon' and 'authenticated'.
--
-- Why:
-- When a policy does not specify 'TO <role>', PostgreSQL defaults to 'TO PUBLIC' (applying to all roles,
-- including 'anon'). If an anonymous customer queries a catalog table (such as branches, business_settings,
-- categories, or products), PostgreSQL evaluates all applicable policies for the table. Because the staff
-- management policies called get_auth_business_id() or get_auth_role() (which correctly had execution
-- revoked from 'anon' in migration 011), anonymous customers were hitting:
-- "permission denied for function get_auth_business_id"
-- This caused the frontend catalog service to fail and silently fall back to demo mode, triggering
-- downstream "Order not found" failures during online checkout.
--
-- This migration fixes every staff and public policy to use explicit roles without altering table schemas,
-- dropping tables, or touching data.

-- =====================================================================
-- 1. BUSINESSES POLICIES
-- =====================================================================
DROP POLICY IF EXISTS "Public can view active businesses" ON public.businesses;
CREATE POLICY "Public can view active businesses"
ON public.businesses FOR SELECT
TO anon, authenticated
USING (is_active = true);

DROP POLICY IF EXISTS "Owners can update own business" ON public.businesses;
CREATE POLICY "Owners can update own business"
ON public.businesses FOR UPDATE
TO authenticated
USING (
    id = public.get_auth_business_id()
    AND public.get_auth_role() = 'owner'
)
WITH CHECK (
    id = public.get_auth_business_id()
    AND public.get_auth_role() = 'owner'
);

-- =====================================================================
-- 2. BRANCHES POLICIES
-- =====================================================================
DROP POLICY IF EXISTS "Public can view active branches" ON public.branches;
DROP POLICY IF EXISTS "Public can view branches" ON public.branches;
CREATE POLICY "Public can view active branches"
ON public.branches FOR SELECT
TO anon, authenticated
USING (
    is_active = true 
    AND business_id IN (SELECT id FROM public.businesses WHERE is_active = true)
);

DROP POLICY IF EXISTS "Staff can manage branches" ON public.branches;
CREATE POLICY "Staff can manage branches"
ON public.branches FOR ALL
TO authenticated
USING (
    business_id = public.get_auth_business_id()
    AND public.get_auth_role() IN ('owner', 'manager')
)
WITH CHECK (
    business_id = public.get_auth_business_id()
    AND public.get_auth_role() IN ('owner', 'manager')
);

-- =====================================================================
-- 3. BUSINESS SETTINGS POLICIES & CUSTOMER PRIVACY HARDENING
-- =====================================================================
-- CRITICAL PRIVACY PROTECTION:
-- Direct SELECT on the raw public.business_settings table is STRICTLY REVOKED from anonymous users.
-- Anonymous customers must NEVER have unrestricted column access to business_settings, keeping
-- private operational toggles, printer configurations, internal credentials, and business-only metadata secure.
-- Only approved public fields (allow_cash, allow_online, tax_gst_percentage, service_charge_percentage,
-- estimated_prep_minutes) are exposed to customers via the secure SECURITY DEFINER RPC
-- get_public_business_settings() and the restricted view public_business_settings.

DROP POLICY IF EXISTS "Public can view business settings" ON public.business_settings;
REVOKE SELECT ON public.business_settings FROM PUBLIC, anon;

-- Staff can manage settings of their own business
DROP POLICY IF EXISTS "Staff can manage business settings" ON public.business_settings;
CREATE POLICY "Staff can manage business settings"
ON public.business_settings FOR ALL
TO authenticated
USING (
    business_id = public.get_auth_business_id()
    AND public.get_auth_role() IN ('owner', 'manager')
)
WITH CHECK (
    business_id = public.get_auth_business_id()
    AND public.get_auth_role() IN ('owner', 'manager')
);

-- Safe restricted view exposing ONLY approved customer-facing settings for active businesses
CREATE OR REPLACE VIEW public.public_business_settings WITH (security_invoker = false) AS
SELECT 
    bs.business_id,
    bs.allow_cash,
    bs.allow_online,
    bs.tax_gst_percentage,
    bs.service_charge_percentage,
    bs.estimated_prep_minutes
FROM public.business_settings bs
JOIN public.businesses b ON b.id = bs.business_id
WHERE b.is_active = true;

REVOKE ALL ON public.public_business_settings FROM PUBLIC;
GRANT SELECT ON public.public_business_settings TO anon, authenticated, service_role;

-- Safe restricted RPC exposing ONLY approved customer-facing settings
CREATE OR REPLACE FUNCTION public.get_public_business_settings(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_settings JSONB;
BEGIN
    SELECT jsonb_build_object(
        'business_id', bs.business_id,
        'allow_cash', bs.allow_cash,
        'allow_online', bs.allow_online,
        'tax_gst_percentage', bs.tax_gst_percentage,
        'service_charge_percentage', bs.service_charge_percentage,
        'estimated_prep_minutes', bs.estimated_prep_minutes
    ) INTO v_settings
    FROM public.business_settings bs
    JOIN public.businesses b ON b.id = bs.business_id
    WHERE bs.business_id = p_business_id AND b.is_active = true;

    RETURN v_settings;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_business_settings(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_business_settings(UUID) TO anon, authenticated, service_role;

-- =====================================================================
-- 4. CATEGORIES POLICIES
-- =====================================================================
DROP POLICY IF EXISTS "Public can view active categories" ON public.categories;
CREATE POLICY "Public can view active categories"
ON public.categories FOR SELECT
TO anon, authenticated
USING (
    is_active = true 
    AND business_id IN (SELECT id FROM public.businesses WHERE is_active = true)
);

DROP POLICY IF EXISTS "Managers can modify categories" ON public.categories;
CREATE POLICY "Managers can modify categories"
ON public.categories FOR ALL
TO authenticated
USING (
    business_id = public.get_auth_business_id() 
    AND public.get_auth_role() IN ('owner', 'manager')
)
WITH CHECK (
    business_id = public.get_auth_business_id() 
    AND public.get_auth_role() IN ('owner', 'manager')
);

-- =====================================================================
-- 5. PRODUCTS POLICIES
-- =====================================================================
DROP POLICY IF EXISTS "Public can view available products" ON public.products;
CREATE POLICY "Public can view available products"
ON public.products FOR SELECT
TO anon, authenticated
USING (
    is_available = true 
    AND business_id IN (SELECT id FROM public.businesses WHERE is_active = true)
);

DROP POLICY IF EXISTS "Staff can view all business products" ON public.products;
CREATE POLICY "Staff can view all business products"
ON public.products FOR SELECT
TO authenticated
USING (business_id = public.get_auth_business_id());

DROP POLICY IF EXISTS "Managers can modify products" ON public.products;
CREATE POLICY "Managers can modify products"
ON public.products FOR ALL
TO authenticated
USING (
    business_id = public.get_auth_business_id() 
    AND public.get_auth_role() IN ('owner', 'manager')
)
WITH CHECK (
    business_id = public.get_auth_business_id() 
    AND public.get_auth_role() IN ('owner', 'manager')
);

-- =====================================================================
-- 6. PRODUCT VARIANTS POLICIES
-- =====================================================================
DROP POLICY IF EXISTS "Public can view product variants" ON public.product_variants;
CREATE POLICY "Public can view product variants"
ON public.product_variants FOR SELECT
TO anon, authenticated
USING (
    product_id IN (
        SELECT id FROM public.products 
        WHERE is_available = true 
        AND business_id IN (SELECT id FROM public.businesses WHERE is_active = true)
    )
);

DROP POLICY IF EXISTS "Managers can modify product variants" ON public.product_variants;
CREATE POLICY "Managers can modify product variants"
ON public.product_variants FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = product_variants.product_id
        AND p.business_id = public.get_auth_business_id()
        AND public.get_auth_role() IN ('owner', 'manager')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = product_variants.product_id
        AND p.business_id = public.get_auth_business_id()
        AND public.get_auth_role() IN ('owner', 'manager')
    )
);

-- =====================================================================
-- 7. PRODUCT ADDONS POLICIES
-- =====================================================================
DROP POLICY IF EXISTS "Public can view product addons" ON public.product_addons;
CREATE POLICY "Public can view product addons"
ON public.product_addons FOR SELECT
TO anon, authenticated
USING (
    product_id IN (
        SELECT id FROM public.products 
        WHERE is_available = true 
        AND business_id IN (SELECT id FROM public.businesses WHERE is_active = true)
    )
);

DROP POLICY IF EXISTS "Managers can modify product addons" ON public.product_addons;
CREATE POLICY "Managers can modify product addons"
ON public.product_addons FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = product_addons.product_id
        AND p.business_id = public.get_auth_business_id()
        AND public.get_auth_role() IN ('owner', 'manager')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = product_addons.product_id
        AND p.business_id = public.get_auth_business_id()
        AND public.get_auth_role() IN ('owner', 'manager')
    )
);

-- =====================================================================
-- 8. ORDERS POLICIES
-- =====================================================================
DROP POLICY IF EXISTS "Staff can insert business orders" ON public.orders;
CREATE POLICY "Staff can insert business orders"
ON public.orders FOR INSERT
TO authenticated
WITH CHECK (
    business_id = public.get_auth_business_id()
    AND public.get_auth_role() IN ('owner', 'manager', 'cashier')
);

DROP POLICY IF EXISTS "Staff can view business orders" ON public.orders;
DROP POLICY IF EXISTS "Staff can view orders" ON public.orders;
CREATE POLICY "Staff can view business orders"
ON public.orders FOR SELECT
TO authenticated
USING (
    business_id = public.get_auth_business_id()
);

DROP POLICY IF EXISTS "Staff can update business orders" ON public.orders;
DROP POLICY IF EXISTS "Staff can update orders" ON public.orders;
CREATE POLICY "Staff can update business orders"
ON public.orders FOR UPDATE
TO authenticated
USING (
    business_id = public.get_auth_business_id()
    AND public.get_auth_role() IN ('owner', 'manager', 'cashier')
)
WITH CHECK (
    business_id = public.get_auth_business_id()
);

-- =====================================================================
-- 9. ORDER ITEMS POLICIES
-- =====================================================================
DROP POLICY IF EXISTS "Staff can insert business order items" ON public.order_items;
CREATE POLICY "Staff can insert business order items"
ON public.order_items FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = order_items.order_id
        AND o.business_id = public.get_auth_business_id()
        AND public.get_auth_role() IN ('owner', 'manager', 'cashier')
    )
);

DROP POLICY IF EXISTS "Staff can view business order items" ON public.order_items;
DROP POLICY IF EXISTS "Staff can view order items" ON public.order_items;
CREATE POLICY "Staff can view business order items"
ON public.order_items FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = order_items.order_id
        AND o.business_id = public.get_auth_business_id()
    )
);

-- =====================================================================
-- 10. PICKUP TOKENS POLICIES
-- =====================================================================
DROP POLICY IF EXISTS "Staff can view pickup tokens" ON public.pickup_tokens;
CREATE POLICY "Staff can view pickup tokens"
ON public.pickup_tokens FOR SELECT
TO authenticated
USING (
    business_id = public.get_auth_business_id()
);

-- =====================================================================
-- 11. BUSINESS MEMBERS POLICIES
-- =====================================================================
DROP POLICY IF EXISTS "Staff can view business members" ON public.business_members;
CREATE POLICY "Staff can view business members"
ON public.business_members FOR SELECT
TO authenticated
USING (
    business_id = public.get_auth_business_id()
);

DROP POLICY IF EXISTS "Service role manages business members" ON public.business_members;
CREATE POLICY "Service role manages business members"
ON public.business_members FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =====================================================================
-- 12. PAYMENT ORDERS POLICIES
-- =====================================================================
DROP POLICY IF EXISTS "Staff can view payment orders" ON public.payment_orders;
CREATE POLICY "Staff can view payment orders"
ON public.payment_orders FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = payment_orders.order_id
        AND o.business_id = public.get_auth_business_id()
    )
);

DROP POLICY IF EXISTS "Service role manages payment orders" ON public.payment_orders;
CREATE POLICY "Service role manages payment orders"
ON public.payment_orders FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =====================================================================
-- 13. PAYMENT TRANSACTIONS POLICIES
-- =====================================================================
DROP POLICY IF EXISTS "Staff can view payment transactions" ON public.payment_transactions;
CREATE POLICY "Staff can view payment transactions"
ON public.payment_transactions FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.payment_orders po
        JOIN public.orders o ON o.id = po.order_id
        WHERE po.id = payment_transactions.payment_order_id
        AND o.business_id = public.get_auth_business_id()
    )
);

DROP POLICY IF EXISTS "Service role manages payment transactions" ON public.payment_transactions;
CREATE POLICY "Service role manages payment transactions"
ON public.payment_transactions FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =====================================================================
-- 14. ORDER STATUS HISTORY POLICIES
-- =====================================================================
DROP POLICY IF EXISTS "Staff can view order status history" ON public.order_status_history;
CREATE POLICY "Staff can view order status history"
ON public.order_status_history FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = order_status_history.order_id
        AND o.business_id = public.get_auth_business_id()
    )
);

DROP POLICY IF EXISTS "Staff can insert order status history" ON public.order_status_history;
CREATE POLICY "Staff can insert order status history"
ON public.order_status_history FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = order_status_history.order_id
        AND o.business_id = public.get_auth_business_id()
    )
);

DROP POLICY IF EXISTS "Service role manages order status history" ON public.order_status_history;
CREATE POLICY "Service role manages order status history"
ON public.order_status_history FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =====================================================================
-- 15. DAILY TOKEN COUNTERS POLICIES
-- =====================================================================
DROP POLICY IF EXISTS "Service role manages daily token counters" ON public.daily_token_counters;
CREATE POLICY "Service role manages daily token counters"
ON public.daily_token_counters FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

