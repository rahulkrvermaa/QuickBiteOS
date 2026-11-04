
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================================
-- PART 1: SCHEMA & TABLES
-- =====================================================================

-- 1. PROFILES (Extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone_number TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. BUSINESSES (Tenants)
CREATE TABLE IF NOT EXISTS public.businesses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    tagline TEXT,
    logo_url TEXT,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    is_active BOOLEAN NOT NULL DEFAULT true,
    tier VARCHAR(20) NOT NULL DEFAULT 'Starter' CHECK (tier IN ('Starter', 'Growth', 'Pro')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_businesses_slug ON public.businesses(slug);

-- 3. BRANCHES (Multi-outlet support)
CREATE TABLE IF NOT EXISTS public.branches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code VARCHAR(10) NOT NULL DEFAULT 'MAIN',
    address TEXT NOT NULL,
    phone TEXT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(business_id, code)
);

CREATE INDEX IF NOT EXISTS idx_branches_business ON public.branches(business_id);

-- 4. BUSINESS MEMBERS (Role-based tenant access)
CREATE TABLE IF NOT EXISTS public.business_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'manager', 'cashier', 'kitchen', 'superadmin')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(business_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_business_members_user ON public.business_members(user_id);
CREATE INDEX IF NOT EXISTS idx_business_members_business ON public.business_members(business_id);

-- 5. BUSINESS SETTINGS
CREATE TABLE IF NOT EXISTS public.business_settings (
    business_id UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    allow_cash BOOLEAN NOT NULL DEFAULT true,
    allow_online BOOLEAN NOT NULL DEFAULT true,
    auto_accept_orders BOOLEAN NOT NULL DEFAULT false,
    tax_gst_percentage NUMERIC(4,2) NOT NULL DEFAULT 5.00,
    service_charge_percentage NUMERIC(4,2) NOT NULL DEFAULT 0.00,
    order_prefix VARCHAR(5) NOT NULL DEFAULT 'A',
    estimated_prep_minutes INTEGER NOT NULL DEFAULT 10,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. CATEGORIES
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(business_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_categories_business ON public.categories(business_id);

-- 7. PRODUCTS (Catalog)
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    base_price_paisa BIGINT NOT NULL CHECK (base_price_paisa >= 0),
    is_veg BOOLEAN NOT NULL DEFAULT true,
    is_available BOOLEAN NOT NULL DEFAULT true,
    track_inventory BOOLEAN NOT NULL DEFAULT false,
    stock_quantity INTEGER NOT NULL DEFAULT 100 CHECK (stock_quantity >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_business ON public.products(business_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);

-- 8. PRODUCT VARIANTS (Portion sizes)
CREATE TABLE IF NOT EXISTS public.product_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price_override_paisa BIGINT NOT NULL CHECK (price_override_paisa >= 0),
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON public.product_variants(product_id);

-- 9. PRODUCT ADDONS (Extra chutneys, toppings)
CREATE TABLE IF NOT EXISTS public.product_addons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price_paisa BIGINT NOT NULL DEFAULT 0 CHECK (price_paisa >= 0),
    max_quantity INTEGER NOT NULL DEFAULT 1 CHECK (max_quantity >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_addons_product ON public.product_addons(product_id);

-- 10. DAILY TOKEN COUNTERS (Atomic counter per branch per business day)
CREATE TABLE IF NOT EXISTS public.daily_token_counters (
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    business_date DATE NOT NULL,
    last_sequence BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (business_id, branch_id, business_date)
);

-- 11. ORDERS
CREATE SEQUENCE IF NOT EXISTS public.order_number_seq
    START WITH 1001
    INCREMENT BY 1
    NO CYCLE;

CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    order_number VARCHAR(30) NOT NULL UNIQUE,
    secure_access_token VARCHAR(64) NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (
        status IN ('PENDING_PAYMENT', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'REJECTED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED')
    ),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'UNPAID' CHECK (
        payment_status IN ('UNPAID', 'PAID', 'REFUNDED')
    ),
    payment_method VARCHAR(20) NOT NULL CHECK (
        payment_method IN ('ONLINE_UPI', 'ONLINE_CARD', 'CASH_COUNTER')
    ),
    subtotal_paisa BIGINT NOT NULL CHECK (subtotal_paisa >= 0),
    discount_paisa BIGINT NOT NULL DEFAULT 0 CHECK (discount_paisa >= 0),
    tax_paisa BIGINT NOT NULL DEFAULT 0 CHECK (tax_paisa >= 0),
    total_paisa BIGINT NOT NULL CHECK (total_paisa >= 0),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_business_status ON public.orders(business_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_secure_token ON public.orders(secure_access_token);
CREATE INDEX IF NOT EXISTS idx_orders_branch_date ON public.orders(branch_id, created_at);

-- 12. ORDER ITEMS (Immutable snapshots)
CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    item_name_snapshot TEXT NOT NULL,
    variant_name_snapshot TEXT,
    unit_price_paisa BIGINT NOT NULL CHECK (unit_price_paisa >= 0),
    quantity INTEGER NOT NULL CHECK (quantity >= 1),
    addons_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
    line_total_paisa BIGINT NOT NULL CHECK (line_total_paisa >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id);

-- 13. PICKUP TOKENS
CREATE TABLE IF NOT EXISTS public.pickup_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    token_display VARCHAR(20) NOT NULL,
    sequence_num BIGINT NOT NULL,
    token_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pickup_tokens_branch_date ON public.pickup_tokens(branch_id, token_date);

-- 14. ORDER STATUS HISTORY (Audit trail)
CREATE TABLE IF NOT EXISTS public.order_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    previous_status VARCHAR(20),
    new_status VARCHAR(20) NOT NULL,
    changed_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_status_history_order ON public.order_status_history(order_id);

-- 15. PAYMENT ORDERS & WEBHOOK EVENTS (Strict idempotency)
CREATE TABLE IF NOT EXISTS public.payment_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL DEFAULT 'razorpay',
    provider_order_id TEXT NOT NULL UNIQUE,
    amount_paisa BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'created',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payment_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_order_id UUID NOT NULL REFERENCES public.payment_orders(id) ON DELETE CASCADE,
    provider_payment_id TEXT NOT NULL,
    provider_signature TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'captured',
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_payment_transactions_provider_payment UNIQUE (provider_payment_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_order 
    ON public.payment_orders(order_id);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_order 
    ON public.payment_transactions(payment_order_id);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_provider_payment 
    ON public.payment_transactions(provider_payment_id);

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    error_message TEXT
);

-- =====================================================================
-- PART 2: ROW LEVEL SECURITY & HARDENED POLICIES
-- =====================================================================

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

REVOKE EXECUTE ON FUNCTION public.get_auth_business_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_auth_business_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_auth_business_id() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_auth_role() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_auth_role() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_auth_role() TO authenticated, service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
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
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DO $$
BEGIN
    DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
    DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
    DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
    DROP POLICY IF EXISTS "Service role manages profiles" ON public.profiles;
    DROP POLICY IF EXISTS "Public can view active businesses" ON public.businesses;
    DROP POLICY IF EXISTS "Owners can update own business" ON public.businesses;
    DROP POLICY IF EXISTS "Public can view active categories" ON public.categories;
    DROP POLICY IF EXISTS "Managers can modify categories" ON public.categories;
    DROP POLICY IF EXISTS "Public can view available products" ON public.products;
    DROP POLICY IF EXISTS "Staff can view all business products" ON public.products;
    DROP POLICY IF EXISTS "Managers can modify products" ON public.products;
    DROP POLICY IF EXISTS "Public can view product variants" ON public.product_variants;
    DROP POLICY IF EXISTS "Managers can modify product variants" ON public.product_variants;
    DROP POLICY IF EXISTS "Public can view product addons" ON public.product_addons;
    DROP POLICY IF EXISTS "Managers can modify product addons" ON public.product_addons;
    DROP POLICY IF EXISTS "Public can view order by secure token" ON public.orders;
    DROP POLICY IF EXISTS "Staff can view business orders" ON public.orders;
    DROP POLICY IF EXISTS "Staff can update business orders" ON public.orders;
    DROP POLICY IF EXISTS "Staff can update business order status" ON public.orders;
    DROP POLICY IF EXISTS "Staff can insert business orders" ON public.orders;
    DROP POLICY IF EXISTS "Staff can view pickup tokens" ON public.pickup_tokens;
    DROP POLICY IF EXISTS "Public can insert orders" ON public.orders;
    DROP POLICY IF EXISTS "Public can insert initial pending or cash orders" ON public.orders;
    DROP POLICY IF EXISTS "Public can insert order items" ON public.order_items;
    DROP POLICY IF EXISTS "Public can insert order items for pending or cash orders" ON public.order_items;
    DROP POLICY IF EXISTS "Staff can insert business order items" ON public.order_items;
    DROP POLICY IF EXISTS "Staff can view business order items" ON public.order_items;
    DROP POLICY IF EXISTS "Public can view active branches" ON public.branches;
    DROP POLICY IF EXISTS "Public can view branches" ON public.branches;
    DROP POLICY IF EXISTS "Staff can manage branches" ON public.branches;
    DROP POLICY IF EXISTS "Public can view business settings" ON public.business_settings;
    DROP POLICY IF EXISTS "Staff can manage business settings" ON public.business_settings;
    DROP POLICY IF EXISTS "Staff can view payment transactions" ON public.payment_transactions;
    DROP POLICY IF EXISTS "Service role manages payment transactions" ON public.payment_transactions;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ---------------------------------------------------------------------
-- 2.0 PROFILES POLICIES
-- ---------------------------------------------------------------------
-- Authenticated users can view only their own profile
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Authenticated users can insert only their own profile
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- Authenticated users can update only their own profile
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Service role has full management access
DROP POLICY IF EXISTS "Service role manages profiles" ON public.profiles;
CREATE POLICY "Service role manages profiles"
ON public.profiles FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ---------------------------------------------------------------------
-- 2.1 BUSINESSES POLICIES
-- ---------------------------------------------------------------------
-- Public can view active businesses
DROP POLICY IF EXISTS "Public can view active businesses" ON public.businesses;
CREATE POLICY "Public can view active businesses"
ON public.businesses FOR SELECT
TO anon, authenticated
USING (is_active = true);

-- Owners can update own business
DROP POLICY IF EXISTS "Owners can update own business" ON public.businesses;
CREATE POLICY "Owners can update own business"
ON public.businesses FOR UPDATE
TO authenticated
USING (id = public.get_auth_business_id() AND public.get_auth_role() = 'owner')
WITH CHECK (id = public.get_auth_business_id() AND public.get_auth_role() = 'owner');

-- ---------------------------------------------------------------------
-- 2.2 BRANCHES POLICIES
-- ---------------------------------------------------------------------
-- Public can view active branches of active businesses only
DROP POLICY IF EXISTS "Public can view active branches" ON public.branches;
DROP POLICY IF EXISTS "Public can view branches" ON public.branches;
CREATE POLICY "Public can view active branches"
ON public.branches FOR SELECT
TO anon, authenticated
USING (
    is_active = true 
    AND business_id IN (SELECT id FROM public.businesses WHERE is_active = true)
);

-- Staff can manage branches of their own business
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

-- ---------------------------------------------------------------------
-- 2.3 BUSINESS SETTINGS POLICIES & CUSTOMER PRIVACY HARDENING
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 2.4 CATEGORIES POLICIES
-- ---------------------------------------------------------------------
-- Public can view active categories of active businesses
DROP POLICY IF EXISTS "Public can view active categories" ON public.categories;
CREATE POLICY "Public can view active categories"
ON public.categories FOR SELECT
TO anon, authenticated
USING (
    is_active = true 
    AND business_id IN (SELECT id FROM public.businesses WHERE is_active = true)
);

-- Managers / Owners can modify categories
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

-- ---------------------------------------------------------------------
-- 2.5 PRODUCTS POLICIES
-- ---------------------------------------------------------------------
-- Public can view available products of active businesses
DROP POLICY IF EXISTS "Public can view available products" ON public.products;
CREATE POLICY "Public can view available products"
ON public.products FOR SELECT
TO anon, authenticated
USING (
    is_available = true 
    AND business_id IN (SELECT id FROM public.businesses WHERE is_active = true)
);

-- Staff can view all catalog items of their business (including unavailable items)
DROP POLICY IF EXISTS "Staff can view all business products" ON public.products;
CREATE POLICY "Staff can view all business products"
ON public.products FOR SELECT
TO authenticated
USING (business_id = public.get_auth_business_id());

-- Managers / Owners can modify products
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

-- ---------------------------------------------------------------------
-- 2.6 PRODUCT VARIANTS POLICIES
-- ---------------------------------------------------------------------
-- Public can view product variants of available products
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

-- Managers / Owners can modify product variants
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

-- ---------------------------------------------------------------------
-- 2.7 PRODUCT ADDONS POLICIES
-- ---------------------------------------------------------------------
-- Public can view product addons of available products
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

-- Managers / Owners can modify product addons
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

-- ---------------------------------------------------------------------
-- 2.8 ORDERS & ORDER ITEMS POLICIES
-- ---------------------------------------------------------------------
-- Direct client INSERT is revoked on orders and order_items to prevent price manipulation.
REVOKE INSERT ON public.orders FROM PUBLIC, anon, authenticated;
REVOKE INSERT ON public.order_items FROM PUBLIC, anon, authenticated;

-- Staff can insert counter/pos orders for their business. Customers place orders strictly via place_customer_order() RPC.
DROP POLICY IF EXISTS "Staff can insert business orders" ON public.orders;
CREATE POLICY "Staff can insert business orders"
ON public.orders FOR INSERT
TO authenticated
WITH CHECK (
    business_id = public.get_auth_business_id()
    AND public.get_auth_role() IN ('owner', 'manager', 'cashier')
);

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

-- Staff can view only orders belonging to their own business
-- Customers fetch strictly through get_customer_order_by_token() RPC
DROP POLICY IF EXISTS "Staff can view business orders" ON public.orders;
DROP POLICY IF EXISTS "Staff can view orders" ON public.orders;
CREATE POLICY "Staff can view business orders"
ON public.orders FOR SELECT
TO authenticated
USING (business_id = public.get_auth_business_id());

-- TIGHTENED UPDATE: Only authorized staff (owner, manager, cashier) can update orders.
-- Ordinary customers/anon have ZERO update permissions on orders.
DROP POLICY IF EXISTS "Staff can update business orders" ON public.orders;
DROP POLICY IF EXISTS "Staff can update orders" ON public.orders;
CREATE POLICY "Staff can update business orders"
ON public.orders FOR UPDATE
TO authenticated
USING (
    business_id = public.get_auth_business_id() 
    AND public.get_auth_role() IN ('owner', 'manager', 'cashier', 'kitchen')
)
WITH CHECK (
    business_id = public.get_auth_business_id()
);

-- Only staff of that business can view tokens directly.
-- Customers access their token securely via get_customer_order_by_token().
DROP POLICY IF EXISTS "Staff can view pickup tokens" ON public.pickup_tokens;
CREATE POLICY "Staff can view pickup tokens"
ON public.pickup_tokens FOR SELECT
TO authenticated
USING (business_id = public.get_auth_business_id());
-- Secure RPC function: Customers can fetch ONLY their order using their exact secure token.
CREATE OR REPLACE FUNCTION public.get_customer_order_by_token(p_secure_token VARCHAR)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF p_secure_token IS NULL OR length(trim(p_secure_token)) < 16 THEN
        RETURN NULL;
    END IF;

    SELECT jsonb_build_object(
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
        'pickup_token', (
            SELECT jsonb_build_object(
                'id', pt.id,
                'order_id', pt.order_id,
                'business_id', pt.business_id,
                'branch_id', pt.branch_id,
                'token_display', pt.token_display,
                'sequence_num', pt.sequence_num,
                'token_date', pt.token_date,
                'created_at', pt.created_at
            )
            FROM public.pickup_tokens pt
            WHERE pt.order_id = o.id
            LIMIT 1
        ),
        'items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', oi.id,
                'order_id', oi.order_id,
                'product_id', oi.product_id,
                'item_name_snapshot', oi.item_name_snapshot,
                'variant_name_snapshot', oi.variant_name_snapshot,
                'unit_price_paisa', oi.unit_price_paisa,
                'quantity', oi.quantity,
                'addons_snapshot', oi.addons_snapshot,
                'line_total_paisa', oi.line_total_paisa
            ))
            FROM public.order_items oi
            WHERE oi.order_id = o.id
        ), '[]'::jsonb)
    ) INTO v_result
    FROM public.orders o
    WHERE o.secure_access_token = p_secure_token;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_order_by_token(VARCHAR) TO anon, authenticated, service_role;

-- =====================================================================
-- SERVER-AUTHORITATIVE ORDER CREATION FUNCTION
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

-- =====================================================================
-- PAYMENT & AUDIT TABLES RLS HARDENING
-- =====================================================================

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages webhook events" ON public.payment_webhook_events;
CREATE POLICY "Service role manages webhook events"
ON public.payment_webhook_events FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

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

DROP POLICY IF EXISTS "Service role manages payment transactions" ON public.payment_transactions;
CREATE POLICY "Service role manages payment transactions"
ON public.payment_transactions FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

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

DROP POLICY IF EXISTS "Service role manages daily token counters" ON public.daily_token_counters;
CREATE POLICY "Service role manages daily token counters"
ON public.daily_token_counters FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
-- =====================================================================
-- PART 3: ATOMIC PICKUP TOKEN GENERATOR (Service Role Only)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.allocate_pickup_token(
    p_order_id UUID,
    p_business_id UUID,
    p_branch_id UUID,
    p_prefix VARCHAR DEFAULT 'A'
)
RETURNS TABLE (
    token_display VARCHAR,
    sequence_num BIGINT,
    token_date DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_business_date DATE;
    v_seq BIGINT;
    v_token_str VARCHAR;
    v_existing_token RECORD;
BEGIN
    -- 0. Check for existing token for this order (strict idempotency)
    SELECT pt.token_display, pt.sequence_num, pt.token_date 
    INTO v_existing_token
    FROM public.pickup_tokens pt
    WHERE pt.order_id = p_order_id
    LIMIT 1;

    IF FOUND THEN
        RETURN QUERY SELECT v_existing_token.token_display, v_existing_token.sequence_num, v_existing_token.token_date;
        RETURN;
    END IF;

    -- 1. Compute Business Date with 04:00 AM IST Rollover
    v_business_date := (timezone('Asia/Kolkata', now()) - interval '4 hours')::date;

    -- 2. Atomic Upsert & Lock on Daily Counter
    INSERT INTO public.daily_token_counters (
        business_id,
        branch_id,
        business_date,
        last_sequence,
        updated_at
    )
    VALUES (
        p_business_id,
        p_branch_id,
        v_business_date,
        1,
        now()
    )
    ON CONFLICT (business_id, branch_id, business_date)
    DO UPDATE SET 
        last_sequence = public.daily_token_counters.last_sequence + 1,
        updated_at = now()
    RETURNING last_sequence INTO v_seq;

    -- 3. Dynamic Zero-Padding Supporting >999 Orders
    v_token_str := p_prefix || LPAD(v_seq::text, GREATEST(3, LENGTH(v_seq::text)), '0');

    -- 4. Record the Token
    INSERT INTO public.pickup_tokens (
        order_id,
        business_id,
        branch_id,
        token_display,
        sequence_num,
        token_date,
        created_at
    )
    VALUES (
        p_order_id,
        p_business_id,
        p_branch_id,
        v_token_str,
        v_seq,
        v_business_date,
        now()
    );

    RETURN QUERY SELECT v_token_str, v_seq, v_business_date;
END;
$$;

-- LOCK DOWN: Only service_role (Edge Functions / secure backend) can call allocate_pickup_token
REVOKE EXECUTE ON FUNCTION public.allocate_pickup_token(UUID, UUID, UUID, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.allocate_pickup_token(UUID, UUID, UUID, VARCHAR) FROM anon;
REVOKE EXECUTE ON FUNCTION public.allocate_pickup_token(UUID, UUID, UUID, VARCHAR) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_pickup_token(UUID, UUID, UUID, VARCHAR) TO service_role;

-- =====================================================================
-- PART 4: SECURE SERVER-SIDE CASH COLLECTION PROCEDURE
-- =====================================================================

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

-- Atomic status transition for KDS / Staff operations
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
        RAISE EXCEPTION 'Order not found';
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

    INSERT INTO public.order_status_history (
        order_id,
        previous_status,
        new_status,
        changed_by_user_id,
        note
    )
    VALUES (
        p_order_id,
        v_prev_status,
        p_next_status,
        auth.uid(),
        COALESCE(p_note, 'Status updated via KDS/Staff operations')
    );

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

-- Secure merchant orders retrieval for KDS and Dashboard terminals
CREATE OR REPLACE FUNCTION public.get_merchant_orders(p_business_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_target_biz UUID := p_business_id;
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
        )
        ORDER BY o.created_at DESC
    ), '[]'::jsonb) INTO v_result
    FROM public.orders o
    WHERE (v_target_biz IS NULL OR o.business_id = v_target_biz);

    RETURN v_result;
END;
$$;

-- Overload with zero parameters for direct PostgREST schema cache compatibility
CREATE OR REPLACE FUNCTION public.get_merchant_orders()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    RETURN public.get_merchant_orders(NULL::UUID);
END;
$$;

REVOKE ALL ON FUNCTION public.get_merchant_orders(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_merchant_orders(UUID) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_merchant_orders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_merchant_orders() TO anon, authenticated, service_role;


-- =====================================================================
-- PART 5: SEED BENCHMARK SHOP (SAMOSA CORNER)
-- =====================================================================

DO $$
DECLARE
    v_biz_id UUID := 'a0000000-0000-0000-0000-000000000001';
    v_branch_id UUID := 'b0000000-0000-0000-0000-000000000001';
    v_cat_samosas UUID := 'c0000000-0000-0000-0000-000000000001';
    v_cat_kachoris UUID := 'c0000000-0000-0000-0000-000000000002';
    v_cat_chai UUID := 'c0000000-0000-0000-0000-000000000003';
    v_cat_extras UUID := 'c0000000-0000-0000-0000-000000000004';

    v_prod_aloo UUID := 'd0000000-0000-0000-0000-000000000001';
    v_prod_paneer UUID := 'd0000000-0000-0000-0000-000000000002';
    v_prod_moong UUID := 'd0000000-0000-0000-0000-000000000003';
    v_prod_pyaaz UUID := 'd0000000-0000-0000-0000-000000000004';
    v_prod_chai UUID := 'd0000000-0000-0000-0000-000000000005';
    v_prod_lassi UUID := 'd0000000-0000-0000-0000-000000000006';
BEGIN
    INSERT INTO public.businesses (id, name, slug, tagline, phone, address, city, currency, is_active, tier)
    VALUES (
        v_biz_id,
        'Samosa Corner',
        'samosa-corner',
        'Authentic Crispy Samosas, Khasta Kachoris & Kulhad Chai since 1998',
        '+91 83209 17837',
        'Maharajganj Main Rd, near by Sharamahala, Located in: Kali Mandir maharajganj',
        'Jamui, Bihar 811307',
        'INR',
        true,
        'Starter'
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.branches (id, business_id, name, code, address, phone, is_primary, is_active)
    VALUES (
        v_branch_id,
        v_biz_id,
        'Jamui Flagship',
        'MAIN',
        'Maharajganj Main Rd, near by Sharamahala, Located in: Kali Mandir maharajganj, Jamui, Bihar 811307',
        '+91 83209 17837',
        true,
        true
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.business_settings (
        business_id, allow_cash, allow_online, auto_accept_orders, tax_gst_percentage, service_charge_percentage, order_prefix, estimated_prep_minutes
    )
    VALUES (
        v_biz_id, true, true, false, 5.00, 0.00, 'A', 10
    ) ON CONFLICT (business_id) DO NOTHING;

    INSERT INTO public.categories (id, business_id, name, slug, display_order, is_active)
    VALUES 
        (v_cat_samosas, v_biz_id, 'Hot Samosas', 'hot-samosas', 1, true),
        (v_cat_kachoris, v_biz_id, 'Khasta Kachoris', 'kachoris', 2, true),
        (v_cat_chai, v_biz_id, 'Kulhad Chai & Beverages', 'chai-beverages', 3, true),
        (v_cat_extras, v_biz_id, 'Chutneys & Add-ons', 'chutneys-extras', 4, true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.products (id, business_id, category_id, name, description, base_price_paisa, is_veg, is_available)
    VALUES
        (v_prod_aloo, v_biz_id, v_cat_samosas, 'Punjabi Aloo Samosa', 'Crispy hand-rolled pastry stuffed with spiced potato and green peas', 2000, true, true),
        (v_prod_paneer, v_biz_id, v_cat_samosas, 'Paneer Tikka Samosa', 'Tender tandoori marinated paneer cubes and dry roasted spices', 3500, true, true),
        (v_prod_moong, v_biz_id, v_cat_kachoris, 'Moong Dal Khasta Kachori', 'Flaky round pastry with spiced yellow moong dal and hing-aloo gravy', 2500, true, true),
        (v_prod_pyaaz, v_biz_id, v_cat_kachoris, 'Jodhpuri Pyaaz Kachori', 'Large crispy kachori with spiced caramelized onions and fennel', 3000, true, true),
        (v_prod_chai, v_biz_id, v_cat_chai, 'Kulhad Masala Chai', 'Freshly brewed milk tea with crushed ginger, cardamom, and Assam tea', 2000, true, true),
        (v_prod_lassi, v_biz_id, v_cat_chai, 'Amritsari Sweet Lassi', 'Thick creamy churned yogurt topped with fresh malai and pistachios', 4000, true, true)
    ON CONFLICT (id) DO NOTHING;

    -- Safely ensure unique constraints exist to prevent duplicate seed entries
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_product_variants_product_name'
    ) THEN
        ALTER TABLE public.product_variants 
        ADD CONSTRAINT uq_product_variants_product_name UNIQUE (product_id, name);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_product_addons_product_name'
    ) THEN
        ALTER TABLE public.product_addons 
        ADD CONSTRAINT uq_product_addons_product_name UNIQUE (product_id, name);
    END IF;

    INSERT INTO public.product_variants (product_id, name, price_override_paisa, is_default)
    VALUES
        (v_prod_aloo, 'Single (1 pc)', 2000, true),
        (v_prod_aloo, 'Plate of 2 pcs', 3800, false),
        (v_prod_paneer, 'Single (1 pc)', 3500, true),
        (v_prod_paneer, 'Plate of 2 pcs', 6500, false),
        (v_prod_chai, 'Regular Masala', 2000, true),
        (v_prod_chai, 'Extra Adrak & Elaichi', 2500, false)
    ON CONFLICT (product_id, name) DO NOTHING;

    INSERT INTO public.product_addons (product_id, name, price_paisa, max_quantity)
    VALUES
        (v_prod_aloo, 'Extra Saunth Sweet Chutney', 500, 3),
        (v_prod_aloo, 'Extra Spicy Mint Chutney', 500, 3),
        (v_prod_aloo, 'Top with Chole Gravy & Curd', 2500, 1),
        (v_prod_moong, 'Extra Aloo Gravy Bowl', 1500, 2)
    ON CONFLICT (product_id, name) DO NOTHING;
END $$;

-- =====================================================================
-- Migration 014: Enable Supabase Realtime Publication and Replica Identity
-- =====================================================================
ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER TABLE public.order_items REPLICA IDENTITY FULL;
ALTER TABLE public.pickup_tokens REPLICA IDENTITY FULL;
ALTER TABLE public.products REPLICA IDENTITY FULL;
ALTER TABLE public.categories REPLICA IDENTITY FULL;
ALTER TABLE public.businesses REPLICA IDENTITY FULL;
ALTER TABLE public.business_settings REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'orders'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'order_items'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'pickup_tokens'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.pickup_tokens;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'products'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'categories'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.categories;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'businesses'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.businesses;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'business_settings'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.business_settings;
    END IF;
END;
$$;

-- =====================================================================
-- QUICKBITE MIGRATION 20261102000015: CATALOG & ADMIN RPCS
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



-- =====================================================================
-- 9. Staff Auth, Profile & Auto-Confirm Triggers
-- =====================================================================

CREATE OR REPLACE FUNCTION public.handle_new_staff_user()
RETURNS TRIGGER AS $$
BEGIN
    NEW.email_confirmed_at := COALESCE(NEW.email_confirmed_at, NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_confirm ON auth.users;
CREATE TRIGGER on_auth_user_created_confirm
    BEFORE INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_staff_user();

CREATE OR REPLACE FUNCTION public.handle_new_staff_profile()
RETURNS TRIGGER AS $$
DECLARE
    v_default_biz_id UUID := 'a0000000-0000-0000-0000-000000000001';
    v_role VARCHAR := 'owner';
    v_existing_members_count INT;
BEGIN
    INSERT INTO public.profiles (id, full_name, phone_number)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'phone_number', '8320917837')
    )
    ON CONFLICT (id) DO NOTHING;

    IF EXISTS (SELECT 1 FROM public.businesses WHERE id = v_default_biz_id) THEN
        SELECT count(*) INTO v_existing_members_count 
        FROM public.business_members 
        WHERE business_id = v_default_biz_id;

        IF v_existing_members_count > 0 THEN
            v_role := 'cashier';
        END IF;

        INSERT INTO public.business_members (business_id, user_id, role, status)
        VALUES (v_default_biz_id, NEW.id, v_role, 'active')
        ON CONFLICT (business_id, user_id) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_staff_profile();
