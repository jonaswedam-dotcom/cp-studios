-- Migration 012: Denormalise display_name into wallets
-- ─────────────────────────────────────────────────────────────────────────────
-- Root cause of "Player" bug: the get_wallet_players() JOIN targets
-- profiles.user_id, but every profile row has user_id = NULL (CreateProfilePage
-- sets it explicitly to null).  The JOIN therefore always returns nothing, so
-- the COALESCE falls back to 'Player' every time.
--
-- Fix: store display_name directly in wallets so the leaderboard and Send-Coins
-- modal never need to touch the profiles table at all.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add the column (idempotent)
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS display_name text;

-- 2. Backfill existing rows from auth.users metadata.
--    raw_user_meta_data->>'full_name' is the value set during signUp()
--    and updated by supabase.auth.updateUser().
UPDATE public.wallets w
SET    display_name = u.raw_user_meta_data->>'full_name'
FROM   auth.users u
WHERE  w.user_id = u.id
  AND (w.display_name IS NULL OR w.display_name = '');

-- 3. Retire the defunct get_wallet_players RPC — code no longer calls it.
DROP FUNCTION IF EXISTS public.get_wallet_players();
