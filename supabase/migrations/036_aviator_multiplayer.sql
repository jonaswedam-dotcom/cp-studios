-- Migration 036: Multiplayer Aviator
-- Rounds run 24/7 via pg_cron. Clients subscribe via Realtime.
-- Financial logic is server-authoritative (SECURITY DEFINER functions).

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.aviator_rounds (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  status      text        NOT NULL DEFAULT 'waiting'
                          CHECK (status IN ('waiting', 'flying', 'crashed')),
  started_at  timestamptz,
  crashed_at  timestamptz,
  crash_point numeric,        -- NULL until status = 'crashed'
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- crash_point and crash_at are never exposed to clients
CREATE TABLE IF NOT EXISTS public.aviator_round_secrets (
  round_id    uuid        PRIMARY KEY REFERENCES public.aviator_rounds ON DELETE CASCADE,
  crash_point numeric     NOT NULL,
  crash_at    timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS public.aviator_bets (
  id                 uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id           uuid    NOT NULL REFERENCES public.aviator_rounds ON DELETE CASCADE,
  user_id            uuid    NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  display_name       text    NOT NULL,
  bet_amount         integer NOT NULL CHECK (bet_amount > 0),
  cashout_multiplier numeric,
  payout             integer,
  status             text    NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'cashed_out', 'lost')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, user_id)
);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.aviator_rounds        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aviator_round_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aviator_bets          ENABLE ROW LEVEL SECURITY;

-- aviator_rounds: clients can read all rows, no direct writes
DROP POLICY IF EXISTS "aviator_rounds_select" ON public.aviator_rounds;
CREATE POLICY "aviator_rounds_select"
  ON public.aviator_rounds FOR SELECT
  USING (auth.role() = 'authenticated');

-- aviator_round_secrets: no policies = deny all client access (SECURITY DEFINER bypasses)

-- aviator_bets: all authenticated can read (live feed); users write own rows
DROP POLICY IF EXISTS "aviator_bets_select" ON public.aviator_bets;
DROP POLICY IF EXISTS "aviator_bets_insert" ON public.aviator_bets;
CREATE POLICY "aviator_bets_select"
  ON public.aviator_bets FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY "aviator_bets_insert"
  ON public.aviator_bets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ── Realtime ──────────────────────────────────────────────────────────────────
-- Wrapped in exception handlers so the migration is safe to re-run.
-- Also enable both tables in Supabase dashboard → Database → Replication.

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.aviator_rounds;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.aviator_bets;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Helper: create a new waiting round ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.aviator_create_round()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_round_id   uuid;
  v_u          numeric;
  v_crash_pt   numeric;
  v_crash_secs numeric;
  v_crash_at   timestamptz;
BEGIN
  -- Match generateCrash() in aviatorTrajectory.js:
  -- 5% → 1.0, else max(1.01, 1/(1 - u*0.95)) capped at 100
  IF random() < 0.05 THEN
    v_crash_pt := 1.0;
  ELSE
    v_u        := random();
    v_crash_pt := LEAST(100.0, GREATEST(1.01, 1.0 / (1.0 - v_u * 0.95)));
  END IF;

  -- Time to reach crash_point from takeoff: ln(m) / GROWTH_RATE (0.15)
  v_crash_secs := ln(GREATEST(v_crash_pt, 1.001)) / 0.15;

  -- crash_at = now + 15s betting window + flight time
  v_crash_at := now()
    + interval '15 seconds'
    + make_interval(secs := v_crash_secs);

  INSERT INTO public.aviator_rounds (status, created_at)
  VALUES ('waiting', now())
  RETURNING id INTO v_round_id;

  INSERT INTO public.aviator_round_secrets (round_id, crash_point, crash_at)
  VALUES (v_round_id, v_crash_pt, v_crash_at);

  RETURN v_round_id;
END;
$$;

-- ── Place a bet (called by authenticated client via supabase.rpc) ─────────────

CREATE OR REPLACE FUNCTION public.place_aviator_bet(
  p_round_id     uuid,
  p_amount       integer,
  p_display_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      uuid := auth.uid();
  v_round_status text;
  v_wallet_bal   integer;
  v_bet_id       uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'bet amount must be positive';
  END IF;

  SELECT status INTO v_round_status
  FROM public.aviator_rounds
  WHERE id = p_round_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'round not found';
  END IF;
  IF v_round_status <> 'waiting' THEN
    RAISE EXCEPTION 'round is not accepting bets';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.aviator_bets
    WHERE round_id = p_round_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'already placed a bet on this round';
  END IF;

  SELECT balance INTO v_wallet_bal
  FROM public.wallets
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF v_wallet_bal IS NULL OR v_wallet_bal < p_amount THEN
    RAISE EXCEPTION 'insufficient balance';
  END IF;

  UPDATE public.wallets
  SET balance = balance - p_amount
  WHERE user_id = v_user_id;

  INSERT INTO public.aviator_bets (round_id, user_id, display_name, bet_amount)
  VALUES (p_round_id, v_user_id, p_display_name, p_amount)
  RETURNING id INTO v_bet_id;

  RETURN v_bet_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_aviator_bet(uuid, integer, text) TO authenticated;

-- ── Cash out a bet (source of truth: crash_at from secrets) ──────────────────

CREATE OR REPLACE FUNCTION public.cashout_aviator(p_bet_id uuid)
RETURNS TABLE (
  success            boolean,
  payout             integer,
  cashout_multiplier numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_bet     public.aviator_bets%ROWTYPE;
  v_round   public.aviator_rounds%ROWTYPE;
  v_secret  public.aviator_round_secrets%ROWTYPE;
  v_now     timestamptz := now();
  v_elapsed numeric;
  v_mult    numeric;
  v_payout  integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_bet FROM public.aviator_bets
  WHERE id = p_bet_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bet not found';
  END IF;
  IF v_bet.status <> 'active' THEN
    RETURN QUERY SELECT false, 0, 1.0::numeric;
    RETURN;
  END IF;

  SELECT * INTO v_round FROM public.aviator_rounds
  WHERE id = v_bet.round_id
  FOR UPDATE;

  IF v_round.status = 'crashed' THEN
    UPDATE public.aviator_bets SET status = 'lost' WHERE id = p_bet_id;
    RETURN QUERY SELECT false, 0, 1.0::numeric;
    RETURN;
  END IF;

  IF v_round.status <> 'flying' THEN
    -- waiting or unknown status — don't mark lost, just reject
    RETURN QUERY SELECT false, 0, 1.0::numeric;
    RETURN;
  END IF;

  SELECT * INTO v_secret FROM public.aviator_round_secrets
  WHERE round_id = v_bet.round_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'round secret not found';
  END IF;

  -- Reject if crash_at has passed (even if cron hasn't updated status yet)
  IF v_now >= v_secret.crash_at THEN
    UPDATE public.aviator_bets SET status = 'lost' WHERE id = p_bet_id;
    RETURN QUERY SELECT false, 0, 1.0::numeric;
    RETURN;
  END IF;

  -- Valid cashout: compute multiplier from elapsed flight time
  -- m = exp(GROWTH_RATE * t) where GROWTH_RATE = 0.15 (matches aviatorTrajectory.js)
  v_elapsed := EXTRACT(EPOCH FROM (v_now - v_round.started_at));
  v_mult    := EXP(0.15 * GREATEST(0.0, v_elapsed));
  v_payout  := FLOOR(v_bet.bet_amount::numeric * v_mult)::integer;

  UPDATE public.aviator_bets
  SET status             = 'cashed_out',
      cashout_multiplier = v_mult,
      payout             = v_payout
  WHERE id = p_bet_id;

  -- Delta write — safe with concurrent donations/bets
  UPDATE public.wallets
  SET balance = balance + v_payout
  WHERE user_id = v_user_id;

  RETURN QUERY SELECT true, v_payout, v_mult;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cashout_aviator(uuid) TO authenticated;

-- ── Cron tick: advances round lifecycle ──────────────────────────────────────
-- Scheduled every minute. Internally runs 5 sub-ticks × 12-second sleep
-- giving ~12-second resolution throughout the minute.
-- Advisory lock prevents overlapping invocations.

CREATE OR REPLACE FUNCTION public.aviator_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_round_id  uuid;
  v_crash_pt  numeric;
  v_crash_at  timestamptz;
  v_iter      int;
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('aviator-tick')::bigint) THEN
    RETURN;
  END IF;

  FOR v_iter IN 1..5 LOOP

    -- 1. Bootstrap: ensure there is always an active round
    IF NOT EXISTS (
      SELECT 1 FROM public.aviator_rounds WHERE status IN ('waiting', 'flying')
    ) THEN
      PERFORM public.aviator_create_round();
    END IF;

    -- 2. Transition waiting → flying (15-second betting window)
    UPDATE public.aviator_rounds
    SET    status = 'flying', started_at = now()
    WHERE  status = 'waiting'
      AND  created_at + interval '15 seconds' <= now();

    -- 3. Transition flying → crashed when crash_at has passed
    SELECT ar.id, s.crash_point, s.crash_at
    INTO   v_round_id, v_crash_pt, v_crash_at
    FROM   public.aviator_rounds ar
    JOIN   public.aviator_round_secrets s ON s.round_id = ar.id
    WHERE  ar.status = 'flying'
      AND  s.crash_at <= now()
    LIMIT  1;

    IF v_round_id IS NOT NULL THEN
      UPDATE public.aviator_rounds
      SET    status      = 'crashed',
             crashed_at  = now(),
             crash_point = v_crash_pt   -- reveal to clients via Realtime
      WHERE  id = v_round_id;

      UPDATE public.aviator_bets
      SET    status = 'lost'
      WHERE  round_id = v_round_id AND status = 'active';

      v_round_id := NULL;
    END IF;

    -- 4. Create next waiting round 3 seconds after crash
    IF NOT EXISTS (
      SELECT 1 FROM public.aviator_rounds WHERE status IN ('waiting', 'flying')
    ) AND EXISTS (
      SELECT 1 FROM public.aviator_rounds
      WHERE  status = 'crashed'
        AND  crashed_at + interval '3 seconds' <= now()
    ) THEN
      PERFORM public.aviator_create_round();
    END IF;

    IF v_iter < 5 THEN
      PERFORM pg_sleep(12);
    END IF;

  END LOOP;

  PERFORM pg_advisory_unlock(hashtext('aviator-tick')::bigint);
END;
$$;

-- ── Schedule ──────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('aviator-tick')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aviator-tick');

SELECT cron.schedule('aviator-tick', '* * * * *', $$ SELECT public.aviator_tick(); $$);
