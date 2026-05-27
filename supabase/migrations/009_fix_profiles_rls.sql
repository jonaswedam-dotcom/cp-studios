-- Migration 009: Fix profiles RLS so all authenticated users can read all rows
-- ─────────────────────────────────────────────────────────────────────────────
-- Previous attempts used "TO authenticated USING (true)" which is equivalent
-- but may have failed if the old policy was not cleanly removed first.
-- This migration drops every known SELECT policy variant on profiles and
-- creates a single, explicit policy using auth.role() = 'authenticated'.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop every SELECT policy variant that may exist under any name
DROP POLICY IF EXISTS "authenticated can read profiles"            ON public.profiles;
DROP POLICY IF EXISTS "anyone authenticated can read all profiles" ON public.profiles;

-- Catch-all: drop any remaining SELECT policies by querying pg_policies
DO $$
DECLARE
  pol text;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM   pg_policies
    WHERE  schemaname = 'public'
      AND  tablename  = 'profiles'
      AND  cmd        = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', pol);
  END LOOP;
END $$;

-- Create the definitive read-all policy
create policy "anyone authenticated can read all profiles"
  on public.profiles for select
  using (auth.role() = 'authenticated');
