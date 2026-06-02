# Multiplayer Aviator — Design Spec
**Date:** 2026-06-02  
**Migration:** 036  
**Replaces:** `src/pages/casino/AviatorGame.jsx` (solo, client-driven)

---

## 1. Overview

Rebuild the Aviator crash game as a persistent multiplayer experience. Rounds run 24/7 driven entirely by a Postgres cron function — no client is ever needed to keep the game running. Players join, wait for the next round, place bets, and cash out. All financial logic is server-authoritative.

---

## 2. Database (migration 036)

### 2.1 Tables

**`aviator_rounds`** — public, Realtime-enabled
```
id            uuid PK default gen_random_uuid()
status        text NOT NULL  CHECK (status IN ('waiting','flying','crashed'))  default 'waiting'
started_at    timestamptz    -- set when status → 'flying'
crashed_at    timestamptz    -- set when status → 'crashed'
crash_point   numeric        -- NULL until status = 'crashed'; revealed by tick on crash
created_at    timestamptz NOT NULL default now()
```

**`aviator_round_secrets`** — hidden from all clients
```
round_id      uuid PK references aviator_rounds ON DELETE CASCADE
crash_point   numeric NOT NULL   -- pre-determined at round creation
crash_at      timestamptz NOT NULL  -- exact time the crash will occur
```
RLS: `ENABLE ROW LEVEL SECURITY` with **no SELECT policy** (RLS on, zero policies = deny all reads from clients). SECURITY DEFINER functions bypass this.

**`aviator_bets`** — public, Realtime-enabled
```
id                  uuid PK default gen_random_uuid()
round_id            uuid NOT NULL references aviator_rounds ON DELETE CASCADE
user_id             uuid NOT NULL references auth.users ON DELETE CASCADE
display_name        text NOT NULL
bet_amount          integer NOT NULL CHECK (bet_amount > 0)
cashout_multiplier  numeric        -- NULL until cashed out
payout              integer        -- NULL until cashed out
status              text NOT NULL  CHECK (status IN ('active','cashed_out','lost'))  default 'active'
created_at          timestamptz NOT NULL default now()
```

### 2.2 RLS Policies

**`aviator_rounds`**
- SELECT: `auth.role() = 'authenticated'` (all rows)
- INSERT/UPDATE/DELETE: none (only cron function writes)

**`aviator_bets`**
- SELECT: `auth.role() = 'authenticated'` (all rows — live feed needs everyone's bets)
- INSERT: `auth.uid() = user_id`
- UPDATE: `auth.uid() = user_id` (for cashout; payout written by SECURITY DEFINER function, not direct client update)

**`aviator_round_secrets`**
- RLS enabled, no policies → zero client access

### 2.3 Realtime
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.aviator_rounds;
ALTER PUBLICATION supabase_realtime ADD TABLE public.aviator_bets;
```

---

## 3. Server Functions

### 3.1 Multiplier Math (replicated from `aviatorTrajectory.js`)

```
GROWTH_RATE = 0.15
m(t) = exp(0.15 * t)        -- t in seconds since started_at
t(m) = ln(m) / 0.15         -- seconds to reach multiplier m
```

Crash point generation (matching `generateCrash()` in JS):
```
5% chance → crash_point = 1.0
95% chance → crash_point = max(1.01, 1 / (1 - u * 0.95))  where u = random()
capped at 100.0
```

### 3.2 `aviator_tick()` — SECURITY DEFINER, called by pg_cron

Scheduled: `* * * * *` (every minute).  
Internally loops **5 iterations × 12-second `pg_sleep`**, giving ~12-second resolution throughout the minute. Uses `pg_try_advisory_lock` to prevent overlapping invocations.

Each sub-tick performs in order:

1. **Bootstrap** — if no `waiting` or `flying` round exists, create one with a new secret.

2. **Waiting → Flying** — if the active `waiting` round's `created_at + 15s <= now()`, set `status = 'flying'`, `started_at = now()`.

3. **Flying → Crashed** — if the active `flying` round's secret `crash_at <= now()`:
   - Copy `crash_point` from secrets into `aviator_rounds.crash_point` (reveals it to clients via Realtime)
   - Set `status = 'crashed'`, `crashed_at = now()`
   - UPDATE all `aviator_bets` where `round_id = this_round AND status = 'active'` → `status = 'lost'`

4. **Crashed → New Round** — if the latest `crashed` round's `crashed_at + 3s <= now()` and no `waiting`/`flying` round exists, create a new `waiting` round with a new secret.

**Creating a round** means:
- INSERT into `aviator_rounds` (status='waiting')
- Compute `crash_point` using the formula above
- Compute `crash_at = now() + 15s (waiting) + make_interval(secs := ln(crash_point)/0.15)`
- INSERT into `aviator_round_secrets`

### 3.3 `place_aviator_bet(p_round_id uuid, p_amount integer)` — SECURITY DEFINER

- Validates round status = 'waiting'
- Validates `p_amount > 0` and `wallet.balance >= p_amount`
- Checks no duplicate active bet from this user on this round
- Deducts `p_amount` from wallet (`balance = balance - p_amount`)
- Inserts into `aviator_bets`
- Returns the new bet id

### 3.4 `cashout_aviator(p_bet_id uuid)` — SECURITY DEFINER

This is the financial source of truth. The client's visual multiplier is irrelevant.

1. SELECT bet FOR UPDATE — must belong to `auth.uid()` and be `status = 'active'`
2. SELECT round FOR UPDATE — must be `status = 'flying'`
3. SELECT secret — read `crash_at`
4. If `now() >= crash_at` → UPDATE bet status = 'lost', return `(false, 0, null)`
5. Compute `elapsed = EXTRACT(EPOCH FROM (now() - round.started_at))`
6. Compute `mult = EXP(0.15 * GREATEST(0, elapsed))`
7. Compute `payout = FLOOR(bet_amount * mult)`
8. UPDATE bet: `status = 'cashed_out', cashout_multiplier = mult, payout = payout`
9. UPDATE wallet: `balance = balance + payout` (delta, safe with concurrent donations)
10. Return `(true, payout, mult)`

---

## 4. Frontend

### 4.1 File Structure

```
src/pages/casino/
  AviatorGame.jsx          ← replaced entirely (new multiplayer component)
  aviatorTrajectory.js     ← unchanged (reused)
  FlightBoard.jsx          ← unchanged (reused for SVG animation)
```

### 4.2 State Machine

The component subscribes to Realtime on `aviator_rounds` (current round) and `aviator_bets` (current round's bets). Local state:

```
roundPhase: 'waiting' | 'flying' | 'crashed' | null
currentRound: { id, status, started_at, crashed_at, crash_point, created_at }
bets: AviatorBet[]
myBet: AviatorBet | null
localMultiplier: number   -- computed every 100ms from started_at
countdown: number         -- seconds remaining in waiting phase
crashHistory: number[]    -- last 10 crash_points from recent rounds
```

On mount:
1. Fetch the current active round (status IN ('waiting','flying')) or most recent crashed round
2. Fetch crash history: last 10 `aviator_rounds` where `status = 'crashed'`, ordered by `created_at DESC`
3. Subscribe to `aviator_rounds` channel (filter: `id = current_round_id`) for status changes
4. Subscribe to `aviator_bets` channel (filter: `round_id = current_round_id`) for bet updates

When Realtime fires a round UPDATE:
- If `status` changed to `flying` → start local RAF multiplier loop from `started_at`
- If `status` changed to `crashed` → stop RAF, trigger crash animation, reveal `crash_point`, prepend to history, after 3s re-subscribe to new round

### 4.3 Main Panel

**Waiting phase:**
- Large centered countdown: "Next round in Xs"
- Bet chip selector + amount input
- "Place Bet" button (disabled once bet placed or round not waiting)
- If bet already placed: show "Bet placed — good luck!" with the amount

**Flying phase:**
- `FlightBoard` SVG with animated plane on trajectory curve (same as solo game)
- Large centered multiplier: `localMultiplier.toFixed(2) + '×'` — updates every 100ms
- If player has an active bet: "CASH OUT — +X coins · Y.YY×" pulsing button
- If player has no bet or already cashed out: display-only multiplier
- Winning multiplier turns green as it climbs; normal white otherwise

**Crashed phase (3-second display):**
- Red flash overlay + subtle shake animation on the board
- Multiplier text turns red, shows `crash_point.toFixed(2) + '×'`
- If player lost: "Flew away! Lost X coins"
- If player cashed out before crash: "You cashed out at Y.YY× — won Z coins" (green)
- After 3s: auto-subscribe to next round, reset to waiting phase UI

### 4.4 Live Feed Panel

Displayed to the right of (desktop) or below (mobile) the main board.

**Crash history pills** (always visible, top of feed):
- Last 10 rounds' `crash_point` values
- Color: red border/text if < 2×, amber if 2–5×, green if > 5×

**During waiting:**
- List of all bets placed this round: display_name + bet_amount
- Updates live as Realtime fires INSERT events on aviator_bets

**During flying:**
- Live feed of cashouts as they happen
- Each entry: "Name cashed out at X.XX×" with the payout amount
- New entries slide in from the top
- Keep last 20 events

**After crash:**
- "Round crashed at X.XX×"
- Winners list (cashed_out bets) in green
- Losers list (lost bets) in red

---

## 5. Timing Contract

| Event | Accuracy | Consequence of delay |
|-------|----------|----------------------|
| Cashout validation | Exact (server timestamp vs crash_at) | None — always correct |
| Visual crash display | ±12 seconds (cron resolution) | Plane keeps flying briefly past real crash; then snaps to crash screen |
| Waiting → flying transition | ±12 seconds | Slight variation in actual betting window length |
| New round creation | ±12 seconds | Brief gap between rounds |

The ~12-second cron resolution is the only imprecision. It has no effect on financial correctness.

---

## 6. Design / Animation

- Dark card background matching CP Studios palette (`bg-cp-card`, amber accents)
- Multiplier text: white normally, turns red on crash, green at 10×+
- Crash: `@keyframes shake` on the board div + brief red overlay
- Cash out button: same pulsing amber gradient as solo Aviator
- Trajectory and plane: reuse `FlightBoard.jsx` unchanged; pass `phase` and computed `multiplier`

---

## 7. What Is Not Changing

- `/casino/aviator` route in `App.jsx` — same path, just new component
- `FlightBoard.jsx` — no changes
- `aviatorTrajectory.js` — no changes
- `CasinoContext.jsx` — `placeBet` not used; wallet debited/credited by SECURITY DEFINER RPCs
