-- =====================================================================
-- QUICKBITE OS: PHASE 3.5 PAYMENT TRANSACTIONS AUDIT TABLE & POLICIES
-- Migration: 20261102000009_create_payment_transactions.sql
--
-- Root Cause:
-- The table public.payment_transactions was defined in setup_complete.sql
-- and used by verify-razorpay-payment, but was omitted from migrations 001–008.
-- This migration brings database instances up to date with the application contract.
--
-- Fixes:
-- 1. Creates public.payment_transactions for recording immutable payment captures
-- 2. Adds unique constraint on provider_payment_id (Razorpay Payment ID)
-- 3. Adds performance indexes on payment_order_id and provider_payment_id
-- 4. Adds index on payment_orders(order_id) for join/lookup performance
-- 5. Enables RLS and restricts access strictly to service_role and authorized staff
-- =====================================================================

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

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages payment transactions" ON public.payment_transactions;
CREATE POLICY "Service role manages payment transactions"
ON public.payment_transactions FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Staff can view payment transactions" ON public.payment_transactions;
CREATE POLICY "Staff can view payment transactions"
ON public.payment_transactions FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.payment_orders po
        JOIN public.orders o ON o.id = po.order_id
        WHERE po.id = payment_transactions.payment_order_id
        AND o.business_id = public.get_auth_business_id()
    )
);

