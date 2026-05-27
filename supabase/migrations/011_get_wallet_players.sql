-- Migration 011: SECURITY DEFINER RPC for wallet + profile name lookup
-- ─────────────────────────────────────────────────────────────────────────────
-- Root cause: the Send Coins modal (and leaderboard) join wallets with profiles
-- client-side after two separate queries.  The profiles SELECT policy has been
-- tweaked repeatedly (migrations 008, 009) but RLS conflicts still block the
-- profiles query, so names fall back to "Player".
--
-- Fix: a single SECURITY DEFINER function that performs the LEFT JOIN inside
-- Postgres, bypassing all RLS policies in a controlled way.  The same pattern
-- is already used by donate_coins (migration 007).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_wallet_players()
RETURNS TABLE (
  user_id   uuid,
  balance   integer,
  full_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    w.user_id,
    w.balance,
    COALESCE(p.full_name, 'Player') AS full_name
  FROM   wallets  w
  LEFT JOIN profiles p ON p.user_id = w.user_id
  ORDER  BY w.balance DESC
  LIMIT  50;
$$;

-- Allow any logged-in user to call this function
GRANT EXECUTE ON FUNCTION public.get_wallet_players() TO authenticated;
