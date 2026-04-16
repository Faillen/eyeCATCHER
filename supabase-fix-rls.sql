-- =============================================
-- eyeCATCHER RLS Fix Migration
-- Run this in your Supabase SQL Editor AFTER the initial migration
-- (Dashboard -> SQL Editor -> New Query -> Paste & Run)
--
-- This fixes infinite recursion in RLS policies where admin policies
-- on the profiles table queried the profiles table itself.
-- =============================================

-- 1. Create helper function that bypasses RLS to check admin role
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT role INTO user_role FROM public.profiles WHERE id = auth.uid();
  RETURN user_role = 'admin';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 2. Drop old recursive policies
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can view all sessions" ON sessions;
DROP POLICY IF EXISTS "Admins can view all screen time" ON screen_time_logs;
DROP POLICY IF EXISTS "Admins can manage tips" ON eye_care_tips;
DROP POLICY IF EXISTS "Admins can manage config" ON system_config;

-- 3. Recreate policies using the helper function (no recursion)
CREATE POLICY "Admins can view all profiles" ON profiles
  FOR SELECT USING (public.is_admin());

CREATE POLICY "Admins can view all sessions" ON sessions
  FOR SELECT USING (public.is_admin());

CREATE POLICY "Admins can view all screen time" ON screen_time_logs
  FOR SELECT USING (public.is_admin());

CREATE POLICY "Admins can manage tips" ON eye_care_tips
  FOR ALL USING (public.is_admin());

CREATE POLICY "Admins can manage config" ON system_config
  FOR ALL USING (public.is_admin());
