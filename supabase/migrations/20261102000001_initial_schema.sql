-- =====================================================================
-- QUICKBITE OS: INITIAL SCHEMA MIGRATION
-- Standard: PostgreSQL 15+ compatible for Supabase
-- Monetary standard: All prices/amounts stored strictly in integer PAISA (1 INR = 100 Paisa)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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

CREATE INDEX idx_businesses_slug ON public.businesses(slug);

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

CREATE INDEX idx_branches_business ON public.branches(business_id);

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

CREATE INDEX idx_business_members_user ON public.business_members(user_id);
CREATE INDEX idx_business_members_business ON public.business_members(business_id);

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

CREATE INDEX idx_categories_business ON public.categories(business_id);

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
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_business ON public.products(business_id);
CREATE INDEX idx_products_category ON public.products(category_id);

-- 8. PRODUCT VARIANTS (Portion sizes)
CREATE TABLE IF NOT EXISTS public.product_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price_override_paisa BIGINT NOT NULL CHECK (price_override_paisa >= 0),
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_variants_product ON public.product_variants(product_id);

-- 9. PRODUCT ADDONS (Extra chutneys, toppings)
CREATE TABLE IF NOT EXISTS public.product_addons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price_paisa BIGINT NOT NULL DEFAULT 0 CHECK (price_paisa >= 0),
    max_quantity INTEGER NOT NULL DEFAULT 1 CHECK (max_quantity >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_addons_product ON public.product_addons(product_id);

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
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    order_number VARCHAR(30) NOT NULL UNIQUE,
    secure_access_token VARCHAR(64) NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (
        status IN ('PENDING_PAYMENT', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'REJECTED', 'CANCELLED')
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

CREATE INDEX idx_orders_business_status ON public.orders(business_id, status);
CREATE INDEX idx_orders_secure_token ON public.orders(secure_access_token);
CREATE INDEX idx_orders_branch_date ON public.orders(branch_id, created_at);

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

CREATE INDEX idx_order_items_order ON public.order_items(order_id);

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

CREATE INDEX idx_pickup_tokens_branch_date ON public.pickup_tokens(branch_id, token_date);

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

CREATE INDEX idx_status_history_order ON public.order_status_history(order_id);

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

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
    id TEXT PRIMARY KEY, -- Provider Event ID (Razorpay event ID)
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    error_message TEXT
);

