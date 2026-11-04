-- =====================================================================
-- QUICKBITE OS: PHASE 3.5 FUNCTION EXECUTION PERMISSIONS HARDENING
-- Migration: 20261102000011_harden_function_permissions.sql
--
-- Fixes:
-- 1. Revokes EXECUTE on get_auth_business_id() and get_auth_role() from PUBLIC and anon
-- 2. Preserves EXECUTE for authenticated users (required for staff RLS policy evaluation) and service_role
-- 3. Prevents unauthorized anonymous probing of internal auth helper RPCs
-- =====================================================================

-- 1. get_auth_business_id: Lock down to authenticated and service_role
REVOKE EXECUTE ON FUNCTION public.get_auth_business_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_auth_business_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_auth_business_id() TO authenticated, service_role;

-- 2. get_auth_role: Lock down to authenticated and service_role
REVOKE EXECUTE ON FUNCTION public.get_auth_role() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_auth_role() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_auth_role() TO authenticated, service_role;

