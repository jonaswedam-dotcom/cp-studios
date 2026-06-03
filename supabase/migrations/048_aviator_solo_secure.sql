-- Migration 048: Server-authoritative single-player Aviator
--
-- Previously the crash point was generated client-side via Math.random(), so any
-- player could open the browser console and type:
--   Math.random = () => 0.999
-- to guarantee a high crash point and cash out just before it.
--
-- Fix: crash point is now generated inside a SECURITY DEFINER function.
-- The client never receives it — only the server knows when the plane crashes.
-- The client calls aviator_solo_cashout() to settle, and the server uses
-- its own clock (now() - started_at) to compute the authoritative multiplier.

CREATE TABLE IF NOT EXISTS public.aviator_solo_rounds (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  bet_amount  integer     NOT NULL CHECK (bet_amount > 0),
  crash_point numeric     NOT NULL,          -- never exposed to clients
  started_at  timestamptz NOT NULL DEFAULT now(),
  status      text        NOT NULL DEFAULT 'flying'
                          CHECK (status IN ('flying', 'cashed_out', 'crashed')),
  cashout_multiplier numeric,
  payout      integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.aviator_solo_rounds ENABLE ROW LEVEL SECURITY;

-- Users can only read their own rows (crash_point is in this table but
-- Supabase RLS means they can only query rows where user_id = auth.uid(),
-- and the client code never selects crash_point).
DROP POLICY IF EXISTS "aviator_solo_own" ON public.aviator_solo_rounds;
CREATE POLICY "aviator_solo_own" ON public.aviator_solo_rounds
  FOR ALL USING (auth.uid() = user_id);

-- ── aviator_solo_begin ────────────────────────────────────────────────────────
-- Called when the player clicks "Fly!". Deducts the bet and generates the crash
-- point server-side. Returns the round id and server timestamp (for elapsed
-- time sync) but NOT the crash point.

CREATE OR REPLACE FUNCTION public.aviator_solo_begin(p_bet integer)
RETURNS TABLE (round_id uuid, started_at timestamptz, new_balance integer)
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
           (SELECT balance FROM public.wallets WHERE user_id = v_user_id)::integer;
END;
$$;

GRANT EXECUTE ON FUNCTION public.aviator_solo_begin(integer) TO authenticated;

-- ── aviator_solo_cashout ──────────────────────────────────────────────────────
-- Called when the player clicks "CASH OUT" (or the client auto-settles after
-- the maximum possible flight time). The server computes the authoritative
-- multiplier from elapsed time and compares it to the stored crash point.
-- Returns whether the cashout succeeded plus the revealed crash point.

CREATE OR REPLACE FUNCTION public.aviator_solo_cashout(p_round_id uuid)
RETURNS TABLE (
  success     boolean,
  payout      integer,
  multiplier  numeric,
  crash_point numeric,
  new_balance integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_round   public.aviator_solo_rounds%ROWTYPE;
  v_elapsed numeric;
  v_mult    numeric;
  v_payout  integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO v_round
  FROM public.aviator_solo_rounds
  WHERE id = p_round_id AND user_id = v_user_id AND status = 'flying'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'round not found or already settled';
  END IF;

  -- Server-authoritative elapsed time and multiplier (GROWTH_RATE = 0.15)
  v_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_round.started_at)));
  v_mult    := ROUND(EXP(0.15 * v_elapsed)::numeric, 2);

  IF v_mult >= v_round.crash_point THEN
    -- Crashed — bet was already deducted at begin, no refund
    UPDATE public.aviator_solo_rounds SET status = 'crashed' WHERE id = p_round_id;
    RETURN QUERY
      SELECT false,
             0,
             v_round.crash_point,
             v_round.crash_point,
             (SELECT balance FROM public.wallets WHERE user_id = v_user_id)::integer;
    RETURN;
  END IF;

  -- Valid cashout: pay out bet × multiplier
  v_payout := FLOOR(v_round.bet_amount::numeric * v_mult)::integer;

  UPDATE public.aviator_solo_rounds
  SET status             = 'cashed_out',
      cashout_multiplier = v_mult,
      payout             = v_payout
  WHERE id = p_round_id;

  UPDATE public.wallets SET balance = balance + v_payout WHERE user_id = v_user_id;

  RETURN QUERY
    SELECT true,
           v_payout,
           v_mult,
           v_round.crash_point,
           (SELECT balance FROM public.wallets WHERE user_id = v_user_id)::integer;
END;
$$;

GRANT EXECUTE ON FUNCTION public.aviator_solo_cashout(uuid) TO authenticated;
