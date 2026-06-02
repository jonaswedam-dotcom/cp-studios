# CP War — War-Game Audit & Suggested Improvements

**Date:** 2026-06-02
**Scope:** the CP War module — ships/ports, country invasion, troop visibility, naval mechanics, economy/balance, war UX.
**Method:** 4 parallel read-only investigation agents (naval, combat/visibility, economy/balance, UI/UX) + direct verification of the load-bearing code paths.
**Status:** findings + recommendations only. No source was modified.

---

## ⚠️ Critical context first: two migrations are NOT applied yet

Per the project memory, migrations **`034_war_neutral_loss_event.sql`** and **`035_war_map_reset.sql`**
are still **pending Jonas** in Supabase. This matters because some "bugs" are *already fixed in code
but not deployed*:

- **`034`** adds the "your attack was repelled by the garrison" event — the fix for the old
  "troops vanish, no conquest" silent-loss bug. Until it's applied, a lost attack on a neutral
  country is still **silent on the server**.
- **`035`** resets the board to the new ~1,000 country-quarter map. Until it's applied, old
  admin-1 region rows are inert and the map can look half-empty/confusing.

**Action:** these need to be run before judging live behavior. Several recommendations below assume
they are applied.

---

## Issue 1 — "Landlocked ships" (the headline bug) — ROOT CAUSE FOUND

This is reported three times (owner + user screenshot + the user note). It is **real**, and it has
**two compounding causes**, both verified in code:

### Cause A (the screenshot case): warships are deployed to your HQ tile, which may not be coastal
`WarPage.jsx:126` — every purchased unit, *including warships*, is dumped onto the HQ region:
```js
let target = myRegionRows.find((r) => r.is_hq) || myRegionRows[0]
```
Sea movement requires the **source** province to be coastal:
- `geo.js:35-37` — `seaReachable()` returns `[]` if the source isn't `coastal`.
- `targeting.js:40` & `targeting.js:78` — sea routes/badges require `graph.regions[sid]?.coastal`.

So if your HQ quarter is **inland** (and ~34% of the 1,027 quarters are — 346 inland / 681 coastal),
**every warship you ever buy is born on a tile it can never leave.** That is exactly the screenshot:
a "🚢 2" badge sitting on an interior quarter with no way to move it.

### Cause B (island case): the map never glows a sea target for your ship
`computeTargets()` (`targeting.js:58-91`) only adds sea/air targets for **already-claimed enemy**
provinces (line 80 loops `claimed` only), never for neutral/unclaimed ones — and own tiles are never
badged (line 66). The comment at lines 54-56 says distant neutrals are "reachable via `sourcesForDest`
when clicked directly." But the only clickable map features are **land provinces**; open ocean isn't
clickable, and the nearest other coastal landmass (e.g. Madagascar, ~900 km) is off-screen and
un-badged. So a player on a small island sees a ship badge, nothing glows, and has no discoverable
move → "land-locked."

### Why this is also the owner's port request (Issue 3)
The owner's "buy a **port** first, then warships arrive at that port" is the *correct fix for Cause A*:
a port is coastal by definition, so warships always spawn on a tile that can sail. The two should be
solved together.

**Recommended fix (combined with Issue 3):**
1. Add a **Port** building, buildable only on coastal quarters.
2. Warships can only be **bought if you own a port**, and they **deploy onto the port tile** (not HQ).
3. Make `computeTargets` also badge in-range **coastal neutral** quarters when the player has a
   coastal warship (bounded, to keep the map readable), so there's always a glowing sea target.
4. Add a guard/warning so a warship can never be deployed to a non-coastal tile.

---

## Issue 2 — Open countries hide their defenders ("invisible troops")

**Root cause (verified):** neutral/open quarters have a **deterministic hidden garrison of 50–300
soldiers**, computed from the region id — `neutral.js:5-9` (client mirror) and
`war_neutral_soldiers()` in `023_war_tick.sql:17-26` (server). The number is **not stored in a row**
(an unclaimed quarter has no `war_regions` row at all), so:

- The client *can* compute it locally (`neutralGarrison(id)`), but
- `MapView.jsx:140-141` (`syncMarkers`) does `if (!r.owner_id) return` — it only draws troop markers
  for **owned** regions. Neutral quarters get at most a bare `＋` hexagon glyph with **no count**
  (`MapView.jsx:36-48`).

So an open country looks empty, you attack it, and you lose to troops you were never shown. This is
**not** an RLS/permission problem — the data is fully derivable client-side; it's simply never rendered
on the map.

**What already exists:** the *attack modal* (`MoveUnitsModal.jsx:80-106`) does show
"🛡️ Defended by N soldiers (strength N)" and a "⚠️ too weak" warning — but only *after* you click
through. The map itself gives no warning.

**Recommended fix:**
1. Render the garrison count on the neutral expand badge (`MapView.jsx` `targetMarkerEl`, import
   `neutralGarrison`).
2. Optionally add a faint "🛡 N" marker on all in-view neutral quarters (the ~1,000-tile map makes
   this feasible; zoom-gate for readability).
3. Tighten the modal's "too weak" threshold — it currently warns only when
   `force ≤ defender` (`MoveUnitsModal.jsx:87`), but combat rolls ±15% luck and bunkers add up to
   +150% defense, so a force at ~1.05× still loses often. Warn below ~1.2×.
4. Apply migration `034` so a lost attack also produces a feed/toast event.

---

## Issue 3 — Owner request: Port → Warship pipeline, make warships OP & expensive

Currently there is **no port concept anywhere** (confirmed: no `port`/`naval` in code or SQL), and
warships are a weak "transport" unit (strength 2, cost 600 — the worst combat value in the game,
useful only for their 20-unit ferry capacity, `movement.js:4`).

**Proposed design (needs a couple of decisions — see questions):**
- **Port building** in `buildings.js`, coastal-only, gated in `BuildingsModal.jsx` by the tile's
  `coastal` flag (pass `graph.regions[id].coastal` into the modal; add a guard in `handleBuild`).
- **Warship purchase requires a port**; `handleBuy` redirects warship deploys from HQ → the port tile
  (`WarPage.jsx:126`). Disable the warship buy button when you own no port (`BuyUnitsModal.jsx`).
- **Make warships OP:** raise `strength` and `cost` in `units.js:12`. ⚠️ Warship strength is
  **duplicated in 3 places** — `units.js:12`, `war_stack_strength()` in `026_war_combat_v2.sql:24`,
  and the defender formula in `027`/`034`. All three must change together via a new migration that
  `create or replace`s those functions, or the client estimate and server combat will disagree.

**Caveat — server can't truly enforce "coastal."** The Postgres side has *no geography at all*; the
tick resolves combat purely by stack strength and never checks `mode`/coastal/distance. So a port's
coastal rule and warship-needs-port rule are **client-only** unless we also import the coastal flags
into a table and route purchases/builds through a `SECURITY DEFINER` RPC. For a private friends app
this matches the existing trust model (§4 of CLAUDE.md), but it's worth a conscious choice.

---

## Issue 4 — Other "features that aren't great" (prioritized)

### 🔴 Highest priority
1. **Parity test guards the wrong tick.** `parity.test.js:64-76` asserts `027` is the live
   `war_tick`, but `034` superseded it. They're identical today so the test passes — but any future
   edit to the *real* function won't be caught. Re-point the parity assertions at the highest-numbered
   tick migration. *(This is the safety net for JS↔SQL drift; right now it has a blind spot exactly
   where drift happens.)*
2. **Free/forged armies (known, accepted trust gap).** Unit purchases are direct client writes to
   `war_regions` (`WarPage.jsx:141`), and movements carry client-chosen `units`/`arrives_at`
   (`WarPage.jsx:187`). A member can set their own counts to anything or fabricate a winning stack.
   Documented as deferred in `024`/CLAUDE.md §4. Acceptable for a private app, but it makes the
   economy/army-cost balancing below *cosmetic* — flag before investing in balance tuning.

### 🟠 Balance & design
3. **Territory income is a rounding error vs. the casino faucet.** Tick income ≈ `banks×50 +
   provinces×10` coins/hr (`027`/`034`); a new player earns **10 coins/hr** against a 100-coin
   soldier. Meanwhile the casino injects ~600+ coins/day (daily bonus + 5 rewarded ads). So "holding
   territory pays for your army" is fiction, and casino wealth → army is unthrottled (the deferred
   "faucet throttle"). Either raise province income ~10× **and** tax/cap wallet→army conversion, or
   drop the pretense.
4. **Unit identities are thin.** Cost-per-strength: soldier 100, **tank 80**, jet 267, warship 300.
   Tank strictly out-values soldier and is only ~1 min slower, so soldiers are near-redundant; warship
   is pointless *as a combatant* (only the ferry matters). Re-cost, or give soldiers a real cheap/fast
   niche and make warship explicitly transport-only (then Issue 3 makes it "OP" via a big strength
   bump so it has a clear role).
5. **No win condition / season / catch-up → terminal snowball.** Conquest loot
   (`floor(0.8 × defenderStrength × 5)`, `034:129`) funds the leader's next attack while losers lose
   army *and* income, with no rubber-banding and no reset except a manual SQL truncate. A snowballed
   board becomes un-fun for everyone but the leader.
6. **Online defenders are near-invulnerable; offline ones are helpless.** In-territory reinforcement
   is **instant** (`WarPage.jsx:173-180`) while attack legs are now only ~3 min (`units.js`), so a
   watching defender can always perfectly stack a threatened tile. Consider a small reinforce delay or
   a "you're under attack, arrives in Xm" defender alert + grace window.
7. **Bunkers/anti-air are invisible traps.** A jet assault can lose up to 75% of its strength to
   hidden anti-air with zero pre-attack warning. Surface a defender estimate (incl. likely buildings)
   in the modal.

### 🟡 Cleanup / drift risks
8. **Four stacked `war_tick` definitions** (`023→026→027→034`); only the last applied is live, and
   `023` is materially different (no RNG, different income). Editing a stale copy silently does
   nothing. Mark superseded copies clearly or collapse to one.
9. **`incomePerHour` duplicates `buildings.js` constants** (`WarPage.jsx:80`) — reuse `incomePerTick`
   to avoid drift (CLAUDE.md explicitly warns about this).
10. **Economy buildings (Bank/Factory/Lab) lose to the casino** — max Bank ≈ 450/hr is less than a
    day of ads+bonus, so why build one? Re-tune or accept they're decorative.
11. **Dead/stale code:** `WarComingSoon.jsx` is orphaned (CLAUDE.md §6); `war_movements.unit_type`/
    `count` columns are dead (nulled by `026`); deterministic neutral garrisons remove all early-game
    variety (players can pre-compute the weakest neighbors).

### 🟡 / 🔵 UX gaps (support Issues 1 & 2)
12. **No "which color is me" legend** — 16 player colors assigned by join order; new players can't
    tell their own territory at a glance (only the sidebar dot + HQ ⭐ hint).
13. **Green is overloaded** — neutral "expand" tiles tint green *and* a green-colored player fills
    green; they look alike.
14. **Building effects show no numbers** ("Defenders fight harder" vs "+50%/level").
15. **Silent failure states** — data-load errors are swallowed to console (`useWarData.js:41-45`); a
    Supabase hiccup shows an empty map with no message. Mixed-stack arrives at slowest unit's speed
    with no hint. Move deducts from a stale render snapshot (last-write-wins race).
16. **Touch/accessibility** — 26px badges (<44px touch target), color-only action coding, pulsing
    with no `prefers-reduced-motion`, no ARIA on the map.

---

## Suggested priority order

1. **Fix the landlocked ship + ship the port pipeline together** (Issues 1 + 3) — this is the most
   reported and the owner's explicit ask. One coherent change.
2. **Show open-country garrisons on the map + tighten the too-weak warning** (Issue 2) — small,
   high-value, directly answers the owner's #1 complaint.
3. **Get migrations 034 & 035 applied** (combat-loss feedback + board reset).
4. **Re-point the parity test** (#4.1) — cheap insurance before any further combat tuning.
5. **Economy/balance pass** (#4.3–4.7) — bigger design conversation; decide casino↔war coupling,
   unit re-costing, and whether to add a win condition/season.

> Note: the "free army" trust gap (#4.2) means balance tuning is cosmetic until purchases/movements
> move into RPCs. Decide whether that hardening is in scope (it's currently an accepted trade-off for
> this private app) before investing heavily in balance numbers.
