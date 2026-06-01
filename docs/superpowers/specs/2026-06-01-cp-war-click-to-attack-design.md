# CP War — Click-to-Attack UX Redesign (design)

**Date:** 2026-06-01
**Status:** Self-authored & self-accepted (autonomous task; no user checkpoints requested)
**Scope:** Client-only. **No DB migrations, no server-tick changes** — the move contract
(`war_movements`: `{from_region, to_region, units(jsonb), mode, arrives_at, status}`) is unchanged.

## Problem

Attacking is confusing. Today the flow is:

1. Click one of *your own* provinces to **select** it (step nobody discovers).
2. Reachable provinces get a thin 2px outline.
3. Click a reachable province → a modal opens with a **redundant destination dropdown**
   (you already clicked the destination), a mode toggle, and four number inputs.

Two complaints, verbatim:
- *"instead of … a drop down menu … I need … highlighted hexagons where you can just click and send your troops."*
- *"you don't have to click on your country … then click on the different country … It should automatically highlight the places where you can send them."*

## Design principles

- **No source pre-selection.** Targets are highlighted *automatically*, computed across **all**
  of the player's provinces. The player never clicks their own territory first to "arm" an attack.
- **The destination is the click.** Click a glowing target → send panel opens already pointed at it.
  No destination dropdown — ever.
- **One obvious affordance.** Each actionable target gets a glowing, color-coded **hexagon badge**
  at its centroid (the literal "hexagon you click") *plus* a brightened province fill (large hit area).
- **Sensible defaults.** The send panel pre-fills the largest valid force and the right travel mode,
  so the common path is: click hexagon → "Attack". Power controls (amount, source, mode) stay,
  but collapse out of the way when there's only one choice.

## "Hexagons" — interpretation (verified decision)

The map is a real-world admin-1 province map (MapLibre, 4,596 polygons), rebuilt only days ago
(Phase 1–3). A literal hex *grid* would discard that and is high-risk. So "hexagons" =
**hexagon-shaped click-target badges** rendered on reachable provinces — the affordance the user
described ("highlighted hexagons you click"), not a grid rewrite. This keeps the real-world map
identity intact while delivering the exact interaction asked for.

## Target classification & colors

A *badged* target is enemy/neutral territory you can act on. Each is one of:

| kind | when | hexagon | fill/line |
|------|------|---------|-----------|
| `attack` | owned by another (live) player, in reach, **not shielded** | red ⚔ | red |
| `expand` | unclaimed (neutral garrison), land-adjacent | emerald ＋ | emerald |

Shielded enemies are **not** badged (and clicking them flashes the shield message).

**Reinforce is deliberately *not* a map badge.** If `computeTargets` emitted "reinforce" for
every owned province reachable from another, a player's whole territory would glow blue — noise,
not signal. Reinforcement (province→province) is instead reached by **clicking your own province**
(opens the Buildings panel → "Reinforce here"). The always-on highlight shows only the things you
do to *other* territory: red = fight a player, green = grab free land.

## Highlight set vs. click reachability (the two functions)

To keep the map readable, the *badged* set is bounded; clicking is permissive:

- **`computeTargets` (what glows):**
  - **Land adjacency** for every owned province with land units → all neighbor kinds
    (attack/expand/reinforce). This is the bread-and-butter "send troops to the next province".
  - **Air/Sea** reach is added **only for already-claimed provinces** (enemy or your own).
    Long-range air/sea onto the *hundreds* of distant neutral provinces within a 4,500 km jet
    radius is deliberately **not** badged — that would bury the map in hexagons and defeat the
    "simpler" goal. (Logged, not silent.)
- **`sourcesForDest` (what a click can do):** full land/air/sea reachability for *any* clicked
  province. So a power user can still air-drop on a distant neutral by clicking it directly —
  it just isn't pre-badged. Nothing reachable is ever a dead click.

This split is the key simplification: casual players see a clean, finite frontier; the full
ruleset stays reachable.

## Auto source + mode selection

When a target is clicked, `sourcesForDest(dest)` returns every valid `{from, mode}` pair the
player can launch (only sources that actually hold the needed unit type). Ordering:

1. mode preference **land → sea → air** (land = cheapest, most intuitive),
2. then by largest relevant army at the source.

The send panel defaults to `sources[0]`. A compact source selector appears **only when >1** pair
exists; otherwise it's hidden entirely.

## Send panel (replaces the dropdown modal)

- Header: `⚔️ Attack {City}` / `🚩 Take {City}` / `🏃 Reinforce {City}`.
- Source: hidden if 1 option; segmented selector if several (`{City} · land · 1.2k`).
- Mode: derived from the chosen source/mode pair; toggle only if the same source reaches via >1 mode.
- Units: per applicable type for the mode (land: soldier+tank; air: jet; sea: warship + cargo
  soldier/tank). **Default = max available**, with `All` / `Half` quick buttons + editable number.
- Live arrival time + sea cargo capacity readout.
- One primary button (red for attack, emerald for expand, sky for reinforce).

## Owned-province click

Clicking your own province opens the existing **Buildings** panel (build/upgrade) — unchanged —
now with a **"Reinforce here"** action when the province is reachable from another of yours
(opens the send panel pointed at it). This preserves province-to-province reinforcement without
cluttering the default attack flow.

## Files

- **new** `src/war/targeting.js` (+ `targeting.test.js`) — `sourcesForDest`, `computeTargets`. Pure, TDD'd.
- `src/war/MapView.jsx` — render hexagon target markers; brighten fills; drive from `targets`.
- `src/war/MoveUnitsModal.jsx` — rewrite to the streamlined send panel (no dropdown, auto source/mode, max defaults).
- `src/war/BuildingsModal.jsx` — optional "Reinforce here" button.
- `src/war/Sidebar.jsx` — rewrite "How to Play" for the new flow.
- `src/pages/WarPage.jsx` — drop the `selected`/`moveFrom` two-step; wire `targets`, click routing, `handleMove({from,...})`.

## Out of scope / non-goals

- No combat/economy/balance changes. No migrations. No hex *grid*. No new dependencies.
- Server remains authoritative for resolution; client still validates geometry + deducts source units (unchanged trust model).

## Verification

- TDD unit tests for `targeting.js` (`node --test src/war/*.test.js`) — all green, incl. existing 58.
- `npm run build` clean.
- Self-review pass (independent reviewer subagent) against the move contract and dead-click/edge cases.
