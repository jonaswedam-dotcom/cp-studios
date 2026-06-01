# CP War 2.1 — Engagement & Balance Pass

**Date:** 2026-06-01
**Status:** Draft (design); pending user review → implementation plan
**Author:** Brainstormed with the maintainer (founder-requested)
**Builds on:** `docs/superpowers/specs/2026-05-31-cp-war-real-map-redesign-design.md` (CP War 2.0)

## Summary

CP War 2.0 shipped a playable, server-authoritative, real-world-map conquest game. Playing it
surfaced gaps that make it feel slow, opaque, and tactically thin. This is a **tuning &
engagement pass** — eleven targeted changes, no new subsystems and no new dependencies —
delivered in **four independently shippable phases**.

The headline change (already applied, separate from this spec) cut city-to-city travel from
1h to 20m (`src/war/units.js`). That makes the game far more session-friendly **but removes the
"slow legs give a defender time to react" safety the 2.0 design leaned on** — so the work here
leads with feedback/notification surfaces (Phase 1) before deepening combat (Phase 2),
rebalancing the economy (Phase 3), and closing a fairness gap (Phase 4).

This reuses everything from 2.0: the pure tested `src/war/*` logic modules, the thin
React/MapLibre layer, the `pg_cron` `war_tick()` server authority, and the shared coin wallet.
It adds **one small table** (`war_events`), **one jsonb column** (`war_movements.units`), **one
RPC** (`war_spawn()`), and edits to the tick — all via new idempotent migrations `025+`.

## Goals

- The world should feel **alive**: you should always know what happened to you (captures,
  losses, incoming attacks) without staring at the map, and see your forces in transit.
- Battles should have **tension and the occasional upset**, and a failed attack should sting
  without being a total wipe — so probing and aggression are viable.
- Each unit should have a **real tactical identity**: combined-arms assaults, coin-efficient
  tanks, and warships that actually ferry an army across water.
- Holding territory should **pay for itself**, and raw casino wealth should **not** instantly
  translate into an unbeatable army.
- Close the **self-settable-shield** fairness gap without abandoning the friends-and-family
  client-trust model for unit purchases.

## Non-goals (YAGNI for now)

- **Push / phone notifications.** In-app toasts + a persistent activity log only. Web Push
  remains a deferred future idea (it needs a service worker + permission flow).
- **A separate war currency.** The single shared wallet (casino + war = one currency) is a
  locked 2.0 pillar; we add *friction*, not a second economy.
- **Server-authoritative unit purchases.** Buying troops stays client-side (same trust class as
  the casino, per `CLAUDE.md` §4). The army-size cost curve is therefore a client-enforced soft
  cap — acceptable for this private app; the future `send_units()` RPC could harden it.
- **Cross-mode combined arms** (e.g., soldiers riding along on an *air* strike). Combined arms
  is **within a movement mode** only — it's incoherent to mix land/air given reachability differs.
- **Seasons / resets / win condition.** Out of scope here, as in 2.0.

## Core decisions (locked with the maintainer)

| Topic | Decision |
|-------|----------|
| Combined arms | **Mixed-stack movements, by mode.** One movement carries a mix of *same-mode* units. Land = soldiers + tanks (arrive together at the slower tank speed). Air = jets only. Sea = warships **ferrying** soldiers/tanks up to a capacity. New `war_movements.units` jsonb. |
| Warship role | Warships **carry** land units across the sea (the 2.0 design's intent, never implemented), capacity **20 land units per warship**. The whole stack (warships + cargo) fights as one combined force on arrival. |
| Combat randomness | Each side's effective strength rolls **×uniform[0.85, 1.15]** at resolution (two independent draws). Server roll is authoritative; the client shows an *expected* outcome + rough win chance. |
| Failed-attack loss | A losing attacker **retreats ~25%** of the committed stack back to the origin province (if still owned), instead of a 100% loss. Defender-holds survivor scaling is unchanged. |
| Event feed | New **`war_events`** table written by the tick; realtime **toasts** + a persistent **Activity** panel. In-app only. 7-day retention pruned by the tick. |
| In-transit visibility | Sidebar shows **outgoing movements + ETAs, incoming attacks, shield countdown, income/hr** — all from already-loaded data. |
| Reachable highlighting | On selecting an owned province, the map **tints reachable targets** (enemy-attackable vs own/neutral in distinct shades). |
| Tank rebalance | Tank cost **500 → 400** (strength stays 5) → **80 coins/strength** vs the soldier's 100. Tanks become the coin-efficient muscle, paid for by being slower (40m). |
| Territory income | **+10 coins/province/hour**, folded into the existing vault + ~10h cap. Rate = `banks_level_sum × 50 + province_count × 10`. |
| Currency friction | Marginal unit cost rises with total army size: **×min(3, 1 + 0.25 × floor(totalUnits / 1000))**, stacking with the factory discount. |
| Shield fairness | Move shield grants to a **`war_spawn()` SECURITY DEFINER RPC** (48h shield set server-side). **Column-level `REVOKE UPDATE (shield_until)`** stops clients extending their own shield. Also fixes the 2.0 spawn "false success" bug. |

## Player-facing behaviour

### Knowing what's happening (Phase 1)
- A toast pops on live events: **"⚔ Captured Lyon (+2,400)"**, **"💀 Lost Cairo to Alex"**,
  **"🛡 Defended Tunis"**, **"✈ Attack on Cairo failed"**.
- A sidebar **Activity** panel keeps the recent history (persists across reloads) so you see what
  happened while you were away.
- A sidebar **status** panel shows: your **shield** countdown, **income/hr**, your **outgoing**
  forces with live ETAs, and **incoming** attacks (with ETA + attacker name) so you can rush a
  defence.
- Selecting one of your provinces **highlights** everywhere your forces can move/attack from it.

### Fighting (Phase 2)
- The move modal lets you assemble a **mixed force** valid for the leg:
  - **Land** (to a bordering province): soldiers + tanks. Arrives in 40m if any tank, else 20m.
  - **Air** (to anywhere within jet range, incl. across water): jets only. 10m.
  - **Sea** (coastal → coastal within warship range): warships, optionally **ferrying** soldiers
    and tanks up to 20 land units per warship. 40m.
  - If a destination is reachable by more than one mode, the modal offers a mode toggle.
- On arrival the **whole stack fights as one** (vs the defender's combined garrison), with the
  ±15% rolls. Win → your mixed survivors hold the province; lose → ~25% limp home.

### Growing (Phase 3)
- Every province you hold trickles **+10 coins/hr** even with no bank — expansion finally pays.
- Tanks are now the **value** purchase; soldiers the **fast** one.
- As your army grows, **each new batch costs more**, so a windfall at the casino buys a strong
  army but not an instant, infinitely-scalable doomstack.

### Fairness (Phase 4)
- New players get their 48h shield **granted by the server**; nobody can hand themselves a
  permanent shield to become un-attackable.

## Game model & math

All constants below are **tunable** and **must be mirrored** between `src/war/*.js` and
`023_war_tick.sql` (and successors). See "JS↔SQL parity" under Testing.

### Movement (replaces single-type moves)
- `war_movements.units` jsonb, e.g. `{"soldier":120,"tank":8}` or `{"warship":10,"soldier":80}`.
  Legacy `unit_type`/`count` columns remain nullable and unused by the new client; the tick reads
  `units`.
- **Mode validity** (client-enforced in the move modal, re-derived in the tick from the stack):
  - `land`: keys ⊆ {soldier, tank}; `to_region ∈ landNeighbors(from)`.
  - `air`:  keys ⊆ {jet};            `to_region ∈ airReachable(from, jet.airRangeKm)`.
  - `sea`:  contains ≥1 warship, other keys ⊆ {soldier, tank}; cargo land-count ≤
    `20 × warships`; `from` and `to` coastal; `to ∈ seaReachable(from, warship.seaRangeKm)`.
- **Arrival:** `arrives_at = now + max(UNITS[t].travelSeconds for t in units)` (computed client-side,
  honoured by the tick exactly as today).

### Combat (extends `resolveCombat`)
- Attacker strength = `Σ units[t]·strength[t]` × Lab mult, minus anti-air on the jet portion
  (unchanged formula, now over the whole stack). Defender strength = garrison Σ × Bunker mult ×
  (×1.5 if defender offline >24h) — unchanged.
- **Randomness:** `aEff = aStr · r_a`, `dEff = dStr · r_d`, with `r = 0.85 + rng()·0.30`.
  - `resolveCombat(attack, defense, opts)` gains `opts.rng` (defaults to `Math.random`) for
    deterministic tests; the SQL tick uses `random()`.
- **Outcome:**
  - `aEff > dEff` → **attacker captures**. Survivors = `scaleToStrength(attackStack, aEff, aEff−dEff)`
    then `ensureSurvivor` — a **mixed** stack written across all unit columns. Loot + building
    downgrade + flip as today.
  - else → **defender holds**. Defender scaled by `(dEff−aEff)/dEff` (unchanged). **New:**
    attacker **retreats** `floor(0.25 × units[t])` of each type back to `from_region` *iff* the
    sender still owns it (mirrors the existing shield-bounce write); otherwise lost.
  - `resolveCombat` return shape becomes `{ winner, survivors, retreat }` (`retreat` = the losing
    attacker's returned remnant; empty when the attacker wins).
- **Loot** is unchanged: a capture kills the whole garrison, so `lootFraction` is always 0.8;
  `loot = floor(0.8 · defenderRawStrength · COIN_PER_STRENGTH)`.

### Economy
- **Territory income.** Tick accrual rate per player `rate = Σ bank.level·50 + provinceCount·10`
  (coins/hr). `accrued = floor(rate · hoursSinceLastIncome)`; vault `cap = rate · 10`. Advance
  `last_income_at` by the whole-coins-worth-of-time (the existing remainder-carrying trick);
  when `rate = 0` (eliminated, no banks) keep it at `now()`.
  - `incomePerTick`/the income helper gains a `provinceCount` input; `INCOME_PER_PROVINCE_PER_HOUR = 10`.
- **Army-size cost curve.** New `armySizeMultiplier(totalUnits) = min(3, 1 + 0.25·floor(totalUnits/1000))`.
  `troopCost(type, count, costMult, armyMult)` multiplies it in alongside the factory `costMult`.
  Computed client-side from the player's current total units (same trust model as today's buy).
- **Tank cost** `500 → 400` in `UNITS` (client only — purchases never touch SQL).

### Fairness
- `war_spawn(p_region text, p_country text, p_color text, p_name text)` SECURITY DEFINER:
  auth required; idempotent if the player already exists; validates `p_region` is unclaimed;
  inserts `war_players` with `shield_until = now() + interval '48 hours'`; upserts the HQ region
  with `START_ARMY`. Returns the spawned region id (or raises on a full/claimed conflict so the
  client can surface a real error).
- `REVOKE UPDATE (shield_until, vault, last_active_at, last_income_at, is_alive) ON war_players
  FROM authenticated; GRANT UPDATE (display_name, color, spawn_region) ON war_players TO
  authenticated;` — clients keep the legitimate self-edits; shield/vault/activity become
  definer-only. (`spawn_region` stays client-writable for the respawn path.)

## Departures from current architecture

None structural. This stays within the 2.0 model: pure logic in `src/war/*`, thin React/MapLibre
layer, server-authoritative `war_tick()`. The only *new* primitive is the `war_events` log and a
per-user realtime subscription for it. Unit purchases remain client-authoritative by design.

## Data model (new migrations 025+; do not edit shipped 019–024)

- **`war_events`** (migration 025): `id bigint identity`, `created_at timestamptz default now()`,
  `player_id uuid` (the player who should see it), `kind text` CHECK in
  `(captured, lost, defended, attack_failed, bounced, eliminated)`, `region_id text`,
  `detail jsonb` (opponent name, coins, etc.). Index `(player_id, created_at desc)`. RLS:
  `select` where `player_id = auth.uid()`; **no client insert** (definer/tick only). Add to
  `supabase_realtime` publication.
- **`war_movements.units jsonb not null default '{}'`** (migration 026). `unit_type`/`count`
  remain (legacy, nullable).
- **`war_spawn()` RPC + column privileges** (migration 028).
- No change to `war_regions`/`war_buildings`/`war_players` columns (province count is derived).

## Code structure

- **`src/war/units.js`** — tank cost 400; (travel times already updated).
- **`src/war/combat.js`** — `resolveCombat` gains `opts.rng` + returns `{winner, survivors, retreat}`;
  helpers reused for mixed stacks (already stack-based). New tests for rng injection / retreat /
  mixed survivors.
- **`src/war/economy.js`** — `armySizeMultiplier(totalUnits)`; `troopCost`/`maxAffordable` take
  the extra multiplier.
- **`src/war/buildings.js`** — `INCOME_PER_PROVINCE_PER_HOUR`; income helper takes `provinceCount`.
- **`src/war/movement.js`** *(new, pure)* — `validateMove(fromId, toId, stack, graph)` →
  `{ mode, arrivesInSeconds }` or an error; centralises the mode/reachability/capacity rules so
  the modal and any future server check share one source. Co-located test.
- **`src/war/MoveUnitsModal.jsx`** — rework to pick a **mixed** stack with a mode toggle, capacity
  + range + arrival readout (reuse `formatDuration`).
- **`src/war/Sidebar.jsx`** — add **status** (shield/income/in-transit/incoming) and **Activity**
  (event feed) panels.
- **`src/war/MapView.jsx`** — reachable-target highlight layer on selection; mixed-stack movement
  animation (one animation per movement, as today).
- **`src/war/useWarData.js`** — subscribe to `war_events` (per-user filter); expose `events`.
- **`src/pages/WarPage.jsx`** — call `war_spawn()` RPC instead of the raw insert/upsert; write
  `units` jsonb on move; pass `provinceCount`/`totalUnits` into cost/income; surface event toasts.
- **`supabase/migrations/025_war_events.sql … 028_war_spawn.sql`** — table+RLS+realtime; tick
  event writes; `units` column + tick combat rewrite (mixed stack, rng, retreat, mixed survivors,
  per-province income); `war_spawn()` + column privileges.

## Phasing (each phase is shippable)

1. **Make it feel alive** — `war_events` (025) + tick writes events using the *current* combat
   logic; Sidebar status + Activity panels; reachable-target highlighting; realtime toasts.
   *Most urgent — the 20m timers need this.*
2. **Combat depth** — `war_movements.units` (026) + tick combat rewrite (mixed stack, ±15% rng,
   25% retreat, mixed survivors, warship ferrying); `resolveCombat` + new `movement.js`; rebuilt
   move modal. Event details updated to the richer outcomes.
3. **Balance & economy** — tank cost; per-province income (027 tick accrual rework); army-size
   cost curve. (Tank cost + army curve are client-only; only income touches SQL.)
4. **Fairness** — `war_spawn()` RPC + `shield_until` column lockdown (028); client switches to the
   RPC.

## Visuals

- Toasts reuse the existing flash style; the **Activity** and **status** panels reuse the
  `cp-elevated`/`cp-card` sidebar cards, DM Sans, and the existing icon convention (inline SVG).
- Reachable highlight: a faint owner-coloured fill for own/neutral reachable, a faint red edge
  for attackable enemy reachable — within the existing dark palette, no new ad-hoc hex.
- Per the scan's UI notes, fold in the shared modal niceties opportunistically when reworking the
  move modal (`modal-in`/`backdrop-in` + ✕), but that polish is not a goal of this spec.

## Testing / verification

- `node --test src/war/*.test.js` stays green; `npm run build` clean (no test suite gate today —
  see the scan's CI recommendation, out of scope here).
- **New unit tests:** `resolveCombat` with injected `rng` (deterministic upset + normal outcome),
  `retreat` remnant math, mixed-stack survivors; `armySizeMultiplier` thresholds + 3× cap;
  per-province income rate + cap; `movement.js` mode/capacity/range validation.
- **JS↔SQL parity test** (`src/war/parity.test.js`, new — implements the scan's recommendation):
  parse the migration SQL text and assert the embedded constants equal the JS exports — unit
  strengths, **rng band 0.85/1.15**, **retreat 0.25**, loot 0.8 / `COIN_PER_STRENGTH` 5, neutral
  hash, **income 50/level & 10/province**, vault 10h. Converts every comment-guarded invariant in
  this spec into a CI-checkable one.
- **Manual walkthroughs:** mixed land assault arrives together and fights as one; warship ferry
  lands an army overseas; an upset (smaller force wins) and a retreat (25% returns home) both
  occur; an event toast + Activity entry appear for capture/loss/defence; incoming-attack ETA
  shows for the defender; territory income accrues with no bank; the army-size curve raises the
  buy price; a client cannot extend its own `shield_until`; `war_spawn()` is idempotent and
  surfaces a real error when the world is full.

## Open questions (non-blocking — settle in the plan)

- **Migration numbering if 019–024 get applied first.** Memory notes 019–024 are pending. The plan
  assumes new `025+` files; if a phase's change is small and 019–024 are still unapplied at build
  time, folding may be cleaner — decide per phase, defaulting to new files.
- **Event-feed volume.** 7-day pruning + per-user index is the starting bound; revisit a per-player
  row cap if a heavy session floods the log.
- **Multi-mode destination default.** When a target is reachable by several modes, which mode the
  modal pre-selects (proposed: cheapest/fastest available) — a UI nicety to settle in the plan.
- **Exact tuning** of the rng band, retreat %, province income, army-curve step/cap, and warship
  capacity — shippable defaults are chosen above; tune against feel during manual testing.
