-- =====================================================================
-- QUICKBITE OS: ATOMIC PICKUP TOKEN GENERATOR
-- Concurrency-safe, supports >999 daily orders, resets at 04:00 AM IST
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
AS $$
DECLARE
    v_business_date DATE;
    v_seq BIGINT;
    v_token_str VARCHAR;
BEGIN
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

