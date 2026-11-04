-- =====================================================================
-- QUICKBITE OS: PHASE 3.2 SECURITY & ROW LEVEL SECURITY FIXES
-- Migration: 20261102000006_security_and_rls_fixes.sql
-- 
-- Fixes:
-- 1. Eliminates insecure "OR true" orders policy; replaces with secure token RPC
-- 2. Adds secure INSERT & SELECT policies for order_items
-- 3. Adds public SELECT policies for active branches & business_settings
-- 4. Restricts pickup_tokens SELECT strictly to staff & secure token RPC
-- 5. Enables RLS on payment_orders, payment_webhook_events, order_status_history
-- 6. Adds unique constraints on product_variants & product_addons to prevent seed duplicates
-- 7. Adds idempotent check to allocate_pickup_token (retains 4 AM IST reset & >999 support)
-- =====================================================================

-- =====================================================================
-- 1. ORDERS PRIVACY: REMOVE "OR true" & IMPLEMENT SECURE TOKEN RPC
-- =====================================================================

-- Drop any insecure permissive policies on orders
DROP POLICY IF EXISTS "Public can view order by secure token" ON public.orders;
DROP POLICY IF EXISTS "Staff can view business orders" ON public.orders;

-- Staff can view only orders belonging to their own business
CREATE POLICY "Staff can view business orders"
ON public.orders FOR SELECT
USING (business_id = public.get_auth_business_id());

-- Secure RPC function: Customers can fetch ONLY their order using their exact secure token.
-- Direct table queries on orders by anon return zero rows (default deny).
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
-- 2. ORDER ITEMS: SECURE INSERT & SELECT POLICIES
-- =====================================================================

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can insert order items" ON public.order_items;
DROP POLICY IF EXISTS "Public can insert order items for pending or cash orders" ON public.order_items;
DROP POLICY IF EXISTS "Staff can view business order items" ON public.order_items;

-- Customers can insert items ONLY for an active initial order they are creating (UNPAID)
CREATE POLICY "Public can insert order items for pending or cash orders"
ON public.order_items FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = order_items.order_id
        AND o.payment_status = 'UNPAID'
        AND o.status IN ('PENDING_PAYMENT', 'PLACED')
    )
);

-- Staff can view items belonging strictly to their business's orders
CREATE POLICY "Staff can view business order items"
ON public.order_items FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = order_items.order_id
        AND o.business_id = public.get_auth_business_id()
    )
);

-- =====================================================================
-- 3. BRANCHES & BUSINESS SETTINGS POLICIES
-- =====================================================================

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view active branches" ON public.branches;
DROP POLICY IF EXISTS "Public can view branches" ON public.branches;
DROP POLICY IF EXISTS "Staff can manage branches" ON public.branches;

-- Public can view active branches of active businesses only
CREATE POLICY "Public can view active branches"
ON public.branches FOR SELECT
USING (
    is_active = true 
    AND business_id IN (SELECT id FROM public.businesses WHERE is_active = true)
);

-- Staff can manage branches of their own business
CREATE POLICY "Staff can manage branches"
ON public.branches FOR ALL
USING (
    business_id = public.get_auth_business_id()
    AND public.get_auth_role() IN ('owner', 'manager')
);

DROP POLICY IF EXISTS "Public can view business settings" ON public.business_settings;
DROP POLICY IF EXISTS "Staff can manage business settings" ON public.business_settings;

-- Public can view settings of active businesses only (no secrets/credentials are stored here)
CREATE POLICY "Public can view business settings"
ON public.business_settings FOR SELECT
USING (
    business_id IN (SELECT id FROM public.businesses WHERE is_active = true)
);

-- Staff can manage settings of their own business
CREATE POLICY "Staff can manage business settings"
ON public.business_settings FOR ALL
USING (
    business_id = public.get_auth_business_id()
    AND public.get_auth_role() IN ('owner', 'manager')
);

-- Managers / Owners can modify categories
DROP POLICY IF EXISTS "Managers can modify categories" ON public.categories;
CREATE POLICY "Managers can modify categories"
ON public.categories FOR ALL
USING (
    business_id = public.get_auth_business_id() 
    AND public.get_auth_role() IN ('owner', 'manager')
);

-- Managers / Owners can modify product variants & addons
DROP POLICY IF EXISTS "Managers can modify product variants" ON public.product_variants;
CREATE POLICY "Managers can modify product variants"
ON public.product_variants FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = product_variants.product_id
        AND p.business_id = public.get_auth_business_id()
        AND public.get_auth_role() IN ('owner', 'manager')
    )
);

DROP POLICY IF EXISTS "Managers can modify product addons" ON public.product_addons;
CREATE POLICY "Managers can modify product addons"
ON public.product_addons FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = product_addons.product_id
        AND p.business_id = public.get_auth_business_id()
        AND public.get_auth_role() IN ('owner', 'manager')
    )
);

-- =====================================================================
-- 4. PICKUP TOKENS RESTRICTION
-- =====================================================================

ALTER TABLE public.pickup_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view pickup tokens" ON public.pickup_tokens;

-- Only staff of that business can view tokens directly.
-- Customers access their token securely via get_customer_order_by_token().
CREATE POLICY "Staff can view pickup tokens"
ON public.pickup_tokens FOR SELECT
USING (business_id = public.get_auth_business_id());

-- =====================================================================
-- 5. PAYMENT AND AUDIT TABLES RLS HARDENING
-- =====================================================================

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;

-- 5a. Webhook Events: Inaccessible to anon/authenticated. service_role only.
DROP POLICY IF EXISTS "Service role manages webhook events" ON public.payment_webhook_events;
CREATE POLICY "Service role manages webhook events"
ON public.payment_webhook_events FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 5b. Payment Orders: Staff can view their business's payment records; service_role manages.
DROP POLICY IF EXISTS "Staff can view payment orders" ON public.payment_orders;
DROP POLICY IF EXISTS "Service role manages payment orders" ON public.payment_orders;

CREATE POLICY "Staff can view payment orders"
ON public.payment_orders FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = payment_orders.order_id
        AND o.business_id = public.get_auth_business_id()
    )
);

CREATE POLICY "Service role manages payment orders"
ON public.payment_orders FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 5c. Order Status History: Staff can view & insert history for their business; service_role manages.
DROP POLICY IF EXISTS "Staff can view order status history" ON public.order_status_history;
DROP POLICY IF EXISTS "Staff can insert order status history" ON public.order_status_history;
DROP POLICY IF EXISTS "Service role manages order status history" ON public.order_status_history;

CREATE POLICY "Staff can view order status history"
ON public.order_status_history FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = order_status_history.order_id
        AND o.business_id = public.get_auth_business_id()
    )
);

CREATE POLICY "Staff can insert order status history"
ON public.order_status_history FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = order_status_history.order_id
        AND o.business_id = public.get_auth_business_id()
    )
);

CREATE POLICY "Service role manages order status history"
ON public.order_status_history FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =====================================================================
-- 6. PREVENT SEED DUPLICATES: UNIQUE CONSTRAINTS
-- =====================================================================

DO $$
BEGIN
    -- Deduplicate product_variants if duplicates exist, keeping oldest id
    DELETE FROM public.product_variants pv
    WHERE pv.id IN (
        SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY product_id, name ORDER BY created_at ASC, id ASC) as rnum
            FROM public.product_variants
        ) t WHERE t.rnum > 1
    );

    -- Deduplicate product_addons if duplicates exist, keeping oldest id
    DELETE FROM public.product_addons pa
    WHERE pa.id IN (
        SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY product_id, name ORDER BY created_at ASC, id ASC) as rnum
            FROM public.product_addons
        ) t WHERE t.rnum > 1
    );

    -- Safely add unique constraint on product_variants (product_id, name)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_product_variants_product_name'
    ) THEN
        ALTER TABLE public.product_variants 
        ADD CONSTRAINT uq_product_variants_product_name UNIQUE (product_id, name);
    END IF;

    -- Safely add unique constraint on product_addons (product_id, name)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_product_addons_product_name'
    ) THEN
        ALTER TABLE public.product_addons 
        ADD CONSTRAINT uq_product_addons_product_name UNIQUE (product_id, name);
    END IF;
END $$;

-- =====================================================================
-- 7. TOKEN GENERATION: IDEMPOTENCY ENHANCEMENT
-- Preserves atomic upsert, 4 AM IST daily reset, and >999 daily support
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
    -- Shifts between midnight and 03:59:59 AM IST stay on the previous day's shift.
    v_business_date := (timezone('Asia/Kolkata', now()) - interval '4 hours')::date;

    -- 2. Atomic Upsert & Lock on Daily Counter
    -- Prevents duplicate tokens during concurrent checkout spikes.
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
    -- Format: A001..A999, then seamlessly A1000..A2500 without failure.
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

-- Ensure execution is restricted exclusively to service_role
REVOKE EXECUTE ON FUNCTION public.allocate_pickup_token(UUID, UUID, UUID, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.allocate_pickup_token(UUID, UUID, UUID, VARCHAR) FROM anon;
REVOKE EXECUTE ON FUNCTION public.allocate_pickup_token(UUID, UUID, UUID, VARCHAR) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_pickup_token(UUID, UUID, UUID, VARCHAR) TO service_role;

