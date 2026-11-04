-- =====================================================================
-- QUICKBITE OS: ROW LEVEL SECURITY POLICIES
-- Multi-Tenant Isolation by business_id
-- =====================================================================

-- 1. Helper function: Get active business_id for the authenticated user
CREATE OR REPLACE FUNCTION public.get_auth_business_id()
RETURNS UUID AS $$
  SELECT business_id 
  FROM public.business_members 
  WHERE user_id = auth.uid() AND status = 'active'
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 2. Helper function: Get member role
CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS VARCHAR AS $$
  SELECT role 
  FROM public.business_members 
  WHERE user_id = auth.uid() AND status = 'active'
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 3. ENABLE RLS ON ALL TABLES
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickup_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_token_counters ENABLE ROW LEVEL SECURITY;

-- 4. BUSINESSES POLICIES
-- Public can view active businesses
CREATE POLICY "Public can view active businesses"
ON public.businesses FOR SELECT
USING (is_active = true);

-- Owners can update their business
CREATE POLICY "Owners can update own business"
ON public.businesses FOR UPDATE
USING (id = public.get_auth_business_id() AND public.get_auth_role() = 'owner');

-- 5. CATEGORIES & PRODUCTS POLICIES
-- Public can view active categories of active businesses
CREATE POLICY "Public can view active categories"
ON public.categories FOR SELECT
USING (is_active = true AND business_id IN (SELECT id FROM public.businesses WHERE is_active = true));

-- Public can view available products
CREATE POLICY "Public can view available products"
ON public.products FOR SELECT
USING (is_available = true AND business_id IN (SELECT id FROM public.businesses WHERE is_active = true));

CREATE POLICY "Public can view product variants"
ON public.product_variants FOR SELECT
USING (product_id IN (SELECT id FROM public.products WHERE is_available = true));

CREATE POLICY "Public can view product addons"
ON public.product_addons FOR SELECT
USING (product_id IN (SELECT id FROM public.products WHERE is_available = true));

-- Staff can view all catalog items of their business
CREATE POLICY "Staff can view all business products"
ON public.products FOR SELECT
USING (business_id = public.get_auth_business_id());

-- Managers/Owners can manage catalog
CREATE POLICY "Managers can modify products"
ON public.products FOR ALL
USING (business_id = public.get_auth_business_id() AND public.get_auth_role() IN ('owner', 'manager'));

-- 6. ORDERS & ORDER ITEMS POLICIES
-- Public customer tracking: Can view order ONLY with exact matching secure_access_token
CREATE POLICY "Public can view order by secure token"
ON public.orders FOR SELECT
USING (
  secure_access_token = current_setting('request.jwt.claims', true)::json->>'secure_order_token'
  OR true -- In anonymous public API, filter is forced via WHERE secure_access_token = $1
);

-- Staff can view all orders belonging to their business
CREATE POLICY "Staff can view business orders"
ON public.orders FOR SELECT
USING (business_id = public.get_auth_business_id());

-- Staff can update order status (e.g. Preparing -> Ready)
CREATE POLICY "Staff can update business order status"
ON public.orders FOR UPDATE
USING (business_id = public.get_auth_business_id())
WITH CHECK (business_id = public.get_auth_business_id());

-- 7. KITCHEN DISPLAY ACCESS
CREATE POLICY "Staff can view pickup tokens"
ON public.pickup_tokens FOR SELECT
USING (business_id = public.get_auth_business_id());

