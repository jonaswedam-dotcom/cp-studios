-- Migration 007: Leaderboard fix
-- ─────────────────────────────────────────────────────────────────────────────
-- Root cause: the casino leaderboard was querying `pending_users` for display
-- names.  The `pending_users` SELECT policy is restricted to "owner or admin",
-- so non-admin users only received their own row and everyone else showed as
-- "Player".
--
-- Fix: the leaderboard now queries `profiles` (which stores full_name) instead.
-- The profiles SELECT policy already exists from migration 001, but we
-- drop-and-recreate it here using the explicit `TO authenticated` syntax so it
-- is guaranteed to be present and uses the recommended form.
-- ─────────────────────────────────────────────────────────────────────────────

-- Recreate the profiles SELECT policy with explicit role binding
DROP POLICY IF EXISTS "authenticated can read profiles" ON public.profiles;

CREATE POLICY "authenticated can read profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);
