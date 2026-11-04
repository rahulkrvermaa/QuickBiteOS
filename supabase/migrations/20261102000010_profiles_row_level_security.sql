-- =====================================================================
-- QUICKBITE OS: PHASE 3.5 PROFILES ROW LEVEL SECURITY & HARDENING
-- Migration: 20261102000010_profiles_row_level_security.sql
--
-- Fixes:
-- 1. Enables Row Level Security on public.profiles
-- 2. Restricts SELECT, INSERT, and UPDATE strictly to the profile owner (auth.uid() = id)
-- 3. Ensures anonymous users have zero access to user profile records
-- 4. Prevents arbitrary profile deletion by regular users
-- 5. Grants management access to service_role
-- =====================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 1. Authenticated users can view only their own profile
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- 2. Authenticated users can insert only their own profile
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- 3. Authenticated users can update only their own profile
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- 4. Service role has full management access
DROP POLICY IF EXISTS "Service role manages profiles" ON public.profiles;
CREATE POLICY "Service role manages profiles"
ON public.profiles FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

