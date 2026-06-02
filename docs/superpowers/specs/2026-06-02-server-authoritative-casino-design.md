# Server-Authoritative Casino — Design

**Date:** 2026-06-02
**Status:** Design — revised after adversarial review (autonomous track per maintainer request)
**Author:** Brainstormed with the maintainer; executed autonomously

## Problem

A player reported: *"if you go into console you can put math random to 99."* Decoded, they
opened DevTools and overrode the global `Math.random` (e.g. `Math.random = () => 0.99`).
Because every casino game computes its outcome **in the browser** from `Math.random()` and
then tells the server how much it won, pinning `Math.random` forces wins on every game.

This is the client-authoritative casino documented in `CLAUDE.md` §4. There are two exploit
layers:

1. **Outcomes are decided client-side** via the global `Math.random`, which any user can
   override from the console.
2. **The server trusts the client's reported win.** `settle_bet` (migration `032`) does
   `balance = GREATEST(0, balance + p_win_amount)` with **no validation**. Even without the
   `Math.random` trick, a user can call `apply_balance_delta({ p_delta: 1000000 })`,
   `settle_bet(..., p_win_amount => 999999)`, or simply `INSERT`/`UPDATE` their `wallets` row
   from the console. The anon Supabase key ships in the bundle, so these are always reachable.

The fix must move **outcome generation and payout** to the server, and **remove the client's
ability to write its own balance** at all — via UPDATE *or* INSERT.

## Goals

- Casino game outcomes and payouts are decided by the database, not the browser. Overriding
  `Math.random` or calling RPCs directly can no longer mint coins.
- The client can no longer write `wallets.balance` (UPDATE or INSERT); all balance changes flow
  through `SECURITY DEFINER` functions that compute the delta server-side.
- Preserve the existing look, feel, animations, **odds, and exact payouts** of every game. This
  is a **security/authority** change, not a rebalance — payout formulas are replicated to the
  digit (including 2-decimal multiplier rounding).
- Stay within the app's architecture: **no application server** — authority lives in Postgres
  functions, exactly like CP War (`war_spawn`/`war_tick`, migration `028`/`023`) and the
  already-server-authoritative Aviator (`place_aviator_bet`/`cashout_aviator`, migration `036`).
- Maximize what is testable without a live database: pure-JS reference engines (run under
  `node --test`) that are the source of truth the SQL mirrors, plus odds/RTP simulations.

## Non-goals (YAGNI)

- **Provably-fair / commit-reveal seeds.** Overkill for a private friends-and-family app.
- **Rebalancing odds or payouts.** Keep every game's current math; only move where it runs.
- **Aviator / Aviamasters.** Aviator is *already* server-authoritative (migration `036`).
  Aviamasters is a separate, not-yet-built game (out of scope; when built it should follow this
  pattern — it auto-resolves with no cash-out, so it's single-shot).
- **Re-architecting CP War.** War unit purchases stay client-initiated negative-delta spends
  (players can still inflate their *own* unit counts — accepted per `CLAUDE.md` §4). We only
  ensure the wallet lockdown doesn't break war's spend path.
- **`donate_coins` redesign.** It survives (see audit below): it's balance-bounded so it can't
  mint coins. We accept its two-account *concentration* caveat for this trust model.
- **Other client-side gaps** (member approval, storage ownership) from `docs/DATABASE.md`.

## Scope

**Phase 1 — single-shot games:** Dice, Coin Flip, Roulette, Slots, Plinko. One server call
each: bet/choice in → server rolls, computes payout, applies the delta, returns the outcome to
animate. (Plinko's multi-ball UX is still one independent RNG event per *ball* with no hidden
state the player acts against → single-shot tier, one RPC per ball.)

**Phase 2 — interactive games:** Mines, Blackjack, Chicken Road. Each holds **hidden** round
state in a secrets table and validates every mid-round action under a row lock.

**Lockdown (applied last):** revoke the client's `wallets` INSERT+UPDATE; route wallet creation
through `ensure_wallet`; drop `settle_bet`; restrict `apply_balance_delta` to negative
(spend-only); revoke client `game_history` INSERT; reset balances.

**Out of scope:** Aviator, Aviamasters, CP War internals, non-casino security gaps.

## Architecture (Approach A: Postgres `SECURITY DEFINER` RPCs)

No new infrastructure. Game logic becomes Postgres functions. The client calls an RPC, gets
back the server-decided outcome, and animates *toward* it using the existing UI. Randomness
moves from the browser to the database using **`random()` only** (no `gen_random_bytes`, which
would require the `pgcrypto` extension the project doesn't install; `gen_random_uuid()` is core
in the Supabase Postgres version and is fine for ids). `random()` is a seeded PRNG, not
crypto-secure — acceptable per the no-provably-fair non-goal (a client can't see or predict it).

```
Before:  client rolls Math.random → computes win → tells server "I won X" → server adds X
After:   client sends (bet, choice) → server rolls + computes win → server adds X → tells client the outcome to animate
```

### The wallet lockdown (the core security change) — mirrors migration `028`

Without this, server-side outcomes are pointless — a cheater just writes their balance
directly. The project already established the correct pattern in `028_war_spawn.sql`
(table-level revoke, then grant back only self-editable columns). We mirror it for `wallets`:

```sql
-- Table-level revoke from BOTH client roles (a column-level revoke wouldn't stop a blanket
-- grant; anon must be covered too even though RLS also blocks it). DEFINER functions run as
-- the table owner and are unaffected.
revoke insert, update on public.wallets from authenticated, anon;
-- Grant back ONLY the one column the client legitimately self-edits (the rename mirror).
grant update (display_name) on public.wallets to authenticated;
-- NO insert grant: wallet creation now goes through ensure_wallet() (below), so the client can
-- no longer choose its own starting balance.
```

This closes **both** the UPDATE mint and the INSERT mint (the old `loadBalance` inserted a
client-chosen `balance: 1100`). Ad-tracking columns and `last_daily_bonus` are written only by
DEFINER RPCs, so they need no client grant.

**Every balance-mutating function becomes `SECURITY DEFINER`** with `SET search_path = public`
(prevents search-path hijack) and each scopes its write to `WHERE user_id = auth.uid()` — which
is the *only* cross-wallet guard inside a DEFINER function, since RLS does not apply there:

- `settle_bet` → **dropped** (trusts a client win amount). Replaced by per-game `play_*` RPCs.
- `apply_balance_delta(p_delta)` → DEFINER, **rejects `p_delta > 0`** (spend-only). All client
  callers pass `-cost` (verified: `WarPage.jsx` ×5, Plinko unmount forfeit). Can no longer mint.
- `claim_daily_bonus`, `settle_ad_reward` → DEFINER (logic already computes the delta
  server-side and scopes by `auth.uid()`; DEFINER just lets them keep working post-revoke).
- `claim_refill` → **new** DEFINER RPC replacing the client's direct `SET balance = 100`. Server
  gate: only when `balance = 0`, at most once per day (`last_refill` column).
- `ensure_wallet(p_display_name)` → **new** DEFINER RPC replacing the client INSERT. Hard-codes
  the starting balance (1000 + 100 first-day bonus = 1100, `last_daily_bonus = now()`), inserts
  `on conflict (user_id) do nothing`, returns the wallet. Models `war_spawn`.
- `donate_coins`, `place_aviator_bet`, `cashout_aviator`, `war_tick`, `war_spawn` → already
  DEFINER and balance-bounded.

**`donate_coins` audit (survivor):** takes a client-chosen `p_amount` but validates it against
the sender's balance and moves coins between two real wallets — it **cannot create coins**, so
it's not a mint and is safe to keep. Caveat (accepted): two accounts can concentrate coins,
which can partly defeat the `045` reset. Documented, not fixed (matches the app's trust model).

**Revoke client `INSERT` on `game_history`.** History rows are inserted only by the `play_*` /
round-settlement RPCs (every terminal path — single-shot, cashout, bust, blackjack settle —
inserts one, so the `LiveBetFeed` keeps working). Prevents feed/leaderboard spoofing. `SELECT
own` stays.

**Verification (hand to Jonas; run in SQL editor before+after the lockdown migration):**
```sql
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='wallets' ORDER BY grantee, privilege_type;
SELECT grantee, privilege_type, column_name FROM information_schema.role_column_grants
WHERE table_schema='public' AND table_name='wallets';
```
After: `authenticated` should have only `UPDATE(display_name)` on `wallets` (no table INSERT/
UPDATE), and `anon` none. Then confirm a raw `UPDATE wallets SET balance=balance+1000` and an
`INSERT INTO wallets(...)` from a normal session are both rejected.

### Single-shot tier (Phase 1)

One RPC per game (DEFINER, `search_path = public`):

```
play_<game>(p_bet int, <choice args>) RETURNS jsonb
  - require auth.uid(); SELECT balance ... FOR UPDATE; reject bet <= 0 and bet > balance
  - roll outcome server-side with random()
  - compute net delta from the game's payout rules (exact replica of the JS engine)
  - UPDATE wallets SET balance = balance + delta WHERE user_id = auth.uid()   -- delta write
  - INSERT game_history (user_id, game, bet, result, payout)
  - RETURN jsonb of the outcome the client animates + the new balance
```

Per-game server logic (odds unchanged; formulas mirror the current client exactly):

| Game | Inputs | Server roll | Net delta | Returns |
|------|--------|-------------|-----------|---------|
| **Dice** | guess 1–6 | r = floor(random()*6)+1 | r==guess → `+bet*4`, else `-bet` | `{roll, win}` |
| **Coin Flip** | choice h/t | random()>0.5 | match → `+floor(bet*0.95)`, else `-bet` | `{result, win}` |
| **Roulette** | kind, number 0–36 | r = floor(random()*37) | number hit → `+bet*35`; color/parity hit → `+bet`; else `-bet` | `{result, win}` |
| **Slots** | — | 5×3 weighted grid (`slotsEngine` WEIGHTS) | `(totalReturn-1)*bet` via paytable/paylines | `{grid, net, lines}` |
| **Plinko** | rows (8/12/16), risk (low/med/high) | `rows` left/right decisions | `floor(bet*mult[rows][risk][slot]) - bet` | `{decisions, slot, mult}` |

Slots/Plinko tables live in the pure JS engines (`slotsEngine.js`, `plinkoGeom.js`) — the
tested source of truth, mirrored verbatim into SQL with a "keep in sync" comment.

### Interactive tier (Phase 2) — public row + separate secrets table

Following Aviator's proven split (a **separate secrets table with no RLS policies** is immune to
the Realtime column leak that a hidden column on the public row is not):

```sql
create table casino_rounds (              -- PUBLIC state (client may read own rows)
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  game text not null,                     -- 'mines' | 'blackjack' | 'chicken-road'
  bet integer not null check (bet > 0),
  status text not null default 'active',  -- 'active' | 'busted' | 'cashed_out'
  state jsonb not null,                   -- revealed cells, shown hand, lane, mult
  created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table casino_rounds enable row level security;
create policy casino_rounds_select_own on casino_rounds for select
  using (auth.role() = 'authenticated' and auth.uid() = user_id);   -- never the broken TO ... USING(true)
-- no insert/update/delete policies → client cannot write; DEFINER RPCs do all writes.

create table casino_round_secrets (       -- HIDDEN: never exposed, never published to Realtime
  round_id uuid primary key references casino_rounds on delete cascade,
  secret jsonb not null                   -- mine layout, full deck order, lane outcomes
);
alter table casino_round_secrets enable row level security;
-- NO policies = deny all client access (SECURITY DEFINER bypasses). DO NOT add to supabase_realtime.
```

**Invariants every round RPC enforces** (closes the races/mints the reviewer found):
- `*_open`: `SELECT balance FOR UPDATE`; reject `bet <= 0` and `bet > balance` **before**
  deducting (otherwise `GREATEST(0, balance-bet)` clamps an over-bet to 0 and the player cashes
  out a mint). Insert the round + secret; deduct the bet.
- Every action/cashout: `SELECT * FROM casino_rounds WHERE id=$1 AND user_id=auth.uid() FOR
  UPDATE`, then re-check `status='active'`. This serializes concurrent calls and prevents
  cashout-after-bust and the auto-cashout-vs-manual-cashout double credit.
- Reveal/step idempotency: revealing an already-revealed cell / re-stepping is a no-op, not a
  re-append (prevents inflating the multiplier).
- **Bet accounting:** deduct at open; on cashout credit `bet + floor(bet*(roundedMult-1))` where
  `roundedMult` uses the **same 2-decimal rounding as the client** — so net = `floor(bet*(mult-1))`,
  identical to today. Bust credits nothing (bet already gone).
- Returned jsonb never includes the secret mid-round (no mine layout, no dealer hole card, no
  unrevealed lane outcomes); the full layout is returned only on a terminal bust.

**Mines** (`mines_open(bet, mine_count∈{1,3,5,7,10})`, `mines_reveal(round_id, cell)`,
`mines_cashout(round_id)`): secret = `mine_count` distinct cells in 0..24; reveal a mine →
busted; safe → recompute `mult = round(max(1.01, Π_{i<revealed} (25-i)/(25-mines-i) × 0.95), 2)`;
auto-cashout when all `25-mine_count` safe cells are revealed.

**Chicken Road** (`chicken_open(bet)`, `chicken_step(round_id)`, `chicken_cashout(round_id)`):
`LANE_MULTIPLIERS=[1.3,2.0,3.2,4.8,7.2,11.0,18.0]`,
`SAFE_PROBS=[0.72,0.64,0.56,0.48,0.40,0.32,0.25]`. Pre-roll 7 lane outcomes at open; step reveals
the next; unsafe → busted; safe → advance; auto-cashout after lane 7.

**Blackjack** (`blackjack_open(bet)`, `_hit`, `_stand`, `_double`) — **highest SQL risk:** secret
= Fisher–Yates-shuffled 52-card deck. Deal 2/1(+1 hidden); resolve naturals; hit draws; double
deducts a second bet, draws one, auto-stands; stand runs dealer to 17+. Payouts at settle (bet
already deducted): blackjack → return `bet + floor(bet*1.5)`; win → `bet*2`; push → `bet`; loss →
`0`; doubles scale the stake. Standard ace 11→1. Written as a tested JS module first, translated
line-for-line, with SQL assertions for Jonas. Implemented **last**; deferrable if it can't be
verified.

### Client refactor (`CasinoContext.jsx` + per-game components)

- Add `play(game, args)` → calls `supabase.rpc('play_<game>', ...)`, reconciles balance via the
  existing `balanceRef` + serial write-chain, returns the outcome. Replaces local resolution for
  single-shot games.
- Add `openRound` / `roundAction` / `cashoutRound` wrapping the interactive RPCs.
- `placeBet` (client-decides-win) is **removed** once all games are migrated, strictly **before**
  `game_history` INSERT is revoked.
- Wallet creation switches from a direct INSERT to `ensure_wallet`; `claimRefill` switches to
  `claim_refill`; `adjustBalance` keeps `apply_balance_delta` (now spend-only).
- Each game changes from "compute outcome locally → animate" to "call RPC → animate toward the
  server's outcome." Animations/layouts/timings unchanged. Interactive games gain a network
  round-trip per action (a per-action pending state; acceptable for this app).
- **Fail-closed:** if a play/round RPC is missing or errors, the game surfaces an error rather
  than resolving locally. (This governs only the *new* client; see the rollout caveat.)

### Pure JS engines (testability backbone)

Game math is extracted into pure modules under `src/pages/casino/`: existing `slotsEngine.js`✓,
`plinkoGeom.js`✓, plus **new** `diceEngine.js`, `coinflipEngine.js`, `rouletteEngine.js`,
`minesEngine.js`, `chickenEngine.js`, `blackjackEngine.js` — extracting today's inline logic
faithfully. (This extraction is the **bulk of the real work**, not a side detail.) Each module:
is the tested source of truth (`node --test src/pages/casino/*.test.js`); is what the SQL is
translated from (constants duplicated verbatim, war-style); and powers a `scripts/casino-sim.mjs`
RTP/distribution simulation. The client may reuse them for animation, **never** to decide
outcomes.

## Testing / verification strategy

There is **no local Postgres** here (no Supabase CLI, psql, or Docker), so the SQL cannot be
executed in this environment. Mitigations:

- **Verified before delivery:** `npm run build` clean; `node --test` green for every engine +
  parity tests; `node scripts/casino-sim.mjs` reports each game's RTP/distribution matching the
  intended (current) values.
- **Handed to Jonas (live-DB only):** `supabase/tests/casino_checks.sql` — the grant/RLS
  verification queries above, plus **distribution sanity checks** over many calls. Note: `random()`
  cannot be seeded per-call (only `setseed()` per session), so SQL self-tests are
  distribution/RTP checks, **not** exact-value assertions; exact-value correctness is pinned by
  the JS engine tests that the SQL mirrors.
- **SQL ↔ JS parity:** the SQL is a faithful translation of the tested engines; constants
  duplicated verbatim with a "keep in sync" comment (existing war pattern).

## Migrations & rollout (staged, reversible, ordered)

Migrations are manual and numbered (`CLAUDE.md` §5). Highest existing is `037`. New files — all
idempotent (`create … if not exists`, `create or replace function`, `drop … if exists`) with a
commented rollback:

**Additive (safe; nothing breaks; applied first, before the frontend deploy):**
1. `038_casino_play_singleshot.sql` — `play_dice/coinflip/roulette/slots/plinko` (DEFINER).
2. `039_casino_rounds.sql` — `casino_rounds` + `casino_round_secrets` tables + RLS.
3. `040_casino_mines.sql`, `041_casino_chicken.sql`, `042_casino_blackjack.sql` — round RPCs.
4. `043_casino_wallet_rpcs.sql` — **additive:** add `ensure_wallet` + `claim_refill` (+
   `last_refill` column); convert `claim_daily_bonus`/`settle_ad_reward`/`apply_balance_delta`
   to DEFINER and make `apply_balance_delta` negative-only. These don't break the old client
   (which still writes directly until `044`) and ensure the new client's `ensure_wallet`/
   `claim_refill` exist before it deploys (no broken-refill gap).

**Breaking / cheat-closing (applied LAST, after the new client is verified live):**
5. `044_wallet_lockdown.sql` — `revoke insert, update on wallets from authenticated, anon`;
   `grant update (display_name)`; `drop function settle_bet`; revoke client `game_history` INSERT.
6. `045_reset_money.sql` — reset balances to baseline (modeled on `030_reset_money.sql`).

**Cutover order (Jonas runs SQL; frontend deploys separately):**
1. Jonas applies `038`–`043` (all additive). Safe.
2. Deploy the frontend calling the new RPCs.
3. Verify every game end-to-end against the live DB.
4. Jonas applies `044` + `045`.

**Honest limitation (no true fail-closed):** the `Math.random`/direct-RPC exploit stays
**fully open until `044`** is applied — a user on an old cached bundle, or anyone calling the
anon key directly, can keep minting via the still-present `settle_bet`/positive
`apply_balance_delta`/direct `wallets` writes until the final revoke. The new client stops being
*self*-exploitable the moment it ships (it no longer computes outcomes), but only `044` closes
the hole for everyone. Given separate deploy actors, this window is unavoidable; flag it so
`044` is applied promptly after verification.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| SQL can't be run/tested here | Logic written as tested JS first, translated faithfully; SQL grant/distribution self-tests for Jonas; staged reversible migrations; lockdown last. |
| Lockdown leaves a writable path (anon/blanket grant, INSERT) | Mirror migration `028` exactly: revoke INSERT+UPDATE from `authenticated, anon`, grant back only `display_name`, route creation through `ensure_wallet`; ship before/after verification queries. |
| Lockdown breaks War / donations / ad rewards / rename / refill | All positive paths go through DEFINER RPCs or `war_tick`; `apply_balance_delta` stays for negative war spends; `display_name` write preserved; `ensure_wallet`/`claim_refill` added additively first. |
| Interactive over-bet / race double-credit / replay | `FOR UPDATE` row lock + `bet<=balance` check before deduct + `status='active'` re-check + reveal dedupe in every round RPC. |
| Secret leakage (Realtime, `select=*`, error) | Separate `casino_round_secrets` table, no RLS policies, never added to the Realtime publication; mid-round RPC returns never include the secret. |
| Blackjack PL/pgSQL complexity | Tested JS reference + line-for-line translation + SQL assertions; implemented last; deferrable. |
| Frontend ships before migrations | Additive migrations first + documented order; fail-closed new client; cheat window honestly documented (closes at `044`). |
| `donate_coins` two-account concentration | Accepted (balance-bounded, can't mint); documented. |
| Payout drift | Replicate exact client formulas incl. 2-decimal mult rounding and `(mult-1)` net form. |

## Success criteria

- Overriding `Math.random` has **no effect** on payouts (outcomes come from the server).
- A positive `apply_balance_delta`, a direct `UPDATE wallets SET balance`, **and** a direct
  `INSERT INTO wallets` are all **rejected** for a normal session.
- `settle_bet` no longer exists.
- Every game plays end-to-end with unchanged odds, payouts, and feel.
- `npm run build` clean; all `node --test` suites green; simulation RTPs match intent.
- CP War purchases, donations, daily bonus, ad rewards, renames, refill, and wallet creation
  still work.
