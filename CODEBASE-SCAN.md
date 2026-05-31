# Codebase Scan Report — CP War feature

**Scanned:** `cp-studios` → the CP War feature (`src/war/*`, `src/pages/WarPage.jsx`, `supabase/migrations/019`–`024`, `scripts/build-war-geo.mjs`, `vercel.json`)
**Date:** 2026-06-01
**Project profile:** Fullstack feature inside a client-only React 18 + Vite SPA on Supabase. ~1,280 LOC JS/JSX (8 pure-logic modules + 6 React components + 1 hook + orchestrator) + 368 LOC SQL (the server-authoritative `pg_cron` tick + RLS). MapLibre map; the SQL migrations are the "backend."
**Agents run (13):** CORE-ARCH, CORE-QUALITY, CORE-TESTS, CORE-DEPS, CORE-DOCS, BACKEND-CORRECTNESS×2 (SQL tick / pure JS), BACKEND-SECURITY, BACKEND-PERF, FRONTEND-CORRECTNESS×2 (orchestration / map+modals), FRONTEND-UI, IMPROVEMENTS.

---

## Executive Summary

**No critical bugs and no exploitable security holes were found in the shipped CP War feature.** Across 13 specialist agents the `🔴 Critical` count is **0** and the `🟠 High` count of genuinely-must-fix-now items is effectively **0** — the few items initially tagged High resolved on closer inspection to either verified-safe, documented accepted trade-offs, or UI polish. The feature is the best-architected in the repo: pure tested game-logic modules, a thin React/MapLibre layer, and a `SECURITY DEFINER` `war_tick()` that makes combat/income server-authoritative; all 33 `node:test` tests pass and `npm run build` is clean. Migration 024 correctly closes the three exploits it targeted (enemy-row writes, planting buildings on others' regions, defenders cancelling incoming attacks) and the `vercel.json` CSP was extended for MapLibre without weakening any directive. The three things worth acting on are minor and bounded: a **false "You start in X!" flash when a spawn insert fails** (reachable now, pre-migration), a one-word **doc inaccuracy** ("overnight" vs the per-minute tick), and the **JS↔SQL constant duplication** (currently in-sync, but guarded only by comments). Everything else is scaling headroom, UI nicety, or the documented friends-and-family client-trust model.

## Health Scorecard

| Dimension | Score | Top Finding |
|-----------|-------|-------------|
| Architecture | 🟢 Good | Clean 3-tier (logic / React / SQL); only debt is duplicated JS↔SQL constants |
| Code Quality | 🟢 Good | Well-organized; `war_tick()` + `WarPage` handlers are the dense spots; one false-success error path |
| Backend Correctness (SQL tick) | 🟢 Good | Combat/income/neutral math verified; no divide-by-zero, no double-credit, idempotent |
| Backend Correctness (JS logic) | 🟢 Good | 33/33 tests pass; remaining items are clamps in now-dead spec-mirror modules |
| Backend Security | 🟢 Good | 024 closes all 3 targeted exploits; only self-set `shield_until` (accepted-adjacent) |
| Backend Performance | 🟢 Good | Fine at F&F scale; full-table per-minute writes + a couple O(n²) client paths to watch at scale |
| Frontend Correctness | 🟡 Fair | Spawn insert errors unchecked (false success); stale balance is the accepted casino pattern |
| Frontend UI / Consistency | 🟡 Fair | War modals skip the app's `modal-in`/close-button pattern; `grid-cols-4` "Warship" tight on small phones |
| Test Coverage | 🟡 Fair | 8/8 logic modules tested, but CI runs **no** tests and nothing guards JS↔SQL parity |
| Dependencies | 🟢 Good | Healthy, locked, permissive licenses; `maplibre-gl` one major behind (deliberate) |
| Documentation | 🟡 Fair | DATABASE.md/CLAUDE.md accurate except "overnight" wording; README is broadly stale |

---

## Critical Issues (Fix Now)

**None.** No 🔴 Critical and no true 🟠 High must-fix-now bug was found. The items below are 🟡/🔵 and bounded; the highest-value ones are applied as follow-up fixes (see "Fixes applied").

---

## Architecture & Structure  (🟢 Good)
Clean three-tier separation: pure logic (`src/war/*.js`, an acyclic graph rooted at `units.js`, each with a co-located test) → React/MapLibre layer (`*.jsx`, dumb modals, one MapLibre integration) → SQL server layer (migrations 019–024, layered by concern). Trust boundary is deliberate and documented.
- 🟠→🟡 **Duplicated game constants across the JS↔SQL boundary** (`src/war/{units,buildings,spoils,neutral}.js` ↔ `023_war_tick.sql`), kept in sync only by comments. *Verified in-sync today*; the risk is future drift. Mitigation: a parity test (see Improvements).
- 🟡 `WarPage.jsx` (280 lines) is an over-loaded orchestrator (UI state + 5 write handlers + spawn + income poll + reachability). Could extract a `useWarActions` hook.
- 🔵 Dead-code orphan `src/pages/WarComingSoon.jsx` (unimported; `WarPage` defines its own inline version) and unused `setRegions`/`loadAll` returns from `useWarData`. Pre-existing; flagged in CLAUDE.md §6 — don't delete without sign-off.

## Code Quality & Patterns  (🟢 Good)
Small single-purpose modules, zero TODO/FIXME debt markers, careful error handling in every player-action handler (including a compensating restore on a failed move insert). Densest units: `war_tick()` (4-deep branching) and `WarPage` handlers.
- 🟡 **First-join spawn effect swallows insert errors** (`WarPage.jsx:84-91`): the `war_players` insert and `war_regions` upsert don't check `{ error }`, so a failed spawn still shows "You start in X!" — the one inconsistent omission vs every other handler. **(Fixed below.)**
- 🟡 Defender strength is re-typed inline in SQL (`023:127` `soldier*1 + tank*5 + …`) instead of reusing `war_unit_strength()` — a 4th copy of the strength table.
- 🔵 Income RPC + `loadAll` failures are silent (no `console.error`).

## Backend — Correctness & Edge Cases (SQL tick, migrations 019–024)  (🟢 Good)
Hand-traced all branches and the three crafted scenarios (defender holds 100v60→40; attacker 150v100→capture, 50 survivors, 400 loot; shield bounce). Verified: no divide-by-zero (the `/d_str` hold-branch only runs when `d_str>0`; income `/(lv*50)` guarded by the `lv=0` arm), no double-credit (`for update` + zero-then-credit; `excluded.balance` upsert correct), idempotency of 020–024, `format()` injection-safe (`%I` on a CHECK-constrained enum), neutral-hash + survivor + loot parity with JS.
- 🟡 **Neutral capture ignores leftover units on owner-deletion** (`023:89-98`): if `owner_id` is nulled by the FK `on delete set null` while unit columns remain, the region is taken as if it held only the synthetic garrison and the real units are zeroed. Only triggers on account deletion; "unowned = neutral" may be intended — make it a deliberate decision.
- 🟡 **Lose-all-banks-then-rebuild pays retroactive income** contrary to the comment at `023:165-166` (the "no back-income" guarantee only holds for players who *never* had a bank). Self-inflicted and capped at 10h.
- ℹ️ **"Offline dug-in ×1.5 mis-fires for active players" — NOT a bug.** One agent flagged that `last_active_at` is only stamped by `war_collect_income()`. Resolved: the client income effect calls that RPC **unconditionally every 60s** while the war page is open, so an actively-playing defender stays "active"; the ×1.5 correctly applies only to players who haven't opened the war page in 24h.
- 🔵 `count>0` constraint add (024) would fail only on a dirty non-fresh DB (no such rows possible via the app).

## Backend — Security  (🟢 Good)
- ✅ **All three targeted exploits are closed.** Enemy `war_regions`/`war_buildings`/`war_movements` writes blocked (owner-scoped; `owner_id` can't be flipped because Postgres reuses `USING` as the implicit `WITH CHECK`); planting buildings on another player's region blocked by the new `exists(region owned by me)` clause; defenders can't cancel incoming attacks (movement update is `player_id`-scoped).
- ✅ SECURITY DEFINER hygiene sound: `search_path` pinned; `war_tick` revoked from clients (only `pg_cron`, which runs as owner, can call it); `war_collect_income` is self-scoped, locked, can't credit another wallet or double-credit. Loot/income are server-bounded; the 10h vault cap isn't bypassable via the tick. CSP correctly extended for MapLibre worker + Carto tiles without weakening `default-src`/`frame-ancestors`/`object-src`. No regression to `wallets` or other shared tables.
- 🟡 **Self-settable `shield_until`** (`war_players_update`, 019): a member can set their own shield far in the future → other players can never attack them. Affects others, but it's the same self-edit trust class as the accepted self-wallet edits. To enforce, move shield grants into the definer/tick path.
- 🔵 Self-set `vault` then collect, and a member fabricating their own movement `count`/`unit_type` = the **documented accepted client-trust trade-offs** (CLAUDE.md §4; the future `send_units()` RPC would close them). Not new gaps.

## Backend — Performance & Scalability  (🟢 Good at F&F scale)
The tick's critical index `war_movements(status, arrives_at)` exists. Sound for a handful of players.
- 🔵 **Scaling shape:** the income phase and the alive-flag phase each rewrite **every** `war_players` row every minute (with a per-player correlated `war_buildings` sum) — O(players) writes/min forever. Narrow to players with banks / possible ownership changes, and use a grouped aggregate, if the world grows.
- 🔵 `syncMarkers` runs `buildings.filter` per owned region (O(regions×buildings)) and rebuilds all markers on any change; `onRegionClick` does 2×~4,600-region haversine scans per click; the rAF loop iterates all movements ~60fps and never idles. All fine now; build a `region→count` Map / memoize / stop the idle rAF at scale.
- 🔵 Optional composite indexes `war_buildings(owner_id, type)` and `(region_id, type)` match the tick's repeated typed sums.

## Frontend — Correctness & Bugs  (🟡 Fair)
Realtime DELETE handlers correctly read `payload.old`; income effect + channel cleanup are correct; build is clean.
- 🟡 **Spawn inserts unchecked → half-spawn / false success** (`WarPage.jsx:84-91`) — see Code Quality. **(Fixed below.)**
- 🟡 **Income collector calls `loadBalance()`** (`WarPage.jsx:198`), which re-runs the full daily-bonus check + a `display_name` backfill query every time income>0 is collected. Low impact (bonus only re-grants across a 24h boundary, which the player is owed anyway), but it couples income refresh to the bonus machinery. Cleanest fix: a balance-only refresh in `CasinoContext`. *(Documented; not changed — touches shared casino code for a minor polish.)*
- 🟡 **Stale-`balance` absolute writes** in `adjustBalance` across buy/build + the 60s income credit = the documented §4 casino client-authoritative trade-off; a relative-update RPC would close it.
- 🔵 **Graph fetch has no retry** (`useWarData.js:12-19`): a transient failure on the same-origin `provinces.json` latches the loading spinner. Unlikely (static asset) but a reload-only recovery.
- 🔵 Spawn color/region TOCTOU under simultaneous joins; `loading` never clears if `userId` is falsy (route-guarded, so benign).

## Frontend — Correctness & Bugs  (map + modals)  (🟢 Good)
Null-safety, keys, controlled inputs, and the `dangerouslySetInnerHTML` SVG (static `UNIT_SVG`, CHECK-constrained `type` key — no XSS) all verified safe. Map/marker/rAF/channel cleanup correct.
- 🔵 **Stale province tint on region DELETE** (`MapView.jsx:86-93`): `syncOwnership` only iterates current `regions`, so a *deleted* region keeps its tint until reload. In practice the tick never deletes region rows (it changes `owner_id`), so this path is effectively dead — defensive only.

## Frontend — UI/UX & Design Consistency  (🟡 Fair)
Design system correctly detected (`cp-*` palette, DM Sans/Playfair, `modal-in`/`backdrop-in`). UX state coverage (loading/eliminated/disabled/empty) is good.
- 🟡 **`grid-cols-4` unit buttons + "Warship" label wrap/crowd on ≤360px phones** (`BuyUnitsModal.jsx:20-31`).
- 🟡 War modals **omit the app's `modal-in`/`backdrop-in` animations and the header `✕` close button** that every other modal uses; the 3 modals also triplicate the shell — a shared `<WarModal>` would dedupe + fix both.
- 🟡 Flash toast (no max-width, `top-20`) can wrap and touch the eliminated banner (`top-36`) on mobile; eliminated banner's `w-full mx-4` + `-translate-x-1/2` can shift off-center.
- 🔵 Stray off-palette `bg-[#0a0a0a]` vs `cp-bg`; war uses ad-hoc red/blue (deliberate faction colors) instead of `cp-accent`; BuildingsModal has no `max-h`/scroll.

## Test Coverage & Quality  (🟡 Fair)
8/8 pure-logic modules have co-located tests; **33/33 pass** in ~85ms; assertions are mostly exact. Good for a hobby project.
- 🟡 **CI runs no tests** — `.github/workflows/deploy.yml` goes `checkout` → `npx vercel --prod`; the suite never gates deploys, and there's no `test` script in `package.json`.
- 🟡 **Nothing guards JS↔authoritative-SQL parity** — the JS tests can be green while `war_tick()` diverges. The neutral-hash parity is asserted only by a comment.
- 🔵 Gaps: combined combat modifiers (Lab+Bunker+Anti-Air), `antiAir`-fully-cancels-jets, `stackFromRow`, `buildingCost` unknown/negative type; one weak `>= 1` survivor assertion that should be `=== 1`.

## Dependencies & Package Health  (🟢 Good)
`maplibre-gl ^4.7.1`, `topojson-client` (runtime), `topojson-server`/`-simplify` (dev — correct split, no dev dep leaks to runtime), `@supabase/supabase-js`. Lockfile present + in sync; all permissive licenses (BSD-3/ISC/MIT); Phase 2/3 added no new deps.
- 🔵 `maplibre-gl` is one major behind (v5 is current) — a deliberate, scheduled migration, not urgent. Run `npm audit` before releases; consider an `engines.node` field.

## Documentation & Developer Experience  (🟡 Fair)
`docs/DATABASE.md` and `CLAUDE.md` are accurate and current for Phase 2/3 (tables, columns, migration index, setup checklist incl. pg_cron + Realtime, the duplicated-constants warning); inline SQL comments in 023/024 are exemplary.
- 🟡 **CLAUDE.md "overnight `pg_cron` server tick"** contradicts the actual per-minute (`* * * * *`) schedule. **(Fixed below.)**
- 🟡 **README is broadly stale** for CP War: still describes the deleted v1 hex grid, `COMING_SOON = true`, "troops 500 coins each," and "run migrations 001→016." Misleads onboarding (a contributor would miss the entire war backend + pg_cron/Realtime). Pre-dates even Phase 1.

---

## Recommended Improvements (Non-Blocking)

**Small (S)**
- 💡 Add a `"test"` script + a `node --test` step in `deploy.yml` **before** the deploy step — the suite already passes in ~85ms; this prevents shipping broken logic with green CI.
- 💡 Add a JS↔SQL **parity test**: golden input→output vectors for `neutralGarrison`/`war_neutral_soldiers`, unit strengths, and the loot/multiplier literals (parse the SQL text, assert against the JS exports). Converts the comment-enforced invariant into a CI-enforced one.
- 💡 Tighten the razor-thin survivor test from `>= 1` to `=== 1`; add `buildingCost` unknown-type + `lootFraction` over-destruction cases.
- 💡 Reuse `war_unit_strength()` in `war_tick`'s `def_raw` (remove the 4th strength-table copy); align JS `defenseMultiplier`/`antiAirFactor` to sum levels like the SQL.
- 💡 Show a **shield timer** + a **"forces in transit" ETA list** in the Sidebar (data already loaded; reuse `formatDuration`).

**Medium (M)**
- 💡 Extract a shared `<WarModal>` shell (+ `<UnitPicker>`, `<Spinner>`) for the 3 modals and add the missing `modal-in`/`backdrop-in` + `✕` close button in one place.
- 💡 Add a `refreshBalance` (balance-only) to `CasinoContext` and use it in the war income collector to decouple from the daily-bonus side effect.
- 💡 Capture+surface attack/arrival feedback via the existing `war_regions` realtime handler ("You captured Lyon!" / "You lost Cairo").
- 💡 Set up ESLint + `eslint-plugin-react-hooks` (the code already hand-writes an `eslint-disable` for a linter that isn't installed) to make the intentional hook-dependency omissions explicit.
- 💡 Refresh the README CP War section (real-map game, enabled, migrations 001→024 + pg_cron + Realtime), or defer it to DATABASE.md/CLAUDE.md so it can't drift.

**Large (L)**
- 💡 Add a repeatable way to exercise `war_tick()` (pgTAP, or a scripted `supabase db reset` + seed + `select war_tick()` + assertions) — the highest-risk, currently-untestable logic.
- 💡 Build the `send_units()` SECURITY DEFINER RPC to make combat *inputs* server-authoritative (validate source ownership + unit balance, debit atomically) — closes the documented client-trust gap.

---

## Consolidated Recommendations

### Immediate (this session)
- Fix the spawn false-success error handling, the `geo` target-centroid guard, and the CLAUDE.md "overnight" wording (applied below). Re-verify tests + build, push, redeploy.

### Short-term (1–2 months)
- Add the CI test gate + JS↔SQL parity test (cheap, high-value insurance for the duplicated constants).
- Polish the war modals (shared shell + `modal-in` + close button + small-phone grid) and decouple the income refresh from the daily bonus.
- Refresh the README; decide the owner-deletion neutral-units behavior.

### Long-term (roadmap)
- `send_units()` definer RPC for fully server-authoritative combat inputs; pgTAP for `war_tick()`; the income/alive-flag tick narrowing + composite indexes when the world grows; MapLibre v5 migration.
