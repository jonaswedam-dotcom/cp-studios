-- Migration 057: Return crash_at from aviator_solo_begin
--
-- The client previously had no way to know when the server-side crash would
-- occur, so the plane kept flying visually past the crash point. Players would
-- see the plane still moving, try to cash out, and lose because the server had
-- already registered the crash.
--
-- Fix: return crash_at (the exact UTC timestamp when the crash multiplier will
-- be reached). The client uses this to:
--   1. Sync its flight clock to the server (eliminate the network-latency offset)
--   2. Schedule the crash animation to fire at precisely the right moment
--
-- crash_at = started_at + ln(crash_point) / GROWTH_RATE
-- GROWTH_RATE = 0.15 (must stay in sync with aviatorTrajectory.js GROWTH_RATE)
--
-- Note: crash_at lets a player derive the crash multiplier via
--   multiplier = exp(0.15 * (crash_at - started_at))
-- This is acceptable for this private app — the crash point cannot be changed,
-- only timed more precisely, which a player could do by watching the multiplier anyway.

-- Postgres requires DROP before CREATE OR REPLACE when the return type changes.
DROP FUNCTION IF EXISTS public.aviator_solo_begin(integer);

CREATE OR REPLACE FUNCTION public.aviator_solo_begin(p_bet integer)
RETURNS TABLE (round_id uuid, started_at timestamptz, new_balance integer, crash_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid        := auth.uid();
  v_balance integer;
  v_crash   numeric;
  v_u       numeric;
  v_id      uuid;
  v_now     timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_bet <= 0         THEN RAISE EXCEPTION 'bet must be positive'; END IF;

  -- Abandon any stale flying rounds (safety net for page reloads mid-round)
  UPDATE public.aviator_solo_rounds
  SET status = 'crashed'
  WHERE user_id = v_user_id AND status = 'flying';

  SELECT balance INTO v_balance
  FROM public.wallets WHERE user_id = v_user_id FOR UPDATE;

  IF v_balance IS NULL OR v_balance < p_bet THEN
    RAISE EXCEPTION 'insufficient balance';
  END IF;

  -- Server-side crash point — same distribution as the old client generateCrash():
  -- 5% chance of instant bust (1.0×), otherwise heavy-tailed, capped at 100×.
  IF random() < 0.05 THEN
    v_crash := 1.0;
  ELSE
    v_u     := random();
    v_crash := LEAST(100.0, GREATEST(1.01, ROUND((1.0 / (1.0 - v_u * 0.95))::numeric, 2)));
  END IF;

  UPDATE public.wallets SET balance = balance - p_bet WHERE user_id = v_user_id;

  INSERT INTO public.aviator_solo_rounds (user_id, bet_amount, crash_point, started_at)
  VALUES (v_user_id, p_bet, v_crash, v_now)
  RETURNING id INTO v_id;

  RETURN QUERY
    SELECT v_id,
           v_now,
           (SELECT balance FROM public.wallets WHERE user_id = v_user_id)::integer,
           -- Exact moment the crash multiplier will be reached on the server clock.
           -- For instant bust (crash_point = 1.0): ln(1.0) = 0, so crash_at = started_at.
           v_now + make_interval(secs => LN(v_crash::float8) / 0.15);
END;
$$;

GRANT EXECUTE ON FUNCTION public.aviator_solo_begin(integer) TO authenticated;
