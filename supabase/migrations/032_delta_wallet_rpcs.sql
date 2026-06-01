-- Migration 032: Delta-based wallet RPCs
-- ─────────────────────────────────────────────────────────────────────────────
-- Root cause of the "sent coins disappear" bug:
--
-- donate_coins (migration 007) writes the recipient's balance as a DELTA:
--   SET balance = balance + p_amount
--
-- But placeBet / adjustBalance / loadBalance-daily-bonus / claimAdReward in
-- CasinoContext.jsx all write the balance as an ABSOLUTE value computed from
-- a locally-cached snapshot (balanceRef.current).  If an incoming donation
-- lands between when that snapshot was taken and when the write fires, the
-- absolute write overwrites the post-donation balance with a stale value,
-- silently destroying the credited coins.
--
-- Fix: replace every absolute client-side balance write with a delta RPC that
-- applies the change relative to whatever the current DB balance is.  The local
-- React state still updates optimistically for instant UI feedback, then
-- reconciles with the DB-returned actual balance when the RPC resolves.
-- ─────────────────────────────────────────────────────────────────────────────

-- settle_bet: applies a bet outcome as a delta + inserts game_history atomically.
-- Returns the actual new balance so the caller can reconcile local state.
CREATE OR REPLACE FUNCTION public.settle_bet(
  p_game       text,
  p_bet        integer,
  p_result     text,
  p_payout     integer,
  p_win_amount integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id     uuid    := auth.uid();
  v_new_balance integer;
BEGIN
  UPDATE wallets
  SET    balance = GREATEST(0, balance + p_win_amount)
  WHERE  user_id = v_user_id
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  INSERT INTO game_history (user_id, game, bet, result, payout)
  VALUES (v_user_id, p_game, p_bet, p_result, p_payout);

  RETURN v_new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_bet(text, integer, text, integer, integer) TO authenticated;


-- apply_balance_delta: generic delta balance adjustment.
-- Used by war unit purchases, building upgrades, and any other non-game spend.
-- Returns the actual new balance.
CREATE OR REPLACE FUNCTION public.apply_balance_delta(p_delta integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id     uuid    := auth.uid();
  v_new_balance integer;
BEGIN
  UPDATE wallets
  SET    balance = GREATEST(0, balance + p_delta)
  WHERE  user_id = v_user_id
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  RETURN v_new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_balance_delta(integer) TO authenticated;


-- claim_daily_bonus: idempotent 24-hour bonus application.
-- Applies the +100 delta only if the bonus hasn't been claimed in the last 24 h.
-- Returns the actual balance and whether the bonus was just applied.
CREATE OR REPLACE FUNCTION public.claim_daily_bonus()
RETURNS TABLE (balance integer, bonus_applied boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid    := auth.uid();
  v_balance integer;
  v_applied boolean := false;
BEGIN
  UPDATE wallets
  SET    balance          = balance + 100,
         last_daily_bonus = now()
  WHERE  user_id          = v_user_id
    AND  (last_daily_bonus IS NULL OR last_daily_bonus < now() - interval '24 hours')
  RETURNING wallets.balance INTO v_balance;

  IF FOUND THEN
    v_applied := true;
  ELSE
    -- Bonus already claimed today — return current balance unchanged
    SELECT wallets.balance INTO v_balance
    FROM   wallets
    WHERE  user_id = v_user_id;
  END IF;

  RETURN QUERY SELECT v_balance, v_applied;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_daily_bonus() TO authenticated;


-- settle_ad_reward: credits an ad reward as a delta + updates tracking columns atomically.
-- Returns the actual new balance.
CREATE OR REPLACE FUNCTION public.settle_ad_reward(
  p_reward_amount    integer,
  p_last_ad_reward   timestamptz,
  p_ad_rewards_date  text,
  p_ad_rewards_count integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id     uuid    := auth.uid();
  v_new_balance integer;
BEGIN
  UPDATE wallets
  SET    balance          = balance + p_reward_amount,
         last_ad_reward   = p_last_ad_reward,
         ad_rewards_date  = p_ad_rewards_date,
         ad_rewards_count = p_ad_rewards_count
  WHERE  user_id = v_user_id
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  RETURN v_new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_ad_reward(integer, timestamptz, text, integer) TO authenticated;
