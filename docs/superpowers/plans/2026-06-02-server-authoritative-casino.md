# Server-Authoritative Casino Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Commits are deferred** — replace each "commit" with a verification checkpoint (`npm run build` + relevant `node --test`); the maintainer commits after the final report.

**Goal:** Move all casino game outcome-generation and payout into Postgres `SECURITY DEFINER` RPCs and revoke the client's ability to write its own `wallets.balance`, so overriding `Math.random` or calling RPCs directly can no longer mint coins — without changing any game's odds, payouts, or feel.

**Architecture:** Per-game `play_*` RPCs (single-shot) and a `casino_rounds` + `casino_round_secrets` round lifecycle (interactive), all DEFINER and `auth.uid()`-scoped, mirroring the existing `036_aviator_multiplayer.sql` and `028_war_spawn.sql` patterns. Each game's math is first written as a pure, `node --test`-tested JS engine that is the source of truth the SQL is translated from. A final lockdown migration revokes client `wallets` INSERT/UPDATE and drops `settle_bet`.

**Tech Stack:** Vite + React (client), Supabase Postgres + PL/pgSQL (authority), `node --test` (test runner), no app server.

**Spec:** `docs/superpowers/specs/2026-06-02-server-authoritative-casino-design.md` — read it first.

---

## Ground rules for every task

- **TDD for engines:** write the failing `node --test` test first, run it (RED), implement the pure JS engine, run it (GREEN). Engines are pure (no React/DOM), default `rng = Math.random` injectable for testing.
- **SQL mirrors JS:** every constant (weights, paytables, multiplier arrays, probabilities, payout multipliers) is copied **verbatim** from the JS engine into the SQL function, with a comment `-- keep in sync with <engine>.js`.
- **SQL cannot be run here.** Correctness of math is proven by the JS engine tests; correctness of the SQL is by faithful translation + the `casino_checks.sql` script for Jonas.
- **Validation invariants in every RPC:** `require auth.uid()`; `SELECT balance ... FOR UPDATE`; reject `bet <= 0` and `bet > balance` before any deduction; delta writes only (`balance = balance + d`), never absolute.
- **Verification checkpoint** (replaces commit): `npm run build` and the task's `node --test` file both pass.

## File map

**New pure JS engines + tests** (`src/pages/casino/`):
`diceEngine.js`(+test), `coinflipEngine.js`(+test), `rouletteEngine.js`(+test), `minesEngine.js`(+test), `chickenEngine.js`(+test), `blackjackEngine.js`(+test). Existing `slotsEngine.js`✓, `plinkoGeom.js`✓ reused.

**New simulation:** `scripts/casino-sim.mjs`.

**New migrations** (`supabase/migrations/`): `038`–`045` as enumerated in the spec.

**New SQL test:** `supabase/tests/casino_checks.sql`.

**Modified client:** `src/context/CasinoContext.jsx` (add `play`, `openRound`, `roundAction`, `cashoutRound`, `ensureWallet`; switch `claimRefill`; remove `placeBet` last), and each game component in `src/pages/casino/`.

---

## PHASE 1 — Single-shot games

### Task 1: Dice engine (pure JS + test)

**Files:** Create `src/pages/casino/diceEngine.js`, Test `src/pages/casino/diceEngine.test.js`

- [ ] **Step 1: Failing test** (`diceEngine.test.js`)

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveDice } from './diceEngine.js'

test('dice win pays +bet*4, roll equals guess', () => {
  const r = resolveDice({ bet: 100, guess: 6, rng: () => 0.99 }) // floor(0.99*6)+1 = 6
  assert.equal(r.roll, 6)
  assert.equal(r.win, true)
  assert.equal(r.delta, 400) // +bet*4
})

test('dice loss pays -bet', () => {
  const r = resolveDice({ bet: 100, guess: 1, rng: () => 0.99 }) // roll 6 != 1
  assert.equal(r.win, false)
  assert.equal(r.delta, -100)
})
```

- [ ] **Step 2: Run RED** — `node --test src/pages/casino/diceEngine.test.js` → fails (no module).
- [ ] **Step 3: Implement** (`diceEngine.js`)

```js
// Pure dice resolution. Mirrors current DiceGame.jsx math (guess 1-6, 5x total return).
// keep in sync with 038_casino_play_singleshot.sql
export function resolveDice({ bet, guess, rng = Math.random }) {
  const roll = Math.floor(rng() * 6) + 1
  const win = roll === guess
  return { roll, win, delta: win ? bet * 4 : -bet }
}
```

- [ ] **Step 4: Run GREEN** — `node --test src/pages/casino/diceEngine.test.js` → passes.
- [ ] **Step 5: Checkpoint** — `npm run build` clean.

### Task 2: Coin Flip engine

**Files:** Create `src/pages/casino/coinflipEngine.js`(+`.test.js`)

- [ ] **Step 1: Failing test**

```js
import { resolveCoinFlip } from './coinflipEngine.js'
test('coinflip win pays +floor(bet*0.95)', () => {
  const r = resolveCoinFlip({ bet: 100, choice: 'heads', rng: () => 0.9 }) // >0.5 => heads
  assert.equal(r.result, 'heads'); assert.equal(r.win, true); assert.equal(r.delta, 95)
})
test('coinflip loss pays -bet', () => {
  const r = resolveCoinFlip({ bet: 100, choice: 'tails', rng: () => 0.9 })
  assert.equal(r.win, false); assert.equal(r.delta, -100)
})
```

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement**

```js
// keep in sync with 038_casino_play_singleshot.sql ; mirrors CoinFlipGame.jsx
export function resolveCoinFlip({ bet, choice, rng = Math.random }) {
  const result = rng() > 0.5 ? 'heads' : 'tails'
  const win = result === choice
  return { result, win, delta: win ? Math.floor(bet * 0.95) : -bet }
}
```

- [ ] **Step 4: GREEN.** **Step 5: Checkpoint.**

### Task 3: Roulette engine

**Files:** Create `src/pages/casino/rouletteEngine.js`(+`.test.js`). First read `RouletteGame.jsx` `calcWin` and replicate it exactly (kinds: `red|black|odd|even|number`; the red-number set).

- [ ] **Step 1: Failing test** (covers number=35x, color=2x, miss=-bet, and 0 losing color bets)

```js
import { resolveRoulette, RED_NUMBERS } from './rouletteEngine.js'
test('number hit pays +bet*35', () => {
  const r = resolveRoulette({ bet: 10, kind: 'number', number: 17, rng: () => 17/37 })
  assert.equal(r.result, 17); assert.equal(r.delta, 350)
})
test('red hit pays +bet; zero loses color', () => {
  assert.equal(resolveRoulette({ bet: 10, kind: 'red', rng: () => 1/37 }).delta, 10)   // 1 is red
  assert.equal(resolveRoulette({ bet: 10, kind: 'red', rng: () => 0 }).delta, -10)     // 0 loses
})
```

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** — port `calcWin` exactly; `result = Math.floor(rng()*37)`; payout: number → `+bet*35` on hit; red/black/odd/even → `+bet` on hit; else `-bet`. Export `RED_NUMBERS` set used by the red/black check, copied from `RouletteGame.jsx`.
- [ ] **Step 4: GREEN.** **Step 5: Checkpoint.**

### Task 4: Slots & Plinko engines — confirm reuse

**Files:** Reuse `slotsEngine.js` (has `spinGrid`, `evaluateGrid`) and `plinkoGeom.js` (multiplier tables + decision→slot). Read both.

- [ ] **Step 1:** Confirm `slotsEngine.js` exposes a net-payout path: `net = (evaluateGrid(grid).totalReturn - 1) * bet`. If `evaluateGrid` returns `totalReturn`, add a thin `resolveSlots({bet, rng})` wrapper + test; else add it. Run existing `slotsEngine.test.js`.
- [ ] **Step 2:** Confirm `plinkoGeom.js` exposes `MULTIPLIERS[rows][risk]` and a `decisionsToSlot(decisions)` (sum of rights). Add `resolvePlinko({bet, rows, risk, rng})` returning `{decisions, slot, mult, delta: Math.floor(bet*mult)-bet}` + test.
- [ ] **Step 3: GREEN** — `node --test src/pages/casino/slotsEngine.test.js src/pages/casino/plinkoGeom.test.js`. **Checkpoint.**

### Task 5: Migration `038_casino_play_singleshot.sql`

**Files:** Create `supabase/migrations/038_casino_play_singleshot.sql`. Translate the five engines into DEFINER RPCs. Pattern for each (dice shown; others analogous, constants copied from the engines):

```sql
-- Migration 038: server-authoritative single-shot casino games. Idempotent. Additive.
-- keep payout math in sync with src/pages/casino/{dice,coinflip,roulette,slots,plinko}Engine.js
create or replace function public.play_dice(p_bet integer, p_guess integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); bal integer; roll integer; won boolean; d integer; newbal integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_bet <= 0 then raise exception 'bad bet'; end if;
  if p_guess < 1 or p_guess > 6 then raise exception 'bad guess'; end if;
  select balance into bal from public.wallets where user_id = uid for update;
  if bal is null then raise exception 'no wallet'; end if;
  if p_bet > bal then raise exception 'insufficient'; end if;
  roll := floor(random() * 6) + 1;
  won  := (roll = p_guess);
  d    := case when won then p_bet * 4 else -p_bet end;
  update public.wallets set balance = balance + d where user_id = uid returning balance into newbal;
  insert into public.game_history (user_id, game, bet, result, payout)
    values (uid, 'dice', p_bet, case when won then 'win' else 'loss' end,
            case when won then p_bet + p_bet*4 else 0 end);
  return jsonb_build_object('roll', roll, 'win', won, 'delta', d, 'balance', newbal);
end; $$;
revoke all on function public.play_dice(integer,integer) from public;
grant execute on function public.play_dice(integer,integer) to authenticated;
-- ... play_coinflip(p_bet, p_choice text), play_roulette(p_bet, p_kind text, p_number int),
-- ... play_slots(p_bet), play_plinko(p_bet, p_rows int, p_risk text) — same skeleton,
-- ... each rolling with random(), computing delta per its engine, inserting game_history.
```

- [ ] **Step 1:** Write all five functions (slots: build the 5×3 grid with a nested loop of weighted draws matching `slotsEngine` WEIGHTS `[6,6,4,3,1]` and paytable; plinko: loop `p_rows` times `floor(random()*2)`, sum rights → slot, look up the multiplier array literal). Each returns the jsonb the client needs to animate.
- [ ] **Step 2:** Add a commented `-- ROLLBACK:` block (`drop function ...`).
- [ ] **Step 3: Checkpoint** — there is no way to run SQL; instead re-read each function beside its engine and confirm constant-for-constant parity. Record parity confirmation in the task notes.

### Task 6: Client `play()` helper + single-shot wiring

**Files:** Modify `src/context/CasinoContext.jsx`; modify `DiceGame.jsx`, `CoinFlipGame.jsx`, `RouletteGame.jsx`, `SlotsGame.jsx`, `PlinkoGame.jsx`.

- [ ] **Step 1:** Add to `CasinoContext`:

```js
const play = useCallback(async (game, args) => {
  if (!userId) throw new Error('Not authenticated')
  const { data, error } = await supabase.rpc(`play_${game}`, args)
  if (error) throw error                       // fail-closed: surface, never resolve locally
  if (data?.balance != null) { balanceRef.current = data.balance; setBalance(data.balance) }
  return data
}, [userId])
```

Expose `play` in the context value.
- [ ] **Step 2:** In each single-shot game, replace the local `Math.random` resolution + `placeBet(...)` with `const outcome = await play('dice', { p_bet: bet, p_guess: guess })`, then drive the **existing** animation toward `outcome.roll`/`outcome.result`/`outcome.grid`/`outcome.decisions`. Keep all UI/animation code. Show an error toast if `play` throws.
  - Dice: animate to `outcome.roll`. CoinFlip: to `outcome.result`. Roulette: spin to `outcome.result`. Slots: render `outcome.grid`. Plinko: animate the ball down `outcome.decisions` to `outcome.slot` (the geometry already maps decisions→path).
- [ ] **Step 3: Checkpoint** — `npm run build` clean. Manual smoke deferred to live (RPCs not applied here).

---

## PHASE 2 — Interactive games

### Task 7: Mines engine (pure JS + test)

**Files:** Create `src/pages/casino/minesEngine.js`(+`.test.js`). Extract `getMult` from `MinesGame.jsx` exactly (`mult = round(max(1.01, Π_{i<revealed} (25-i)/(25-mines-i) * 0.95), 2)`).

- [ ] **Step 1: Failing test**

```js
import { minesMult, buildMines } from './minesEngine.js'
test('mult is 1 with zero revealed', () => { assert.equal(minesMult(0, 3), 1) })
test('mult rises with reveals, 2-decimal rounded, >=1.01', () => {
  const m1 = minesMult(1, 3); assert.ok(m1 >= 1.01); assert.equal(m1, Math.round(m1*100)/100)
})
test('buildMines returns N distinct cells in 0..24', () => {
  const cells = buildMines(5, () => 0.5); assert.equal(new Set(cells).size, 5)
  assert.ok(cells.every(c => c >= 0 && c < 25))
})
```

- [ ] **Step 2: RED. Step 3: Implement** `minesMult(revealed, mines)` and `buildMines(count, rng)` (distinct-cell draw). **Step 4: GREEN. Step 5: Checkpoint.**

### Task 8: Chicken Road engine

**Files:** Create `src/pages/casino/chickenEngine.js`(+`.test.js`). Constants copied from `ChickenRoadGame.jsx`: `LANE_MULTIPLIERS=[1.3,2.0,3.2,4.8,7.2,11.0,18.0]`, `SAFE_PROBS=[0.72,0.64,0.56,0.48,0.40,0.32,0.25]`.

- [ ] **Step 1: Failing test** — `preRollLanes(rng)` returns 7 booleans (`rng()<SAFE_PROBS[i]`); `chickenPayout(bet, lane)` = `bet + Math.floor(bet*(LANE_MULTIPLIERS[lane-1]-1))`.
- [ ] **Step 2: RED. Step 3: Implement. Step 4: GREEN. Step 5: Checkpoint.**

### Task 9: Blackjack engine (highest risk)

**Files:** Create `src/pages/casino/blackjackEngine.js`(+`.test.js`). Extract from `BlackjackGame.jsx`: deck build, Fisher–Yates shuffle (injectable rng), `handValue(cards)` with ace 11→1, dealer-draws-to-17, settlement (`blackjack 3:2`, win, push, loss, double).

- [ ] **Step 1: Failing tests** — `handValue` (incl. soft ace, multiple aces), `dealerPlay(deck, idx)` stops at 17+, `settle(player, dealer, bet)` returns correct credited amount for each outcome (blackjack→`bet+floor(bet*1.5)`, win→`bet*2`, push→`bet`, loss→`0`).
- [ ] **Step 2: RED. Step 3: Implement pure functions. Step 4: GREEN.** Aim for thorough coverage — this is the function the SQL is translated from and cannot be runtime-verified server-side. **Step 5: Checkpoint.**

### Task 10: Migration `039_casino_rounds.sql`

**Files:** Create `supabase/migrations/039_casino_rounds.sql` — the two tables + RLS exactly as in the spec (`casino_rounds` with own-row select using `auth.role()='authenticated' and auth.uid()=user_id`, no write policies; `casino_round_secrets` RLS enabled, **no policies**; comment: "DO NOT add casino_round_secrets to supabase_realtime").

- [ ] **Step 1:** Write the DDL (idempotent `create table if not exists`, `alter table ... enable row level security`, `drop policy if exists` then `create policy`). **Step 2:** Commented rollback. **Step 3: Checkpoint** (read-back parity vs spec).

### Task 11: Migration `040_casino_mines.sql`

**Files:** Create `supabase/migrations/040_casino_mines.sql`. Three DEFINER RPCs with the FOR-UPDATE/validation invariants.

```sql
-- keep in sync with src/pages/casino/minesEngine.js
create or replace function public.mines_open(p_bet integer, p_mines integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); bal integer; rid uuid; cells integer[];
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_bet <= 0 then raise exception 'bad bet'; end if;
  if p_mines not in (1,3,5,7,10) then raise exception 'bad mines'; end if;
  select balance into bal from public.wallets where user_id = uid for update;
  if bal is null or p_bet > bal then raise exception 'insufficient'; end if;     -- before deduct
  -- distinct mine cells (loop with random(); reject dup until N distinct)
  cells := public._mines_pick(p_mines);
  update public.wallets set balance = balance - p_bet where user_id = uid;
  insert into public.casino_rounds (user_id, game, bet, status, state)
    values (uid, 'mines', p_bet, 'active',
            jsonb_build_object('revealed', '[]'::jsonb, 'mult', 1.0, 'mines', p_mines))
    returning id into rid;
  insert into public.casino_round_secrets (round_id, secret)
    values (rid, jsonb_build_object('mines', to_jsonb(cells)));
  return jsonb_build_object('round_id', rid, 'mines', p_mines, 'mult', 1.0, 'revealed', '[]'::jsonb);
end; $$;
-- mines_reveal(p_round uuid, p_cell int): SELECT round FOR UPDATE; require status='active' & ownership;
--   dedupe (no-op if cell already revealed); if cell in secret.mines -> status='busted',
--   return {hit:true, mines:<layout>}; else append, recompute mult (minesMult), if all safe revealed
--   -> auto-cashout (credit + status='cashed_out' + game_history), return {hit:false, cell, mult, ...}.
-- mines_cashout(p_round uuid): SELECT FOR UPDATE; require status='active'; credit
--   bet + floor(bet*(mult-1)); status='cashed_out'; insert game_history('mines','win'); return {payout, mult}.
```

- [ ] **Step 1:** Write `_mines_pick`, `mines_open`, `mines_reveal`, `mines_cashout` (DEFINER; grants to authenticated; revoke from public). Ensure every terminal path inserts `game_history`. **Step 2:** Rollback. **Step 3: Checkpoint** (parity read-back vs `minesEngine.js`).

### Task 12: Migration `041_casino_chicken.sql`

**Files:** Create `supabase/migrations/041_casino_chicken.sql` — `chicken_open` (pre-roll 7 lane outcomes into secret), `chicken_step` (FOR UPDATE, reveal next lane, bust or advance, auto-cashout after lane 7), `chicken_cashout` (credit `bet+floor(bet*(LANE_MULTIPLIERS[lane-1]-1))`). Same invariants.

- [ ] **Step 1:** Write the three RPCs with constants copied from `chickenEngine.js`. **Step 2:** Rollback. **Step 3: Checkpoint.**

### Task 13: Migration `042_casino_blackjack.sql`

**Files:** Create `supabase/migrations/042_casino_blackjack.sql` — `blackjack_open`, `blackjack_hit`, `blackjack_stand`, `blackjack_double`. Secret = shuffled deck + draw index. Translate `blackjackEngine.js` line-for-line (handValue, dealer-to-17, settlement). Never return the dealer hole card or deck in mid-round jsonb.

- [ ] **Step 1:** Write the four RPCs. **Step 2:** Rollback. **Step 3: Checkpoint** (careful parity read-back vs `blackjackEngine.js`; this is the highest-risk translation).

### Task 14: Client round helpers + interactive wiring

**Files:** Modify `CasinoContext.jsx` (add `openRound`, `roundAction`, `cashoutRound`); modify `MinesGame.jsx`, `ChickenRoadGame.jsx`, `BlackjackGame.jsx`.

- [ ] **Step 1:** Add helpers:

```js
const openRound  = useCallback(async (game, args) => callRpc(`${game}_open`, args), [userId])
const roundAction = useCallback(async (rpc, args) => callRpc(rpc, args), [userId])
const cashoutRound = useCallback(async (game, roundId) => {
  const data = await callRpc(`${game}_cashout`, { p_round: roundId })
  await loadBalance(); return data
}, [userId])
// callRpc: supabase.rpc(name, args); throw on error; reconcile balance from data.balance if present.
```

- [ ] **Step 2:** Rewire each interactive game: `*_open` on start, an RPC per reveal/step/hit/stand, `*_cashout` on cash-out. Render from the returned public state; keep all animation. Mid-round shows a per-action pending state. On bust, animate from the returned terminal layout. Call `loadBalance()` after terminal events.
- [ ] **Step 3: Checkpoint** — `npm run build` clean.

---

## PHASE 3 — Lockdown, wallet RPCs, reset, simulation

### Task 15: Migration `043_casino_wallet_rpcs.sql` (additive)

**Files:** Create `supabase/migrations/043_casino_wallet_rpcs.sql`.

- [ ] **Step 1:** `alter table public.wallets add column if not exists last_refill timestamptz;`
- [ ] **Step 2:** `create or replace function public.ensure_wallet(p_display_name text) returns jsonb` — DEFINER; `insert into wallets(user_id, balance, last_daily_bonus, display_name) values (auth.uid(), 1100, now(), p_display_name) on conflict (user_id) do nothing`; return the row's balance. (1100 = 1000 start + 100 first-day bonus, matching current first-visit.)
- [ ] **Step 3:** `create or replace function public.claim_refill() returns jsonb` — DEFINER; only when `balance = 0` and (`last_refill is null or last_refill < now() - interval '24 hours'`); set `balance = 100, last_refill = now()`.
- [ ] **Step 4:** `create or replace` for `apply_balance_delta`, `claim_daily_bonus`, `settle_ad_reward` changing `security invoker` → `security definer` (keep their existing bodies + `where user_id = auth.uid()`); add to `apply_balance_delta`: `if p_delta > 0 then raise exception 'spend only'; end if;`.
- [ ] **Step 5:** grants (`revoke all ... from public; grant execute ... to authenticated`) for the new/changed functions. Commented rollback. **Step 6: Checkpoint** (parity read-back; confirm `apply_balance_delta` still accepts negatives).

### Task 16: Client wallet-creation + refill switch

**Files:** Modify `CasinoContext.jsx`.

- [ ] **Step 1:** Replace the first-visit `supabase.from('wallets').insert({...})` in `loadBalance` with `await supabase.rpc('ensure_wallet', { p_display_name: displayName })`, then re-read balance. Keep the display_name resolution (pending_users → metadata) to compute `p_display_name`.
- [ ] **Step 2:** Replace `claimRefill`'s direct `update({ balance: 100 })` with `supabase.rpc('claim_refill')`.
- [ ] **Step 3:** Remove the `placeBet` function and its `settle_bet`/direct-write fallback **only after** confirming no game imports it (grep `placeBet`); leave `adjustBalance` (war) intact. **Step 4: Checkpoint** — `npm run build` clean; `grep -rn "placeBet" src/` returns nothing.

### Task 17: Migration `044_wallet_lockdown.sql` (breaking — applied last)

**Files:** Create `supabase/migrations/044_wallet_lockdown.sql`.

- [ ] **Step 1:** Write (mirrors `028`):

```sql
-- Migration 044: revoke client balance writes. APPLY LAST, after the new client is verified live.
revoke insert, update on public.wallets from authenticated, anon;
grant  update (display_name) on public.wallets to authenticated;   -- rename mirror only
drop function if exists public.settle_bet(text,integer,text,integer,integer);
revoke insert on public.game_history from authenticated, anon;     -- RPCs insert history now
-- ROLLBACK: grant insert,update on wallets to authenticated; grant insert on game_history to authenticated;
--           recreate settle_bet from 032 if ever needed.
```

- [ ] **Step 2: Checkpoint** (read-back vs spec + `028`).

### Task 18: Migration `045_reset_money.sql` + SQL self-tests

**Files:** Create `supabase/migrations/045_reset_money.sql` (model on `030_reset_money.sql`: `update wallets set balance = 1000;` plus `delete from casino_rounds;` to clear orphaned rounds) and `supabase/tests/casino_checks.sql` (the grant/RLS verification queries from the spec + distribution sanity selects calling each `play_*` many times via `generate_series`).

- [ ] **Step 1:** Write both files. **Step 2: Checkpoint** (read-back).

### Task 19: RTP simulation script

**Files:** Create `scripts/casino-sim.mjs` (Node ESM, no deps).

- [ ] **Step 1:** Import every engine; run ~1e6 trials each; print measured RTP / win-rate / multiplier distribution. Assert each game's measured RTP is within ±1% of the value implied by its current odds (dice 83.3%, coinflip 97.5%, roulette ~97.3% even-money / 97.3% straight, slots/plinko from their tables, mines/chicken via optimal-ish sampling or fixed-strategy RTP).
- [ ] **Step 2: Run** — `node scripts/casino-sim.mjs` → all within tolerance. **Step 3: Checkpoint.**

### Task 20: Full verification sweep

- [ ] **Step 1:** `node --test src/pages/casino/*.test.js` → all green.
- [ ] **Step 2:** `node scripts/casino-sim.mjs` → all RTPs within tolerance.
- [ ] **Step 3:** `npm run build` → clean.
- [ ] **Step 4:** `grep -rn "Math.random" src/pages/casino/` → only animation/cosmetic uses remain (no outcome-deciding calls in game components); `grep -rn "placeBet\|settle_bet" src/` → none.
- [ ] **Step 5:** Compile the final report: what's verified here vs. what Jonas must apply/verify (migrations `038`–`045` in order, the `casino_checks.sql` queries, the cheat-window note).

---

## Self-review (spec coverage)

- Single-shot RPCs (dice/coinflip/roulette/slots/plinko): Tasks 1–6. ✓
- Interactive RPCs + rounds/secrets tables + invariants (FOR UPDATE, bet≤balance, dedupe, race guards): Tasks 7–14. ✓
- Wallet lockdown (revoke INSERT+UPDATE from authenticated+anon, grant display_name, ensure_wallet, drop settle_bet, game_history revoke): Tasks 15–17. ✓
- `apply_balance_delta` negative-only + DEFINER conversions: Task 15. ✓
- claim_refill, ensure_wallet additive before lockdown: Tasks 15–16. ✓
- Reset + clear orphaned rounds + SQL self-tests: Task 18. ✓
- Exact payout replication incl. 2-decimal rounding: engine tests (Tasks 7,8) + `(mult-1)` net form in cashout RPCs (Tasks 11,12). ✓
- RTP simulation: Task 19. ✓
- Verification + report: Task 20. ✓
- `donate_coins` survivor: no task needed (unchanged; audited safe in spec). ✓
- Migration order / cheat-window honesty: encoded in Tasks 15/17 ordering + Task 20 report. ✓

No placeholders; signatures consistent (`play_<game>`, `<game>_open/_reveal/_step/_hit/_stand/_cashout`, `ensure_wallet`, `claim_refill`, `play`/`openRound`/`roundAction`/`cashoutRound`).
