# Multiplayer Aviator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the solo Aviator game with a persistent multiplayer crash game where rounds run 24/7 driven by a Postgres cron function, all clients share the same round via Realtime, and all financial logic is server-authoritative.

**Architecture:** Three Postgres tables (`aviator_rounds`, `aviator_round_secrets`, `aviator_bets`) plus three SECURITY DEFINER functions handle all game state and money. A pg_cron job runs every minute and loops internally with `pg_sleep(12)` five times for ~12-second round-transition resolution. The React component subscribes to Realtime on both public tables, computes the local multiplier client-side via `exp(0.15 * elapsed)`, and calls RPCs to place bets and cash out.

**Tech Stack:** Supabase (Postgres, Realtime, pg_cron), React 18, existing `FlightBoard.jsx` + `aviatorTrajectory.js` (unchanged)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/036_aviator_multiplayer.sql` | All DB: tables, RLS, functions, cron, Realtime |
| Replace | `src/pages/casino/AviatorGame.jsx` | Full multiplayer component |
| Unchanged | `src/pages/casino/FlightBoard.jsx` | SVG board — no edits |
| Unchanged | `src/pages/casino/aviatorTrajectory.js` | Math — no edits |
| Unchanged | `src/App.jsx` | Route `/casino/aviator` stays |

---

## Task 1: Migration — Tables, RLS, Realtime

**Files:**
- Create: `supabase/migrations/036_aviator_multiplayer.sql`

- [ ] **Step 1.1: Create the migration file with tables and RLS**

Create `supabase/migrations/036_aviator_multiplayer.sql` with this exact content for the first section:

```sql
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
  created_at         timestamptz NOT NULL DEFAULT now()
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

ALTER PUBLICATION supabase_realtime ADD TABLE public.aviator_rounds;
ALTER PUBLICATION supabase_realtime ADD TABLE public.aviator_bets;
```

- [ ] **Step 1.2: Verify — run this section in Supabase SQL Editor**

Paste and run the SQL above. Then confirm with:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('aviator_rounds', 'aviator_round_secrets', 'aviator_bets');
-- Expected: 3 rows
```

---

## Task 2: Migration — Server Functions

**Files:**
- Modify: `supabase/migrations/036_aviator_multiplayer.sql` (append)

- [ ] **Step 2.1: Append `aviator_create_round()` to the migration file**

```sql
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
```

- [ ] **Step 2.2: Append `place_aviator_bet()` to the migration file**

```sql
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
```

- [ ] **Step 2.3: Append `cashout_aviator()` to the migration file**

```sql
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

  IF v_round.status <> 'flying' THEN
    UPDATE public.aviator_bets SET status = 'lost' WHERE id = p_bet_id;
    RETURN QUERY SELECT false, 0, 1.0::numeric;
    RETURN;
  END IF;

  SELECT * INTO v_secret FROM public.aviator_round_secrets
  WHERE round_id = v_bet.round_id;

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
```

- [ ] **Step 2.4: Verify the functions**

Run in Supabase SQL Editor:
```sql
-- Bootstrap a test round
SELECT public.aviator_create_round();

-- Confirm it was created
SELECT id, status, created_at FROM public.aviator_rounds ORDER BY created_at DESC LIMIT 1;
-- Expected: one row with status='waiting'

-- Confirm secrets were created
SELECT round_id, crash_point, crash_at FROM public.aviator_round_secrets ORDER BY round_id DESC LIMIT 1;
-- Expected: one row with a crash_point between 1.0 and 100.0
```

---

## Task 3: Migration — Tick Function + Cron

**Files:**
- Modify: `supabase/migrations/036_aviator_multiplayer.sql` (append)

- [ ] **Step 3.1: Append `aviator_tick()` to the migration file**

```sql
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
```

- [ ] **Step 3.2: Append cron schedule to the migration file**

```sql
-- ── Schedule ──────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('aviator-tick')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aviator-tick');

SELECT cron.schedule('aviator-tick', '* * * * *', $$ SELECT public.aviator_tick(); $$);
```

- [ ] **Step 3.3: Run the full migration in Supabase SQL Editor**

Run the entire `036_aviator_multiplayer.sql` file end-to-end. Confirm success with:
```sql
-- Cron job exists
SELECT jobname, schedule FROM cron.job WHERE jobname = 'aviator-tick';
-- Expected: 1 row, schedule = '* * * * *'

-- Round exists (bootstrap will have created one or tick will shortly)
-- Wait 30 seconds after running migration, then:
SELECT id, status, started_at, crash_point FROM public.aviator_rounds
ORDER BY created_at DESC LIMIT 3;
-- Expected: at least one row with status='waiting' or 'flying'
```

- [ ] **Step 3.4: Commit the migration file**

```bash
cd "/Users/jonaswedam/Desktop/Organizer AI/cp-studios"
git add supabase/migrations/036_aviator_multiplayer.sql
git commit -m "feat(aviator): migration 036 — multiplayer tables, RPCs, cron tick"
```

---

## Task 4: AviatorGame Component — Skeleton + Data Layer

**Files:**
- Replace: `src/pages/casino/AviatorGame.jsx`

The existing file is a solo game; replace it entirely. Build the component in stages — this task covers initial data fetch, Realtime subscriptions, and state shape. The UI in this task is just a loading indicator + raw JSON debug display; actual UI comes in Tasks 5–6.

- [ ] **Step 4.1: Write the new AviatorGame.jsx skeleton**

Replace the entire content of `src/pages/casino/AviatorGame.jsx`:

```jsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { GameLayout, BetChips, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../supabase'
import FlightBoard from './FlightBoard'
import { progress, GROWTH_RATE } from './aviatorTrajectory'

// ── Pill styling for crash history ───────────────────────────────────────────
function pillStyle(m) {
  if (m < 2)  return { color: '#f87171', borderColor: '#7f1d1d', background: '#2a1112' }
  if (m <= 5) return { color: '#fcd34d', borderColor: '#854d0e', background: '#2a210f' }
  return             { color: '#86efac', borderColor: '#14532d', background: '#0f2a18' }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AviatorGame() {
  const { balance, loadBalance } = useCasino()
  const { currentUser } = useApp()

  // ── Server state ──
  const [round,   setRound]   = useState(undefined)  // undefined=loading, null=none yet
  const [bets,    setBets]    = useState([])
  const [history, setHistory] = useState([])   // last 10 crash_points (numbers)

  // ── Player's bet in the current round ──
  const [myBet,    setMyBet]    = useState(null)   // aviator_bets row | null
  const [betAmount, setBetAmount] = useState(50)

  // ── Local multiplier (RAF, smooth) ──
  const [localMult,  setLocalMult]  = useState(1.0)
  const [countdown,  setCountdown]  = useState(15)

  // ── UI flags ──
  const [placing,         setPlacing]         = useState(false)
  const [cashing,         setCashing]         = useState(false)
  const [error,           setError]           = useState('')
  const [crashAnimating,  setCrashAnimating]  = useState(false)

  // ── Live cashout feed (flying phase) ──
  const [cashoutFeed, setCashoutFeed] = useState([])  // { display_name, mult, payout }[]

  const roundRef   = useRef(round)
  const rafRef     = useRef(null)
  roundRef.current = round

  // ── Initial data fetch ────────────────────────────────────────────────────
  const fetchCurrentRound = useCallback(async () => {
    const { data } = await supabase
      .from('aviator_rounds')
      .select('*')
      .in('status', ['waiting', 'flying'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setRound(data ?? null)
    if (data?.id) fetchBets(data.id)
  }, [])

  const fetchBets = useCallback(async (roundId) => {
    const { data } = await supabase
      .from('aviator_bets')
      .select('*')
      .eq('round_id', roundId)
    const rows = data ?? []
    setBets(rows)
    const mine = rows.find(b => b.user_id === currentUser?.id) ?? null
    setMyBet(mine)
  }, [currentUser?.id])

  const fetchHistory = useCallback(async () => {
    const { data } = await supabase
      .from('aviator_rounds')
      .select('crash_point')
      .eq('status', 'crashed')
      .not('crash_point', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10)
    setHistory((data ?? []).map(r => r.crash_point))
  }, [])

  useEffect(() => {
    fetchCurrentRound()
    fetchHistory()
  }, [fetchCurrentRound, fetchHistory])

  // ── Realtime subscriptions ────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('aviator-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aviator_rounds' },
        (payload) => handleRoundChange(payload))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aviator_bets' },
        (payload) => handleBetChange(payload))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id])

  const handleRoundChange = useCallback((payload) => {
    const updated = payload.new
    if (!updated) return

    setRound(prev => {
      // Accept this update if it's the active round or a new round
      if (!prev || prev.id === updated.id || updated.status === 'waiting') {
        return updated
      }
      return prev
    })

    if (updated.status === 'flying') {
      // New flying round — clear old bets
      setBets([])
      setMyBet(null)
      setCashoutFeed([])
      setLocalMult(1.0)
    }

    if (updated.status === 'crashed') {
      setCrashAnimating(true)
      fetchHistory()
      // After crash display, watch for the next waiting round
      setTimeout(async () => {
        setCrashAnimating(false)
        await fetchCurrentRound()
      }, 3500)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleBetChange = useCallback((payload) => {
    const updated = payload.new
    if (!updated) return

    setBets(prev => {
      const idx = prev.findIndex(b => b.id === updated.id)
      if (idx === -1) return [...prev, updated]
      const next = [...prev]
      next[idx] = updated
      return next
    })

    // Update myBet if it's the current user's
    if (updated.user_id === currentUser?.id) {
      setMyBet(updated)
      if (updated.status === 'cashed_out') {
        loadBalance()
      }
    }

    // Live cashout feed
    if (updated.status === 'cashed_out' && updated.cashout_multiplier) {
      setCashoutFeed(prev => [
        { display_name: updated.display_name, mult: updated.cashout_multiplier, payout: updated.payout, id: updated.id },
        ...prev,
      ].slice(0, 20))
    }
  }, [currentUser?.id, loadBalance])

  // ── RAF: smooth local multiplier during flying ────────────────────────────
  useEffect(() => {
    if (round?.status !== 'flying' || !round.started_at) return
    let active = true
    const tick = () => {
      if (!active) return
      const r = roundRef.current
      if (!r?.started_at) return
      const elapsed = (Date.now() - new Date(r.started_at).getTime()) / 1000
      setLocalMult(Math.exp(GROWTH_RATE * Math.max(0, elapsed)))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { active = false; cancelAnimationFrame(rafRef.current) }
  }, [round?.status, round?.started_at])

  // ── Countdown during waiting ──────────────────────────────────────────────
  useEffect(() => {
    if (round?.status !== 'waiting') { setCountdown(15); return }
    const iv = setInterval(() => {
      const elapsed = (Date.now() - new Date(round.created_at).getTime()) / 1000
      setCountdown(Math.max(0, Math.ceil(15 - elapsed)))
    }, 200)
    return () => clearInterval(iv)
  }, [round?.status, round?.created_at])

  // ── Cleanup RAF on unmount ────────────────────────────────────────────────
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  // ── Loading ───────────────────────────────────────────────────────────────
  if (round === undefined || balance === null) {
    return (
      <GameLayout title="Aviator">
        <div className="flex items-center justify-center h-48">
          <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        </div>
      </GameLayout>
    )
  }

  return (
    <GameLayout title="Aviator" wide>
      <div className="text-cp-muted text-sm p-4">
        Round: {round?.id?.slice(0, 8) ?? 'none'} | Status: {round?.status ?? '—'} | Mult: {localMult.toFixed(2)}× | Countdown: {countdown}s
      </div>
    </GameLayout>
  )
}
```

- [ ] **Step 4.2: Verify the component loads without errors**

```bash
cd "/Users/jonaswedam/Desktop/Organizer AI/cp-studios"
npm run dev
```

Open `http://localhost:5173/casino/aviator`. Expected: loading spinner briefly, then the debug line showing round status. No console errors. Round status should be `waiting` or `flying` (confirming cron has bootstrapped a round). If `round: none`, wait up to 15 seconds for the first cron tick.

- [ ] **Step 4.3: Commit skeleton**

```bash
git add src/pages/casino/AviatorGame.jsx
git commit -m "feat(aviator): component skeleton with Realtime subscriptions + data layer"
```

---

## Task 5: Waiting + Flying Phases — Full Game UI

**Files:**
- Modify: `src/pages/casino/AviatorGame.jsx`

- [ ] **Step 5.1: Add `placeBet` and `cashOut` action handlers**

Add these two functions inside the component, just before the `return` statement:

```jsx
  // ── Place bet ─────────────────────────────────────────────────────────────
  const handlePlaceBet = async () => {
    if (!round || round.status !== 'waiting') return
    if (!betAmount || betAmount < 1 || betAmount > (balance ?? 0)) return
    setPlacing(true)
    setError('')
    const { data, error: rpcErr } = await supabase.rpc('place_aviator_bet', {
      p_round_id:     round.id,
      p_amount:       betAmount,
      p_display_name: currentUser?.name ?? 'Player',
    })
    if (rpcErr) {
      setError(rpcErr.message ?? 'Could not place bet')
    } else {
      // Immediately reflect deduction; Realtime will confirm
      loadBalance()
    }
    setPlacing(false)
  }

  // ── Cash out ──────────────────────────────────────────────────────────────
  const handleCashOut = async () => {
    if (!myBet || myBet.status !== 'active') return
    if (round?.status !== 'flying') return
    setCashing(true)
    setError('')
    const { data, error: rpcErr } = await supabase.rpc('cashout_aviator', {
      p_bet_id: myBet.id,
    })
    if (rpcErr) {
      setError(rpcErr.message ?? 'Cash out failed')
    } else if (data?.[0]?.success === false) {
      setError('Too late — round crashed before your cashout landed')
    }
    // loadBalance() is called by handleBetChange when Realtime fires cashed_out
    setCashing(false)
  }
```

- [ ] **Step 5.2: Replace the `return` statement with the full game UI**

Replace everything from `return (` to the closing `}` of the component with:

```jsx
  // ── Derived display values ────────────────────────────────────────────────
  const isWaiting   = round?.status === 'waiting'
  const isFlying    = round?.status === 'flying'
  const isCrashed   = round?.status === 'crashed' || crashAnimating
  const hasBet      = myBet !== null
  const cashedOut   = myBet?.status === 'cashed_out'
  const lost        = myBet?.status === 'lost'

  // FlightBoard expects these phase strings
  const boardPhase  = isCrashed  ? 'crashed'
                    : cashedOut  ? 'cashedout'
                    : isFlying   ? 'flying'
                    :              'betting'

  const displayMult = isCrashed  ? (round?.crash_point ?? localMult)
                    : isFlying   ? localMult
                    :              1.0

  const liveWin     = hasBet && isFlying
    ? Math.floor(myBet.bet_amount * displayMult) - myBet.bet_amount
    : 0

  const canBet      = isWaiting && !hasBet && !placing && (balance ?? 0) >= betAmount && betAmount >= 1
  const canCashOut  = isFlying && hasBet && myBet.status === 'active' && !cashing

  return (
    <GameLayout title="Aviator" wide>
      <div className="flex flex-col lg:flex-row gap-5 items-start">

        {/* ── Left: game board ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">

          {/* Crash history pills */}
          {history.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {history.map((m, i) => {
                const s = pillStyle(m)
                return (
                  <span key={i} style={{ fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 999, border: `1px solid ${s.borderColor}`, color: s.color, background: s.background, flexShrink: 0 }}>
                    {m >= 100 ? `${Math.round(m)}×` : `${m.toFixed(2)}×`}
                  </span>
                )
              })}
            </div>
          )}

          {/* Flight board */}
          <div style={{ position: 'relative' }}>
            <FlightBoard
              phase={boardPhase}
              multiplier={displayMult}
              crashPoint={round?.crash_point ?? null}
              cashedOutAt={myBet?.cashout_multiplier ?? null}
              bet={myBet?.bet_amount ?? betAmount}
            />

            {/* Waiting overlay: countdown */}
            {isWaiting && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 6, pointerEvents: 'none',
              }}>
                <div style={{ fontSize: 13, color: '#78716c', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Next round in</div>
                <div style={{ fontSize: 48, fontWeight: 800, color: '#fde68a', lineHeight: 1, fontFamily: '"Playfair Display", Georgia, serif', textShadow: '0 0 28px rgba(251,191,36,0.4)' }}>{countdown}</div>
                {hasBet && (
                  <div style={{ fontSize: 13, color: '#34d399', fontWeight: 600 }}>
                    Bet placed — {formatCoins(myBet.bet_amount)} coins
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="px-4 py-2.5 rounded-xl bg-red-400/10 border border-red-400/25 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* ── Controls ── */}
          <div className="bg-cp-card border border-cp-border rounded-2xl p-4 flex flex-col gap-3">

            {/* Waiting: bet chips + place bet */}
            {isWaiting && !hasBet && (
              <>
                <BetChips bet={betAmount} onBet={setBetAmount} balance={balance ?? 0} />
                <button
                  onClick={handlePlaceBet}
                  disabled={!canBet}
                  className={`w-full py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
                    ${canBet
                      ? 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_24px_rgba(251,191,36,0.3)] active:scale-95'
                      : 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                    }`}
                >
                  {placing ? 'Placing…' : `Place Bet — ${formatCoins(betAmount)} coins`}
                </button>
              </>
            )}

            {/* Waiting: bet already placed */}
            {isWaiting && hasBet && (
              <div className="text-center py-3 rounded-xl bg-emerald-400/10 border border-emerald-400/25 text-emerald-400 font-semibold text-sm">
                Bet placed — waiting for takeoff ✈
              </div>
            )}

            {/* Flying: cash out */}
            {isFlying && hasBet && myBet.status === 'active' && (
              <button
                onClick={handleCashOut}
                disabled={!canCashOut}
                className="w-full py-3.5 rounded-2xl font-bold text-black text-lg tracking-wide transition-all active:scale-95"
                style={{
                  background: 'linear-gradient(135deg,#fbbf24,#f59e0b)',
                  boxShadow: '0 0 28px rgba(251,191,36,0.4)',
                  animation: 'aviatorPulse 1.1s ease-out infinite',
                }}
              >
                {cashing ? 'Cashing out…' : `CASH OUT  +${formatCoins(liveWin)}  ·  ${displayMult.toFixed(2)}×`}
              </button>
            )}

            {/* Flying: watching (no bet) */}
            {isFlying && !hasBet && (
              <div className="text-center py-3 rounded-xl bg-cp-elevated border border-cp-border text-cp-muted text-sm">
                Watching — place a bet next round
              </div>
            )}

            {/* Flying: already cashed out */}
            {isFlying && cashedOut && (
              <div className="text-center py-3 rounded-xl bg-emerald-400/10 border border-emerald-400/25 text-emerald-400 font-semibold text-sm">
                Cashed out at {Number(myBet.cashout_multiplier).toFixed(2)}× — won {formatCoins(myBet.payout)} coins 🎉
              </div>
            )}

            {/* Crashed: summary */}
            {isCrashed && myBet && (
              <div className={`text-center py-3 rounded-xl font-semibold text-sm ${
                cashedOut
                  ? 'bg-emerald-400/10 border border-emerald-400/25 text-emerald-400'
                  : 'bg-red-400/10 border border-red-400/25 text-red-400'
              }`}>
                {cashedOut
                  ? `Cashed out at ${Number(myBet.cashout_multiplier).toFixed(2)}× · +${formatCoins(myBet.payout)} coins`
                  : `Lost ${formatCoins(myBet.bet_amount)} coins`
                }
              </div>
            )}

            {/* Crashed: no bet */}
            {isCrashed && !myBet && (
              <div className="text-center py-2 text-cp-muted text-sm">
                Next round starting soon…
              </div>
            )}
          </div>
        </div>

        {/* ── Right: live feed ── */}
        <div className="w-full lg:w-64 flex-shrink-0 flex flex-col gap-3">
          <LiveFeed
            round={round}
            bets={bets}
            cashoutFeed={cashoutFeed}
            currentUserId={currentUser?.id}
          />
        </div>

      </div>

      <style>{`
        @keyframes aviatorPulse {
          0%   { box-shadow: 0 0 0 0 rgba(251,191,36,0.55) }
          70%  { box-shadow: 0 0 0 14px rgba(251,191,36,0) }
          100% { box-shadow: 0 0 0 0 rgba(251,191,36,0) }
        }
      `}</style>
    </GameLayout>
  )
}
```

- [ ] **Step 5.3: Add the `LiveFeed` component at the bottom of the file**

Add this after the closing `}` of `AviatorGame`:

```jsx
// ── Live Feed Panel ────────────────────────────────────────────────────────────
function LiveFeed({ round, bets, cashoutFeed, currentUserId }) {
  const isWaiting = round?.status === 'waiting'
  const isFlying  = round?.status === 'flying'
  const isCrashed = round?.status === 'crashed'

  const activeBets   = bets.filter(b => b.status === 'active')
  const cashedOutBets = bets.filter(b => b.status === 'cashed_out')
  const lostBets     = bets.filter(b => b.status === 'lost')

  return (
    <div className="bg-cp-card border border-cp-border rounded-2xl overflow-hidden flex flex-col" style={{ minHeight: 300 }}>
      <div className="px-4 py-3 border-b border-cp-border">
        <span className="text-xs font-semibold text-cp-muted uppercase tracking-wider">
          {isWaiting ? 'Players betting' : isFlying ? 'Live cashouts' : 'Round summary'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1" style={{ maxHeight: 400 }}>
        {/* Waiting: list of bets placed */}
        {isWaiting && bets.map(b => (
          <div key={b.id} className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs ${b.user_id === currentUserId ? 'bg-amber-400/10 border border-amber-400/20' : 'bg-cp-elevated'}`}>
            <span className="font-semibold text-cp-text truncate max-w-[100px]">{b.display_name}</span>
            <span className="text-cp-muted font-semibold tabular-nums">{b.bet_amount.toLocaleString()} 🪙</span>
          </div>
        ))}
        {isWaiting && bets.length === 0 && (
          <p className="text-cp-muted text-xs text-center py-6">No bets yet — be first!</p>
        )}

        {/* Flying: cashout feed */}
        {isFlying && cashoutFeed.map(e => (
          <div key={e.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-400/8 border border-emerald-400/15 text-xs" style={{ animation: 'feedIn 0.3s ease' }}>
            <span className="font-semibold text-emerald-400 truncate max-w-[100px]">{e.display_name}</span>
            <span className="text-cp-muted tabular-nums">{Number(e.mult).toFixed(2)}×</span>
          </div>
        ))}
        {isFlying && activeBets.length > 0 && (
          <div className="px-3 py-2 text-xs text-cp-muted/60 text-center">
            {activeBets.length} still flying…
          </div>
        )}
        {isFlying && cashoutFeed.length === 0 && activeBets.length === 0 && (
          <p className="text-cp-muted text-xs text-center py-6">Watching…</p>
        )}

        {/* Crashed: win/loss summary */}
        {isCrashed && (
          <>
            {cashedOutBets.length > 0 && (
              <>
                <div className="px-3 py-1 text-xs text-emerald-400/70 font-semibold uppercase tracking-wider">Won</div>
                {cashedOutBets.map(b => (
                  <div key={b.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-400/8 border border-emerald-400/15 text-xs">
                    <span className="font-semibold text-emerald-400 truncate max-w-[100px]">{b.display_name}</span>
                    <span className="text-emerald-300 tabular-nums">+{(b.payout ?? 0).toLocaleString()} 🪙</span>
                  </div>
                ))}
              </>
            )}
            {lostBets.length > 0 && (
              <>
                <div className="px-3 py-1 text-xs text-red-400/70 font-semibold uppercase tracking-wider mt-1">Lost</div>
                {lostBets.map(b => (
                  <div key={b.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-red-400/8 border border-red-400/15 text-xs">
                    <span className="font-semibold text-red-400/80 truncate max-w-[100px]">{b.display_name}</span>
                    <span className="text-red-400/60 tabular-nums">-{b.bet_amount.toLocaleString()} 🪙</span>
                  </div>
                ))}
              </>
            )}
            {bets.length === 0 && (
              <p className="text-cp-muted text-xs text-center py-6">No bets this round</p>
            )}
          </>
        )}
      </div>

      <style>{`
        @keyframes feedIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}
```

- [ ] **Step 5.4: Build check**

```bash
cd "/Users/jonaswedam/Desktop/Organizer AI/cp-studios"
npm run build 2>&1 | tail -8
```
Expected: `✓ built in X.XXs` with no errors.

- [ ] **Step 5.5: Manual smoke test**

```bash
npm run dev
```

Navigate to `http://localhost:5173/casino/aviator`. Verify:
1. **Waiting phase**: countdown ticking, bet chips visible, "Place Bet" button
2. Place a bet → button changes to "Bet placed — waiting for takeoff"
3. **Flying phase** (auto-starts after 15s): multiplier climbing smoothly, "CASH OUT" button visible
4. Click Cash Out → button disappears, green "Cashed out at X.XX×" message, balance updates
5. Round crashes → red flash on board, crash_point shown
6. After 3 seconds → new waiting phase begins automatically

If step 6 doesn't happen within ~30 seconds of crash, the cron may not have created the next round yet (wait up to 12s for the next sub-tick).

- [ ] **Step 5.6: Commit**

```bash
git add src/pages/casino/AviatorGame.jsx
git commit -m "feat(aviator): full multiplayer UI — waiting/flying/crashed phases + live feed"
```

---

## Task 6: Edge Cases, Polish, Deploy

**Files:**
- Modify: `src/pages/casino/AviatorGame.jsx` (minor additions)

- [ ] **Step 6.1: Handle the case where no round exists yet**

The cron may take up to ~60 seconds to bootstrap the first round after migration. Find the loading return block and replace it:

```jsx
  if (round === undefined || balance === null) {
    return (
      <GameLayout title="Aviator">
        <div className="flex items-center justify-center h-48">
          <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        </div>
      </GameLayout>
    )
  }

  if (round === null) {
    return (
      <GameLayout title="Aviator">
        <div className="flex flex-col items-center justify-center h-48 gap-3">
          <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-cp-muted text-sm">Starting first round…</p>
        </div>
      </GameLayout>
    )
  }
```

- [ ] **Step 6.2: Handle arriving mid-flight (no bet possible)**

In the `handleRoundChange` callback, when a `flying` round is the very first round the client sees (e.g., page load during an active flight), we need to fetch its bets. Find `if (updated.status === 'flying')` and add a fetch after the state clears:

```jsx
    if (updated.status === 'flying') {
      // Existing code:
      setBets([])
      setMyBet(null)
      setCashoutFeed([])
      setLocalMult(1.0)
      // New: fetch any bets already placed in this round
      fetchBets(updated.id)
    }
```

Also update `fetchCurrentRound` to handle the case where the current round is already `flying` — it already does this since it queries `status IN ('waiting', 'flying')`. If the page loads during a flying round, fetchBets is called with that round's ID already. ✓

- [ ] **Step 6.3: Fix the Realtime handler to re-subscribe to next round after crash**

The `handleRoundChange` currently calls `fetchCurrentRound()` after 3.5s. But the new round fires a Realtime INSERT event too. To avoid double-processing, only call `fetchCurrentRound()` as a fallback if no INSERT fires. Replace the crash handler inside `handleRoundChange`:

```jsx
    if (updated.status === 'crashed') {
      setCrashAnimating(true)
      fetchHistory()
      // 4 seconds: show crash screen, then reset
      setTimeout(() => {
        setCrashAnimating(false)
        setMyBet(null)
        // fetchCurrentRound as fallback; Realtime INSERT for new round may arrive first
        fetchCurrentRound()
      }, 4000)
    }
```

Also extend the `waiting` branch in `handleRoundChange` to fetch bets for the new round:

```jsx
    if (updated.status === 'waiting') {
      // New round started — subscribe to its bets
      setRound(updated)
      setBets([])
      setMyBet(null)
      setCashoutFeed([])
      setLocalMult(1.0)
      setError('')
      return  // early return; don't fall through to the general setRound below
    }
```

Then wrap the general `setRound` call at the end of `handleRoundChange` in an `else`:

```jsx
    setRound(prev => {
      if (!prev || prev.id === updated.id || updated.status === 'waiting') {
        return updated
      }
      return prev
    })
```

Wait — the existing code already handles this with the setRound updater. But we need the early return for `waiting`. Rewrite `handleRoundChange` cleanly:

```jsx
  const handleRoundChange = useCallback((payload) => {
    const updated = payload.new
    if (!updated) return

    // A new waiting round arrived (INSERT or status update to waiting)
    if (updated.status === 'waiting') {
      setRound(updated)
      setBets([])
      setMyBet(null)
      setCashoutFeed([])
      setLocalMult(1.0)
      setError('')
      setCrashAnimating(false)
      return
    }

    // Round we're watching transitioned
    setRound(prev => (prev?.id === updated.id ? updated : prev))

    if (updated.status === 'flying') {
      fetchBets(updated.id)
      setCashoutFeed([])
      setLocalMult(1.0)
    }

    if (updated.status === 'crashed') {
      cancelAnimationFrame(rafRef.current)
      setCrashAnimating(true)
      fetchHistory()
      setTimeout(() => {
        setCrashAnimating(false)
        setMyBet(null)
        fetchCurrentRound()  // fallback if Realtime INSERT for next round is slow
      }, 4000)
    }
  }, [fetchBets, fetchCurrentRound, fetchHistory])
```

- [ ] **Step 6.4: Final build check**

```bash
cd "/Users/jonaswedam/Desktop/Organizer AI/cp-studios"
npm run build 2>&1 | tail -8
```
Expected: `✓ built` with no errors.

- [ ] **Step 6.5: Final smoke test**

Open two browser tabs at `http://localhost:5173/casino/aviator`. Verify multiplayer sync:
1. Both tabs show the same countdown / multiplier / crash at the same time
2. A bet placed in Tab 1 appears in Tab 2's live feed panel during waiting phase
3. A cash out in Tab 1 appears in Tab 2's live feed as a green cashout event
4. Crash is shown simultaneously (within ~1 second) in both tabs
5. A new waiting round starts in both tabs automatically

- [ ] **Step 6.6: Commit and push**

```bash
git add src/pages/casino/AviatorGame.jsx
git commit -m "feat(aviator): edge cases — mid-flight page load, round transition cleanup"
git push origin main
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Tables `aviator_rounds`, `aviator_bets`, `aviator_round_secrets` — Task 1
- ✅ RLS: authenticated read-all, user insert own bets, secrets hidden — Task 1
- ✅ `waiting/flying/crashed` cycle with correct timings — Task 3
- ✅ Crash formula matching JS `generateCrash()` — Task 2
- ✅ Realtime on both public tables — Task 1
- ✅ Waiting phase countdown — Task 5
- ✅ Flying phase multiplier (100ms smooth, RAF) — Task 4
- ✅ Crash display 3 seconds then next round — Task 5, 6
- ✅ Bet input + Place Bet (waiting only) — Task 5
- ✅ Cash Out button (flying only, with live payout) — Task 5
- ✅ Cashout server-authoritative (crash_at source of truth) — Task 2
- ✅ Lost bets on crash — Task 3
- ✅ Crash history pills (red/yellow/green) — Task 5
- ✅ Live feed: bets during waiting, cashouts during flying, summary on crash — Task 5
- ✅ pg_cron schedule matching CP War pattern — Task 3
- ✅ Bootstrap: always a round — Task 3
- ✅ Wallet debited on bet, credited on cashout (delta write) — Task 2
- ✅ `FlightBoard.jsx` + `aviatorTrajectory.js` reused unchanged — Tasks 4, 5

**Type consistency:** `place_aviator_bet(uuid, integer, text)` and `cashout_aviator(uuid)` match across migration (Task 2) and RPC calls (Task 5). `fetchBets(roundId)` called consistently in Tasks 4 and 6.

**No placeholders found.**
