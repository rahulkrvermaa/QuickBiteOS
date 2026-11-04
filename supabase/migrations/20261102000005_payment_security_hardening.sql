-- =====================================================================
-- QUICKBITE OS: PHASE 3.1 PAYMENT & TOKEN SECURITY HARDENING
-- Tightens RLS, locks down token allocation, and adds server-side cash collection
-- =====================================================================

-- 1. LOCK DOWN TOKEN ALLOCATION
-- Revoke execution of allocate_pickup_token from all public and authenticated users.
-- Only service_role (Edge Functions / secure backend) can allocate pickup tokens.
REVOKE EXECUTE ON FUNCTION public.allocate_pickup_token(UUID, UUID, UUID, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.allocate_pickup_token(UUID, UUID, UUID, VARCHAR) FROM anon;
REVOKE EXECUTE ON FUNCTION public.allocate_pickup_token(UUID, UUID, UUID, VARCHAR) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_pickup_token(UUID, UUID, UUID, VARCHAR) TO service_role;

-- 2. TIGHTEN ORDERS INSERT POLICY
-- Prevent clients from inserting orders with forged 'PAID' status.
DROP POLICY IF EXISTS "Public can insert orders" ON public.orders;
DROP POLICY IF EXISTS "Public can insert initial pending or cash orders" ON public.orders;

CREATE POLICY "Public can insert initial pending or cash orders"
ON public.orders FOR INSERT
WITH CHECK (
    -- Online orders MUST start as PENDING_PAYMENT and UNPAID
    (payment_method IN ('ONLINE_UPI', 'ONLINE_CARD') AND payment_status = 'UNPAID' AND status = 'PENDING_PAYMENT')
    OR
    -- Cash orders MUST start as PLACED and UNPAID
    (payment_method = 'CASH_COUNTER' AND payment_status = 'UNPAID' AND status = 'PLACED')
);

-- 3. LOCK DOWN ORDERS UPDATE
-- Ordinary anonymous customers CANNOT update orders, payment status, or prices.
DROP POLICY IF EXISTS "Staff can update business order status" ON public.orders;
DROP POLICY IF EXISTS "Staff can update business orders" ON public.orders;

CREATE POLICY "Staff can update business orders"
ON public.orders FOR UPDATE
USING (
    business_id = public.get_auth_business_id() 
    AND public.get_auth_role() IN ('owner', 'manager', 'cashier')
)
WITH CHECK (
    business_id = public.get_auth_business_id()
);

-- 4. SECURE SERVER-SIDE CASH COLLECTION PROCEDURE
CREATE OR REPLACE FUNCTION public.collect_cash_order(p_order_id UUID)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
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
