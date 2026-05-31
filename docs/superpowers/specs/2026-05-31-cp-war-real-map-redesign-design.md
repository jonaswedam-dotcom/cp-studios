# CP War 2.0 — Real-World Map Strategy Game

**Date:** 2026-05-31
**Status:** Draft (design); pending user review → implementation plan
**Author:** Brainstormed with the maintainer (founder-requested)

## Summary

Rebuild **CP War** from the current abstract hex-grid frontwars.io clone
(`src/pages/WarPage.jsx`, behind `COMING_SOON`) into a **persistent, real-world-map strategy
game**. Players are dropped onto a **random starting city**, own only the **province** around
it, and grow an empire over **weeks and months** by buying varied units with coins, conquering
neighbouring provinces, and building & upgrading structures. Income and battles advance even
while everyone is offline, driven by a small scheduled server job.

This is a **large, multi-subsystem change** delivered in **three shippable phases** (a playable
conquest core first, then unit/building depth, then the persistent idle world). It reuses the
app's coin wallet, realtime patterns, and dark aesthetic, but replaces the canvas hex renderer
with a real map and — for the first time in this codebase — introduces **server-side game logic**
(see "Departures from current architecture").

## Goals

- A real-world map that "looks like a real map" (dark basemap, real geography) with territory
  you control, on top of the existing dark `cp` aesthetic.
- Start small (one random city/province) and climb slowly; becoming powerful should take
  **weeks/months**, not a session.
- Varied **purchasable units** (the founder's brief: soldiers, tanks, planes, + more) whose
  differences are mainly **cost and movement** — combat math stays simple.
- **Buildings** for defence and economy, upgradeable with coins (Lv 1–3).
- A persistent world that advances overnight, but that **rewards active play over pure AFK**.
- No total wipeouts — a beaten player keeps a remnant and can recover.

## Non-goals (YAGNI for now)

- **Phone push notifications on incoming attacks** — desired *eventually*; explicitly out of
  scope (see "Future ideas").
- **Seasons / world resets** — schema carries a season marker so they can be added later, but no
  reset logic is built now. The world is persistent.
- **Artillery & Missiles** — designed-for but deferred; the core roster ships first.
- **Pixel-perfect borders at max zoom** — shipped via "high-res data + zoom cap"; the
  recolour-the-basemap upgrade is noted as future.
- **Complex combat** (terrain, per-unit abilities beyond movement type) — combat is
  stack-vs-stack subtraction plus building modifiers.

## Core decisions (locked with the maintainer)

| Topic | Decision |
|-------|----------|
| Unit/combat depth | Simple stack-vs-stack subtraction; units differ by **cost + movement**; buildings apply ±% modifiers only. |
| Map rendering | **MapLibre GL JS** + dark real-world basemap (e.g. CARTO dark). Replaces the canvas hex renderer. |
| Territory unit | **Provinces / states** (Natural Earth admin-1), tinted by owner. Countries are macro context. |
| Starting position | Player is assigned a **random city**; owns just that city's province; the city is their **HQ**. |
| Border quality | High-res admin-1 borders + a **zoom cap** (country/region scale). Recolour-the-basemap = future upgrade. |
| Units | **Soldiers** (land), **Tanks** (land, strong, slower), **Fighter Jets** (fast, cross water), **Warships** (sea transport). Artillery/Missiles deferred. |
| Buildings (Lv 1–3) | Defence (local): **Bunker**, **Anti-Air**. Economy (global bonus, but vulnerable): **Factory** (cheaper troops), **Lab** (stronger troops), **Bank** (passive income). |
| Idle engine | A **Supabase scheduled job** (`pg_cron`) ticks every ~5 min: credits capped passive income + resolves due movements/combat. |
| Income pacing | Slow trickle with an **offline vault cap** (~8–12h). Active conquest is the bigger, uncapped income source. Anti-AFK. |
| Conquest spoils | No total wipeout. Capturing a province loots a **scaled share (up to ~80% on a crushing win)** and **downgrades** its buildings; the loser keeps a **~20% remnant**. |
| Offline safety | Slow movement (hours), tough HQ/capitals, and **shields** for new (~48h) and long-offline players (incoming-damage cap). |
| Lifespan | **Persistent**; `season_id` reserved in schema; no resets built. |
| Economy | Uses the **existing shared coin wallet** (casino + war = one currency). |
| Win condition | None hard — a live **leaderboard** by territory + total power. |
| Art style | **Flat vector inline-SVG** unit/building icons (matches the codebase's icon convention). May start as emoji and swap. |

## Player-facing behaviour

### First join
1. The player is **assigned a random unclaimed province** (one whose city makes a viable start).
2. That province becomes theirs; its **city is the HQ** (⭐ marker). They spawn with a **starting
   army** and a **new-player shield (~48h)**.

### Core loop
1. **Buy units** with coins (shared wallet). Each unit type has its own cost and movement rules.
2. **Move / attack** an adjacent province: select an owned province, choose a destination its
   units can reach, pick how many of which units to send. Movement takes **real time** (hours);
   jets are faster and cross water; warships ferry stacks coast-to-coast.
3. **Combat** resolves by stack-vs-stack subtraction (modified by buildings). Winner holds the
   province with the surviving troops.
4. **Conquest spoils:** taking an enemy province flips it, **loots a scaled share** of the value
   there (more for a decisive win, up to ~80%), and **knocks its buildings down a level or two**
   rather than destroying them. The loser always retains a ~20% remnant and is never eliminated.
5. **Build & upgrade** structures on owned provinces (a few slots each) to defend them or grow
   your economy.
6. **Passive income** trickles in (capped); **active play** earns more. Power compounds over
   weeks/months.

### Movement modes
- **Land** (soldiers, tanks): only to land-adjacent provinces.
- **Air** (jets): to provinces within an air range, **including across water** — the way to jump
  continents. Fast.
- **Sea** (warships): carry a large stack between any two **coastal** provinces.

## Game model & math

### Units (starting values — all tunable)
| Unit | Cost | Strength | Movement | Notes |
|------|------|----------|----------|-------|
| Soldier | ~100 | 1 | land, adjacent | Bulk workhorse. |
| Tank | ~500 | ~5 | land, adjacent, slower | Coin-efficient muscle. |
| Fighter Jet | ~800 | ~3 | air, crosses water, fast | Only cheap way overseas. |
| Warship | ~600 | ~2 (transport) | sea, coast-to-coast | Ferries big stacks. |

### Combat
- Effective attacker strength vs effective defender strength (sum of unit strengths × modifiers).
- **Bunker** raises defender strength (+50/100/150% by level). **Lab** raises *your* troop
  strength globally (+10/20/30%). **Anti-Air** removes a share of incoming **jet** (and later
  missile) strength before the clash.
- Subtraction decides the result; the winner keeps the difference.
- **Margin of victory → loot %**: `lootFraction = clamp(killedDefenders / defenderForce, 0..0.8)`
  applied to the province's lootable value; buildings downgrade by 1 level at low margin, 2 at
  high. Loser keeps ≥20%. (Exact curve tuned in the plan.)

### Economy & income pacing
- **Factory** lowers troop prices (−10/20/30%). **Bank** adds passive income per level. **Lab**
  strengthens troops. Economy buildings give a **global** benefit but sit on one province and are
  **lost/downgraded if it's captured** — so your economy is worth defending.
- **Passive income vault:** banks accrue coins into a vault that **caps at ~8–12h** of income,
  then stops until the player collects (on next login/tick). Daily check-ins capture a full
  night; multi-day AFK earns no more than one night.
- **Active income** (kills, conquest, expansion) is uncapped and is the larger source.

### Offline safety / shields
- **New-player shield** (~48h) blocks incoming attacks.
- **Offline-damage cap:** once a player has been offline beyond a threshold, incoming attacks can
  only remove a bounded fraction per real-time window, so an empire can't be wiped overnight.
- **Slow movement** (hours per leg) guarantees defenders time to react when they next log in.

## Departures from current architecture

The current app is client-only with no server logic, and the war is client-authoritative
(`CLAUDE.md` §4/§6). Two deliberate changes:

1. **Server-side tick.** A `SECURITY DEFINER` Postgres function (`war_tick()`) run by **`pg_cron`**
   every ~5 min credits income and resolves due movements/combat — so the world advances with
   nobody online. This is the first server-side game logic in the repo.
2. **Server-authoritative war.** Combat, income, and conquest resolution move into Postgres
   functions/RPCs, fixing today's "anyone can edit their own tiles/balance" gap for the war.
   (The casino remains client-side as before.)

These are scoped to the war; the rest of the app is unchanged.

## Data model (sketch — finalised in the plan)

Reshape the CP War tables (new migrations `019+`; `015` tables are replaced/extended):

- **`war_players`** — add `spawn_region`, `season_id`, `shield_until`, `last_income_at`,
  keep `display_name`, `color`, `is_alive` (now "has a remnant").
- **`war_regions`** (replaces `war_tiles`) — `region_id` (stable admin-1 key), `country_code`,
  `owner_id`, `owner_name`, `color`, per-unit-type troop counts (columns or jsonb),
  `is_hq` (the player's capital city province).
- **`war_buildings`** — `id`, `region_id`, `owner_id`, `type`
  (`bunker|antiair|factory|lab|bank`), `level` (1–3).
- **`war_movements`** — `from_region`, `to_region`, unit mix (jsonb), `mode`
  (`land|air|sea`), `arrives_at`, `status`.
- **Static client asset** — a precomputed **province adjacency graph + city anchors + centroids**
  (derived from Natural Earth admin-1), bundled with the app. This is the new "grid" that
  replaces hex math.
- RLS: reads open to authenticated; **writes that matter move server-side** (tick + RPCs) rather
  than broad client writes. Realtime on `war_regions` / `war_movements` / `war_players`.

## Code structure

- **`src/pages/WarPage.jsx`** — replace the canvas hex renderer with a **MapLibre** map; keep the
  `COMING_SOON` flag pattern, the sidebar (stats, buy, leaderboard, how-to), modals, and realtime
  subscriptions. Flip the flag on when Phase 1 is playable.
- **New dependency:** `maplibre-gl`. Basemap = a free dark style/tiles; admin-1 region source =
  high-res Natural Earth GeoJSON (hosted/bundled); `maxZoom` capped to region scale.
- **Units/buildings** drawn as **inline-SVG markers** at province centroids/HQ (art style #2),
  with troop-count badges; a shared `ICONS` map of SVG strings + a `chip(type,color,count)`
  factory (prototyped in the brainstorm demos).
- **New module(s)** for the adjacency/cities asset and the geo helpers (centroid, reachability by
  mode), isolated from the React component so they're testable.
- **Server:** migrations adding `war_tick()` + the `pg_cron` schedule + resolution RPCs.

## Phasing (each phase is shippable)

1. **Conquest core** — MapLibre real map, province ownership, **random-city start**,
   Soldiers/Tanks/Jets, movement + combat (subtraction), buy troops with coins, leaderboard.
   Resolution may stay client-polled with short timers for testing. *Playable end-to-end.*
2. **Depth** — Warships; all five buildings + Lv 1–3 upgrades; building modifiers; anti-air vs
   jets; conquest-spoils loot/downgrade rule.
3. **Persistent idle world** — `pg_cron` `war_tick()` (overnight income + combat), server-
   authoritative resolution, slow (hours) timers, capped income vault, shields/offline caps, and
   long-game balancing so power takes weeks/months.

## Visuals

- Dark real-world basemap; provinces tinted in the owner's colour (faint tint = neutral); thin
  light borders; ⭐ for the HQ city.
- Flat vector military icons (soldier/tank/jet/ship) and building glyphs (🏰/🛰️/🏭/🔬/🏦 as SVG)
  in coloured chips with count badges.
- Reuse the `cp` palette and existing sidebar/modal styling; keep the dark aesthetic from the
  current `WarPage.jsx`.

## Testing / verification

- `npm run build` passes (no test suite per `CLAUDE.md`; verify flows via `npm run dev`).
- Geo/adjacency/reachability helpers are pure modules with unit tests (mirrors the
  `aviamastersEngine.test.js` precedent).
- Manual walkthroughs per phase: random spawn; buy + move + combat; land/air/sea reachability;
  building placement/upgrade and their modifiers; conquest leaves a remnant; (Phase 3) the tick
  credits capped income and resolves movements with nobody online; shields hold.
- A balancing/simulation script to sanity-check income curves and "months to powerful" before
  shipping Phase 3 (mirrors the aviamasters sim approach).

## Future ideas (explicitly not now)

- **Push notifications** when an attack is inbound (pairs with slow timers → time to defend).
- **Artillery & Missiles** units (missiles interact with Anti-Air).
- **Seasons / resets** with a crowned champion.
- **Country-domination bonus** for holding every province in a country.
- **Pixel-perfect borders** via recolouring a vector basemap's own polygons.

## Open questions (non-blocking — settle in the plan)

- Exact admin-1 dataset + how the adjacency/cities asset is generated and bundled.
- Precise tuning: unit stats, costs, movement times, vault cap, shield windows, loot curve,
  income rates (the "months to powerful" math).
- Whether Phase 1 uses short client-polled timers before Phase 3's server tick, or goes
  server-authoritative immediately.
- Free dark basemap/tile source + attribution and any rate limits for a friends-and-family scale.
