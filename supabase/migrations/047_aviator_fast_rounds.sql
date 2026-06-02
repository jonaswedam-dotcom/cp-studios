-- Migration 047: Aviator – fast round lifecycle
--
-- Root cause of all bugs: aviator_tick() called pg_sleep(12) × 5 = 60 s inside
-- one transaction.  Supabase statement_timeout fires at ~8 s, so pg_sleep aborts
-- the whole tx.  Worse, the UPDATEs that ran BEFORE the sleep held exclusive row
-- locks on the round for the full sleep duration, blocking every cashout_aviator
-- call with "canceling statement due to statement timeout".
--
-- Fix: single-pass aviator_advance_round() with no sleep.  Clients call it every
-- second so rounds crash within ~1 s of their scheduled time.  The cron job
-- remains as a fallback in case all clients disconnect.
--
-- Also reduces the betting window from 15 s to 5 s.

-- ── 1. Rebuild aviator_create_round with 5-second betting window ─────────────

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
  IF random() < 0.05 THEN
    v_crash_pt := 1.0;
  ELSE
    v_u        := random();
    v_crash_pt := LEAST(100.0, GREATEST(1.01, 1.0 / (1.0 - v_u * 0.95)));
  END IF;

  v_crash_secs := ln(GREATEST(v_crash_pt, 1.001)) / 0.15;

  -- 5-second betting window (was 15)
  v_crash_at := now()
    + interval '5 seconds'
    + make_interval(secs := v_crash_secs);

  INSERT INTO public.aviator_rounds (status, created_at)
  VALUES ('waiting', now())
  RETURNING id INTO v_round_id;

  INSERT INTO public.aviator_round_secrets (round_id, crash_point, crash_at)
  VALUES (v_round_id, v_crash_pt, v_crash_at);

  RETURN v_round_id;
END;
$$;

-- ── 2. Single-pass advance function (called by clients every second) ─────────

CREATE OR REPLACE FUNCTION public.aviator_advance_round()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_round_id uuid;
  v_crash_pt numeric;
BEGIN
  -- Only one caller executes the body at a time; others return immediately.
  -- pg_try_advisory_xact_lock is released automatically when the tx ends —
  -- no sleeping means the lock is held for milliseconds only.
  IF NOT pg_try_advisory_xact_lock(hashtext('aviator-advance')::bigint) THEN
    RETURN;
  END IF;

  -- 1. Bootstrap: ensure an active round always exists
  IF NOT EXISTS (
    SELECT 1 FROM public.aviator_rounds WHERE status IN ('waiting', 'flying')
  ) THEN
    PERFORM public.aviator_create_round();
  END IF;

  -- 2. Transition waiting → flying (5-second betting window)
  --    Re-anchor crash_at from the actual takeoff timestamp
  WITH newly_flying AS (
    UPDATE public.aviator_rounds
    SET    status = 'flying', started_at = now()
    WHERE  status = 'waiting'
      AND  created_at + interval '5 seconds' <= now()
    RETURNING id
  )
  UPDATE public.aviator_round_secrets s
  SET    crash_at = now() + make_interval(secs := ln(GREATEST(s.crash_point, 1.001)) / 0.15)
  FROM   newly_flying f
  WHERE  s.round_id = f.id;

  -- 3. Transition flying → crashed when crash_at has passed
  SELECT ar.id, s.crash_point
  INTO   v_round_id, v_crash_pt
  FROM   public.aviator_rounds ar
  JOIN   public.aviator_round_secrets s ON s.round_id = ar.id
  WHERE  ar.status = 'flying'
    AND  s.crash_at <= now()
  LIMIT  1;

  IF v_round_id IS NOT NULL THEN
    UPDATE public.aviator_rounds
    SET    status      = 'crashed',
           crashed_at  = now(),
           crash_point = v_crash_pt
    WHERE  id = v_round_id;

    UPDATE public.aviator_bets
    SET    status = 'lost'
    WHERE  round_id = v_round_id AND status = 'active';
  END IF;

  -- 4. Create next round 3 seconds after crash
  IF NOT EXISTS (
    SELECT 1 FROM public.aviator_rounds WHERE status IN ('waiting', 'flying')
  ) AND EXISTS (
    SELECT 1 FROM public.aviator_rounds
    WHERE  status = 'crashed'
      AND  crashed_at + interval '3 seconds' <= now()
  ) THEN
    PERFORM public.aviator_create_round();
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.aviator_advance_round() TO authenticated;

-- ── 3. Redirect cron tick to the single-pass function ────────────────────────

CREATE OR REPLACE FUNCTION public.aviator_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.aviator_advance_round();
END;
$$;
