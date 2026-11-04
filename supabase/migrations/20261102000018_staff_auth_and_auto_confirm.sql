-- =====================================================================
-- Migration: 20261102000018_staff_auth_and_auto_confirm.sql
-- Description: Auto-confirm staff emails, auto-create profile and business
-- member linkage for merchant dashboard, KDS and admin authentication.
-- =====================================================================

-- 1. Auto-confirm email trigger for staff accounts
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

-- 2. Profile and Business Member Auto-Linkage Trigger
CREATE OR REPLACE FUNCTION public.handle_new_staff_profile()
RETURNS TRIGGER AS $$
DECLARE
    v_default_biz_id UUID := 'a0000000-0000-0000-0000-000000000001';
    v_role VARCHAR := 'owner';
    v_existing_members_count INT;
BEGIN
    -- 1. Create Profile
    INSERT INTO public.profiles (id, full_name, phone_number)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'phone_number', '8320917837')
    )
    ON CONFLICT (id) DO NOTHING;

    -- 2. Link to Samosa Corner if business exists
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

-- 3. Retroactively confirm and link existing user(s)
UPDATE auth.users
SET email_confirmed_at = NOW()
WHERE email_confirmed_at IS NULL;

INSERT INTO public.profiles (id, full_name, phone_number)
SELECT id, split_part(email, '@', 1), '8320917837'
FROM auth.users
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.business_members (business_id, user_id, role, status)
SELECT 'a0000000-0000-0000-0000-000000000001', id, 'owner', 'active'
FROM auth.users
ON CONFLICT (business_id, user_id) DO NOTHING;
