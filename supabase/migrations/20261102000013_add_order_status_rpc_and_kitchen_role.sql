-- Migration: 20261102000013_add_order_status_rpc_and_kitchen_role.sql
-- Description: Add atomic update_order_status RPC for KDS / Staff and update staff RLS policy to include 'kitchen' role.

-- 1. Secure status transition function for KDS / Staff
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
    -- Validate status parameter
    IF p_next_status NOT IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Invalid order status: %', p_next_status;
    END IF;

    -- Fetch target order
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found';
    END IF;

    -- Guard against modifying finalized orders
    IF v_order.status IN ('COMPLETED', 'CANCELLED') AND p_next_status <> v_order.status THEN
        RAISE EXCEPTION 'Cannot change status of an already % order', v_order.status;
    END IF;

    v_prev_status := v_order.status;

    -- Perform atomic update
    UPDATE public.orders
    SET status = p_next_status,
        updated_at = now()
    WHERE id = p_order_id
    RETURNING * INTO v_order;

    -- Record audit history
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

-- 2. Update staff UPDATE policy on orders to include 'kitchen' role
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

-- 3. Secure merchant orders retrieval for KDS and Dashboard terminals
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


