-- Migration 014: Fix wallets SELECT policy so authenticated users can read all rows
-- ─────────────────────────────────────────────────────────────────────────────
-- Root cause: migration 005 created the SELECT policy using the role-binding
-- syntax ("TO authenticated USING (true)").  Every other working policy in this
-- project uses the expression syntax ("USING (auth.role() = 'authenticated')").
-- Migration 009 documented and fixed the identical pattern on the profiles table.
-- The role-binding form is silently ineffective in this Supabase deployment, so
-- the wallets query returns 0 rows for all users → "No other players found".
--
-- Fix: drop the broken policy and replace it with the proven expression syntax,
-- matching the pattern used on profiles (migrations 008 / 009).
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "wallets_select_authenticated" ON public.wallets;

CREATE POLICY "authenticated can read all wallets"
  ON public.wallets FOR SELECT
  USING (auth.role() = 'authenticated');
