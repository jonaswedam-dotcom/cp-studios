# CP War Phase 1 — Conquest Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hex-grid CP War with a playable real-world-map game where you spawn on a random province, buy soldiers/tanks/jets with coins, and move/attack adjacent provinces with timed, client-resolved combat.

**Architecture:** A MapLibre map renders Natural Earth admin-1 province polygons, tinted per owner via feature-state. Game state lives in three Supabase tables (`war_regions`, `war_players`, `war_movements`). All game *logic* (adjacency/air-range, combat, costs, spawn) lives in small **pure JS modules** under `src/war/` that are unit-tested with Node's built-in test runner; the React/MapLibre layer is thin and verified by `npm run build` + a manual dev walkthrough. Combat resolution is client-polled in Phase 1 (server tick comes in Phase 3).

**Tech Stack:** React 18 + Vite, Supabase (Postgres + RLS + Realtime), **maplibre-gl** (new dep), **topojson-server/-client** (new dev deps, build-time only), Tailwind (`cp` palette), Node `node:test`.

---

## Context the engineer needs

- This repo is a **client-only React SPA + Supabase**. Read `CLAUDE.md` and `docs/DATABASE.md` first. Key rules: components call `supabase.from(...)` directly; RLS uses the **`auth.role() = 'authenticated'`** expression form (the `TO authenticated USING (true)` form is broken here — see `CLAUDE.md` §2); migrations are **manual, numbered, idempotent**, run by hand in the Supabase SQL editor.
- There is **no test framework**. Tests are plain files using `node:test` + `node:assert/strict` (see `src/pages/casino/aviamastersEngine.test.js`). Run with `node --test <path>`.
- The wallet/coin economy lives in `src/context/CasinoContext.jsx` (`useCasino()` → `balance`, `placeBet`). We add a small `adjustBalance` helper there.
- The `/war` route already exists in `src/App.jsx:145-149` and renders `src/pages/WarPage.jsx`. `WarPage.jsx` currently short-circuits to a "coming soon" screen via `const COMING_SOON = true`. The whole hex `WarGame` below it will be **replaced**.
- Branching: the repo works on `main` with PRs. **Create a feature branch before the first commit** (e.g. `git checkout -b feature/war-phase1`). The execution sub-skill / worktree handles this; if executing inline, do it now.

## Phase 1 simplifications (deliberate — later phases add these)

- **Unclaimed provinces are free to occupy** (no neutral garrison yet) — garrisons + balancing are Phase 2/3.
- **No conquest spoils / shields** — Phase 1 combat is plain subtraction; the loser of a region simply loses that region (they keep their other regions; full elimination is still possible if you lose everything, exactly like the old game). Spoils/remnant/shields are Phase 2/3.
- **One unit type per movement** (you send N soldiers *or* N tanks *or* N jets per move). Mixed-stack transit is later.
- **Buildings, warships, factory/lab/bank, server tick, offline income** are all out of scope for Phase 1.

## File structure (created/modified in this plan)

**Created — pure logic + assets (testable, no React):**
- `src/war/units.js` — single source of truth for unit stats/costs/movement.
- `src/war/economy.js` (+ `economy.test.js`) — troop cost math.
- `src/war/combat.js` (+ `combat.test.js`) — stack strength + combat resolution.
- `src/war/geo.js` (+ `geo.test.js`) — province graph queries (land neighbors, air range, distance, centroid).
- `src/war/spawn.js` (+ `spawn.test.js`) — random spawn province picker.
- `scripts/build-war-geo.mjs` — build-time script that generates the province graph + polygon GeoJSON.
- `public/war/provinces.json` — generated province graph (committed).
- `public/war/provinces.topojson` — generated polygon source (compact TopoJSON; the client converts it to GeoJSON via `topojson-client` `feature()`) (committed).

**Created — React/MapLibre layer (thin):**
- `src/war/icons.jsx` — inline-SVG unit/HQ icon set + marker-element builders.
- `src/war/useWarData.js` — data hook: load + realtime-subscribe regions/players/movements.
- `src/war/MapView.jsx` — MapLibre map: basemap, province fills, owned-region/HQ/movement markers, click events.
- `src/war/BuyUnitsModal.jsx` — buy soldiers/tanks/jets with coins.
- `src/war/MoveUnitsModal.jsx` — send a chosen unit type to a chosen destination.
- `src/war/Sidebar.jsx` — player stats, buy button, leaderboard, how-to.

**Modified:**
- `package.json` — add `maplibre-gl` dep, `topojson-server`/`topojson-client` dev deps, `build:war-geo` script.
- `src/context/CasinoContext.jsx` — add + expose `adjustBalance(delta)`.
- `src/pages/WarPage.jsx` — flip `COMING_SOON`; replace `WarGame` with the MapLibre orchestrator.
- `src/components/Navbar.jsx:329-333` — make the "War" entry a real link.
- `supabase/migrations/019_cp_war_v2.sql` — new schema (created).
- `docs/DATABASE.md` — document the v2 war tables.

---

## Task 1: Add dependencies and the geo-build script entry

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add deps and a build script to `package.json`**

Replace the `scripts`, `dependencies`, and `devDependencies` blocks with:

```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "build:war-geo": "node scripts/build-war-geo.mjs"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.106.1",
    "maplibre-gl": "^4.7.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.23.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.4",
    "topojson-client": "^3.1.0",
    "topojson-server": "^3.0.1",
    "vite": "^5.3.1"
  }
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: completes; `node_modules/maplibre-gl` and `node_modules/topojson-server` exist.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(war): add maplibre-gl + topojson build deps"
```

---

## Task 2: Generate the province graph + polygon asset

> **IMPLEMENTED DIFFERENTLY (and committed) — this section is superseded; see `scripts/build-war-geo.mjs` for the source of truth.** The 50m dataset turned out to be too coarse (294 regions), so the build now uses Natural Earth **10m** admin-1 (~4,596 provinces), runs `topojson-server` → `topojson-simplify` (presimplify + simplify) → `topojson-client` `quantize`, and ships a compact **`public/war/provinces.topojson`** (~4.2MB raw / ~0.7MB gzipped) that the client converts to GeoJSON with `topojson-client`'s `feature()`. It still writes `public/war/provinces.json` (the `{name, city, country, centroid, neighbors}` graph). Requires the extra dev dep `topojson-simplify`, and `topojson-client` is a **runtime** dependency (used in the browser by Task 12). The `provinces.geojson` file is NOT produced. The original 50m GeoJSON approach below is retained only for historical context.

This script downloads Natural Earth admin-1 provinces (50m) + populated places, computes land adjacency (via TopoJSON shared arcs), a centroid per province, and a representative city per province, then writes two files into `public/war/`.

**Files:**
- Create: `scripts/build-war-geo.mjs`
- Create (generated): `public/war/provinces.json`, `public/war/provinces.geojson`

- [ ] **Step 1: Write `scripts/build-war-geo.mjs`**

```js
// Build-time only. Requires Node 18+ (global fetch) and dev deps topojson-server/-client.
// Generates:
//   public/war/provinces.geojson  – admin-1 polygons, each feature id = adm1_code
//   public/war/provinces.json     – { regions: { [adm1_code]: {name, city, country, centroid:[lng,lat], neighbors:[adm1_code,...]} } }
import { writeFileSync, mkdirSync } from 'node:fs'
import { topology } from 'topojson-server'
import { neighbors } from 'topojson-client'

const ADMIN1 = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson'
const PLACES = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_populated_places.geojson'

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`)
  return res.json()
}

// Average of the largest ring's vertices — good enough for marker placement.
function centroid(geometry) {
  let rings = []
  if (geometry.type === 'Polygon') rings = [geometry.coordinates[0]]
  else if (geometry.type === 'MultiPolygon') rings = geometry.coordinates.map(p => p[0])
  let best = null, bestLen = -1
  for (const r of rings) if (r.length > bestLen) { bestLen = r.length; best = r }
  if (!best) return [0, 0]
  let x = 0, y = 0
  for (const [lng, lat] of best) { x += lng; y += lat }
  return [ +(x / best.length).toFixed(4), +(y / best.length).toFixed(4) ]
}

const admin1 = await getJson(ADMIN1)
const places = await getJson(PLACES)

// Pick the most populous city per (country, province) name pair.
const cityByKey = new Map()
for (const f of places.features) {
  const p = f.properties
  const key = `${p.adm0name}|${p.adm1name}`
  const pop = p.pop_max || 0
  const prev = cityByKey.get(key)
  if (!prev || pop > prev.pop) cityByKey.set(key, { name: p.name, pop })
}

// Stable order; assign adm1_code as feature id.
const feats = admin1.features.filter(f => f.properties.adm1_code)
const codes = feats.map(f => f.properties.adm1_code)
const geoms = feats.map(f => f.geometry)

// TopoJSON neighbors() gives adjacency from shared arcs (true land borders).
const topo = topology({ p: { type: 'GeometryCollection', geometries: geoms.map((g, i) => ({ ...g, id: i })) } })
const nbrs = neighbors(topo.objects.p.geometries) // array of arrays of indices

const regions = {}
feats.forEach((f, i) => {
  const p = f.properties
  const code = p.adm1_code
  const country = p.admin || p.adm0name || ''
  const cityHit = cityByKey.get(`${country}|${p.name}`)
  regions[code] = {
    name: p.name || code,
    city: cityHit ? cityHit.name : (p.name || code),
    country,
    centroid: centroid(f.geometry),
    neighbors: nbrs[i].map(j => codes[j]),
  }
})

// GeoJSON for MapLibre: keep only what we need, ensure adm1_code on each feature.
const outGeo = {
  type: 'FeatureCollection',
  features: feats.map(f => ({
    type: 'Feature',
    properties: { adm1_code: f.properties.adm1_code, name: f.properties.name, admin: f.properties.admin },
    geometry: f.geometry,
  })),
}

mkdirSync('public/war', { recursive: true })
writeFileSync('public/war/provinces.json', JSON.stringify({ regions }))
writeFileSync('public/war/provinces.geojson', JSON.stringify(outGeo))
console.log(`Wrote ${Object.keys(regions).length} provinces.`)
```

- [ ] **Step 2: Run the generator**

Run: `npm run build:war-geo`
Expected: prints `Wrote NNNN provinces.` (a few thousand), and both files exist under `public/war/`.

- [ ] **Step 3: Sanity-check the output**

Run: `node -e "const g=require('./public/war/provinces.json');const k=Object.keys(g.regions);console.log(k.length, g.regions[k[0]])"`
Expected: a count in the thousands and a sample region object with `name`, `city`, `country`, `centroid` (`[lng,lat]`), and a non-empty `neighbors` array for a mainland province.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-war-geo.mjs public/war/provinces.json public/war/provinces.geojson
git commit -m "feat(war): generate province graph + polygon asset from Natural Earth"
```

---

## Task 3: Unit config module

**Files:**
- Create: `src/war/units.js`

- [ ] **Step 1: Write `src/war/units.js`**

```js
// Single source of truth for Phase 1 unit stats. All values are tunable.
export const UNITS = {
  soldier: { label: 'Soldier', strength: 1, cost: 100, mode: 'land', travelSeconds: 30 },
  tank:    { label: 'Tank',    strength: 5, cost: 500, mode: 'land', travelSeconds: 45 },
  jet:     { label: 'Jet',     strength: 3, cost: 800, mode: 'air',  travelSeconds: 20, airRangeKm: 4500 },
}

export const UNIT_TYPES = ['soldier', 'tank', 'jet']

// What a freshly-spawned player gets on their starting province.
export const START_ARMY = { soldier: 500, tank: 0, jet: 0 }
```

- [ ] **Step 2: Commit**

```bash
git add src/war/units.js
git commit -m "feat(war): unit config (soldier/tank/jet)"
```

---

## Task 4: Economy module (TDD)

**Files:**
- Create: `src/war/economy.js`
- Test: `src/war/economy.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/war/economy.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { troopCost, maxAffordable } from './economy.js'

test('troopCost multiplies unit cost by count', () => {
  assert.equal(troopCost('soldier', 3), 300)
  assert.equal(troopCost('tank', 2), 1000)
  assert.equal(troopCost('jet', 1), 800)
})

test('troopCost of 0 or unknown type is 0', () => {
  assert.equal(troopCost('soldier', 0), 0)
  assert.equal(troopCost('zzz', 5), 0)
})

test('maxAffordable returns how many you can buy with a balance', () => {
  assert.equal(maxAffordable('soldier', 950), 9)
  assert.equal(maxAffordable('tank', 1000), 2)
  assert.equal(maxAffordable('jet', 100), 0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/war/economy.test.js`
Expected: FAIL — cannot find module `./economy.js`.

- [ ] **Step 3: Write `src/war/economy.js`**

```js
import { UNITS } from './units.js'

export function troopCost(type, count) {
  const u = UNITS[type]
  if (!u || count <= 0) return 0
  return u.cost * count
}

export function maxAffordable(type, balance) {
  const u = UNITS[type]
  if (!u) return 0
  return Math.max(0, Math.floor((balance ?? 0) / u.cost))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/war/economy.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/war/economy.js src/war/economy.test.js
git commit -m "feat(war): troop cost economy module"
```

---

## Task 5: Combat module (TDD)

Stack strength = Σ(count × unit strength). Combat compares total strength; the winner keeps survivors scaled to the strength they had left, reconstructed in the same unit proportions.

**Files:**
- Create: `src/war/combat.js`
- Test: `src/war/combat.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/war/combat.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stackStrength, stackTotal, resolveCombat, emptyStack } from './combat.js'

test('stackStrength weights tanks and jets', () => {
  assert.equal(stackStrength({ soldier: 10, tank: 0, jet: 0 }), 10)
  assert.equal(stackStrength({ soldier: 0, tank: 2, jet: 0 }), 10)
  assert.equal(stackStrength({ soldier: 1, tank: 1, jet: 1 }), 9)
})

test('attacker win leaves survivors proportional to remaining strength', () => {
  const r = resolveCombat({ soldier: 100 }, { soldier: 40 })
  assert.equal(r.winner, 'attacker')
  // 100 str vs 40 str -> 60 str left -> 60 soldiers
  assert.equal(r.survivors.soldier, 60)
})

test('defender win keeps proportional survivors', () => {
  const r = resolveCombat({ soldier: 30 }, { soldier: 80 })
  assert.equal(r.winner, 'defender')
  assert.equal(r.survivors.soldier, 50)
})

test('exact tie -> defender holds with a token survivor', () => {
  const r = resolveCombat({ soldier: 50 }, { soldier: 50 })
  assert.equal(r.winner, 'defender')
  assert.equal(stackTotal(r.survivors), 1)
})

test('emptyStack has all unit types at 0', () => {
  assert.deepEqual(emptyStack(), { soldier: 0, tank: 0, jet: 0 })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/war/combat.test.js`
Expected: FAIL — cannot find module `./combat.js`.

- [ ] **Step 3: Write `src/war/combat.js`**

```js
import { UNITS, UNIT_TYPES } from './units.js'

export function emptyStack() {
  return { soldier: 0, tank: 0, jet: 0 }
}

export function stackTotal(stack) {
  return UNIT_TYPES.reduce((s, t) => s + (stack[t] || 0), 0)
}

export function stackStrength(stack) {
  return UNIT_TYPES.reduce((s, t) => s + (stack[t] || 0) * UNITS[t].strength, 0)
}

// Scale a stack down to a target strength, keeping unit proportions, floored.
function scaleToStrength(stack, fromStrength, targetStrength) {
  const out = emptyStack()
  if (fromStrength <= 0 || targetStrength <= 0) return out
  const ratio = targetStrength / fromStrength
  for (const t of UNIT_TYPES) out[t] = Math.floor((stack[t] || 0) * ratio)
  return out
}

// attackStack invades a region held by defenseStack.
// Returns { winner: 'attacker'|'defender', survivors: stack-of-winner }.
export function resolveCombat(attackStack, defenseStack) {
  const atk = { ...emptyStack(), ...attackStack }
  const def = { ...emptyStack(), ...defenseStack }
  const aStr = stackStrength(atk)
  const dStr = stackStrength(def)

  if (aStr > dStr) {
    return { winner: 'attacker', survivors: scaleToStrength(atk, aStr, aStr - dStr) }
  }
  if (dStr > aStr) {
    return { winner: 'defender', survivors: scaleToStrength(def, dStr, dStr - aStr) }
  }
  // tie: defender holds with a single token soldier
  return { winner: 'defender', survivors: { ...emptyStack(), soldier: 1 } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/war/combat.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/war/combat.js src/war/combat.test.js
git commit -m "feat(war): combat resolution module"
```

---

## Task 6: Geo query module (TDD)

**Files:**
- Create: `src/war/geo.js`
- Test: `src/war/geo.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/war/geo.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { landNeighbors, distanceKm, airReachable, centroidOf } from './geo.js'

// Tiny fixture graph: A-B land-adjacent; C is far (other side of an ocean).
const G = {
  regions: {
    A: { name: 'A', centroid: [0, 0],   neighbors: ['B'] },
    B: { name: 'B', centroid: [1, 0],   neighbors: ['A'] },
    C: { name: 'C', centroid: [100, 0], neighbors: [] },
  },
}

test('landNeighbors returns the adjacency list', () => {
  assert.deepEqual(landNeighbors('A', G), ['B'])
  assert.deepEqual(landNeighbors('C', G), [])
})

test('centroidOf returns the stored centroid', () => {
  assert.deepEqual(centroidOf('B', G), [1, 0])
})

test('distanceKm is ~0 for same point and large across the ocean', () => {
  assert.ok(distanceKm([0, 0], [0, 0]) < 1)
  assert.ok(distanceKm([0, 0], [100, 0]) > 5000)
})

test('airReachable finds nearby provinces within range, excluding self', () => {
  const reach = airReachable('A', G, 1000) // ~111km to B, far to C
  assert.deepEqual(reach, ['B'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/war/geo.test.js`
Expected: FAIL — cannot find module `./geo.js`.

- [ ] **Step 3: Write `src/war/geo.js`**

```js
export function landNeighbors(id, graph) {
  return graph.regions[id]?.neighbors ?? []
}

export function centroidOf(id, graph) {
  return graph.regions[id]?.centroid ?? null
}

// Haversine great-circle distance in km. Points are [lng, lat].
export function distanceKm([lng1, lat1], [lng2, lat2]) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

// All region ids whose centroid is within rangeKm of `id` (excluding `id`).
export function airReachable(id, graph, rangeKm) {
  const from = centroidOf(id, graph)
  if (!from) return []
  const out = []
  for (const [rid, r] of Object.entries(graph.regions)) {
    if (rid === id) continue
    if (distanceKm(from, r.centroid) <= rangeKm) out.push(rid)
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/war/geo.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/war/geo.js src/war/geo.test.js
git commit -m "feat(war): province graph query module (neighbors, air range)"
```

---

## Task 7: Spawn picker (TDD)

**Files:**
- Create: `src/war/spawn.js`
- Test: `src/war/spawn.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/war/spawn.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickRandomSpawn } from './spawn.js'

const G = { regions: { A: {}, B: {}, C: {} } }

test('returns an unclaimed region', () => {
  const claimed = new Set(['A', 'B'])
  assert.equal(pickRandomSpawn(G, claimed, () => 0), 'C')
})

test('rng selects across the unclaimed list', () => {
  const claimed = new Set()
  // 3 unclaimed; rng 0 -> first, ~0.99 -> last (order = Object.keys order)
  assert.equal(pickRandomSpawn(G, claimed, () => 0), 'A')
  assert.equal(pickRandomSpawn(G, claimed, () => 0.99), 'C')
})

test('returns null when everything is claimed', () => {
  assert.equal(pickRandomSpawn(G, new Set(['A', 'B', 'C']), () => 0), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/war/spawn.test.js`
Expected: FAIL — cannot find module `./spawn.js`.

- [ ] **Step 3: Write `src/war/spawn.js`**

```js
// Pick a random unclaimed region id. rng() returns [0,1). Returns null if none free.
export function pickRandomSpawn(graph, claimedSet, rng = Math.random) {
  const free = Object.keys(graph.regions).filter((id) => !claimedSet.has(id))
  if (free.length === 0) return null
  const idx = Math.min(free.length - 1, Math.floor(rng() * free.length))
  return free[idx]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/war/spawn.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the whole war test suite once**

Run: `node --test src/war/`
Expected: all tests across economy/combat/geo/spawn PASS.

- [ ] **Step 6: Commit**

```bash
git add src/war/spawn.js src/war/spawn.test.js
git commit -m "feat(war): random spawn province picker"
```

---

## Task 8: Database migration 019 (v2 war schema)

**Files:**
- Create: `supabase/migrations/019_cp_war_v2.sql`

> The old hex tables (`war_tiles`, `war_movements`, `war_players` from `015`) are incompatible and the game was disabled (`COMING_SOON`), so they hold no real data. This migration drops and recreates them. Confirm there's no live data before running in production.

- [ ] **Step 1: Write `supabase/migrations/019_cp_war_v2.sql`**

```sql
-- Migration 019: CP War v2 – real-world province conquest
-- Replaces the hex schema from 015. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

drop table if exists public.war_movements cascade;
drop table if exists public.war_tiles     cascade;
drop table if exists public.war_players    cascade;

create table public.war_players (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  display_name   text not null,
  color          text not null,
  spawn_region   text,
  season_id      integer not null default 1,
  is_alive       boolean not null default true,
  shield_until   timestamptz,
  last_income_at timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create table public.war_regions (
  region_id    text primary key,           -- adm1_code from public/war/provinces.json
  country_code text,
  owner_id     uuid references auth.users(id) on delete set null,
  owner_name   text,
  color        text,
  is_hq        boolean not null default false,
  soldier      integer not null default 0,
  tank         integer not null default 0,
  jet          integer not null default 0,
  updated_at   timestamptz not null default now()
);

create table public.war_movements (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references auth.users(id) on delete cascade,
  from_region text not null,
  to_region   text not null,
  unit_type   text not null check (unit_type in ('soldier','tank','jet')),
  count       integer not null,
  mode        text not null check (mode in ('land','air')),
  status      text not null default 'moving' check (status in ('moving','arrived','cancelled')),
  arrives_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists war_regions_owner_idx      on public.war_regions(owner_id);
create index if not exists war_movements_status_idx    on public.war_movements(status, arrives_at);
create index if not exists war_movements_player_idx     on public.war_movements(player_id);

alter table public.war_players   enable row level security;
alter table public.war_regions   enable row level security;
alter table public.war_movements enable row level security;

-- Reads: any signed-in user. NOTE the auth.role() expression form (CLAUDE.md §2).
create policy "war_players_select"   on public.war_players   for select using (auth.role() = 'authenticated');
create policy "war_players_insert"   on public.war_players   for insert with check (auth.uid() = user_id);
create policy "war_players_update"   on public.war_players   for update using (auth.uid() = user_id);

create policy "war_regions_select"   on public.war_regions   for select using (auth.role() = 'authenticated');
-- Broad write: client resolves combat in Phase 1 and must modify enemy regions.
-- Phase 3 replaces this with server-authoritative writes.
create policy "war_regions_insert"   on public.war_regions   for insert with check (auth.role() = 'authenticated');
create policy "war_regions_update"   on public.war_regions   for update using (auth.role() = 'authenticated');

create policy "war_movements_select" on public.war_movements for select using (auth.role() = 'authenticated');
create policy "war_movements_insert" on public.war_movements for insert with check (auth.uid() = player_id);
create policy "war_movements_update" on public.war_movements for update using (auth.uid() = player_id);

-- ── Realtime ──────────────────────────────────────────────────────────────────
-- Run in Supabase dashboard (Database → Replication) or via SQL:
-- alter publication supabase_realtime add table public.war_regions;
-- alter publication supabase_realtime add table public.war_movements;
-- alter publication supabase_realtime add table public.war_players;
```

- [ ] **Step 2: Apply the migration**

Run it by hand in the Supabase SQL editor (project per `MEMORY.md` / `.env.local`), then enable Realtime for the three tables (Database → Replication, or the `alter publication` lines).
Verify: `select * from public.war_regions limit 1;` returns no error (empty result is fine).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/019_cp_war_v2.sql
git commit -m "feat(db): CP War v2 schema (regions/players/movements)"
```

---

## Task 9: Add `adjustBalance` to CasinoContext

The war spends/earns coins on the shared wallet without writing casino `game_history` rows.

**Files:**
- Modify: `src/context/CasinoContext.jsx`

- [ ] **Step 1: Add the `adjustBalance` callback** (place it right after `placeBet`, before the daily-refill section ~line 167)

```jsx
  // ── Adjust balance directly (used by CP War; no game_history row) ──────────
  const adjustBalance = useCallback(async (delta) => {
    if (!userId) throw new Error('Not authenticated')
    const newBalance = Math.max(0, (balance ?? 0) + delta)
    const { error } = await supabase
      .from('wallets')
      .update({ balance: newBalance })
      .eq('user_id', userId)
    if (error) { console.error('[CasinoContext] adjustBalance error:', error); return balance }
    setBalance(newBalance)
    return newBalance
  }, [userId, balance])
```

- [ ] **Step 2: Expose it in the context value** (add to the `value={{ ... }}` object)

```jsx
        balance,
        loading,
        loadBalance,
        placeBet,
        adjustBalance,
        claimRefill,
        canClaimRefill,
        dailyBonusAmount,
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/context/CasinoContext.jsx
git commit -m "feat(war): adjustBalance helper on CasinoContext"
```

---

## Task 10: Unit/HQ icon module

**Files:**
- Create: `src/war/icons.jsx`

- [ ] **Step 1: Write `src/war/icons.jsx`**

```jsx
// Inline-SVG unit glyphs (art style #2). Two consumers:
//  - UNIT_SVG: raw SVG strings for MapLibre HTML markers (no React).
//  - <UnitIcon/>: React component for the sidebar/modals.

export const UNIT_SVG = {
  soldier: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2" fill="currentColor"/><path d="M5 19 C5 12.5,19 12.5,19 19 Z" fill="currentColor"/></svg>',
  tank:    '<svg viewBox="0 0 24 24"><rect x="3" y="13" width="17" height="6" rx="2" fill="currentColor"/><rect x="7" y="8" width="9" height="5" rx="1.5" fill="currentColor"/><rect x="15" y="9.5" width="7" height="2" fill="currentColor"/></svg>',
  jet:     '<svg viewBox="0 0 24 24"><path d="M12 2 l1.7 9 7 3.4 -7 -.7 -.9 6.3 -1.6 0 -.9 -6.3 -7 .7 7 -3.4 Z" fill="currentColor"/></svg>',
}

export function UnitIcon({ type, className = 'w-4 h-4' }) {
  return <span className={className} style={{ display: 'inline-block' }}
    dangerouslySetInnerHTML={{ __html: UNIT_SVG[type] || '' }} />
}

// Build a DOM element for a MapLibre marker: a colored chip with an optional count badge.
export function markerEl({ type, color, count, hq = false }) {
  const el = document.createElement('div')
  el.style.cssText = `width:30px;height:30px;border-radius:8px;background:#0b0b0bdd;border:2px solid ${color};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.6);color:#fff;position:relative`
  el.innerHTML = `<span style="width:20px;height:20px;display:block">${UNIT_SVG[type] || ''}</span>`
  if (hq) {
    const s = document.createElement('div')
    s.textContent = '⭐'
    s.style.cssText = 'position:absolute;top:-9px;left:-7px;font-size:12px'
    el.appendChild(s)
  }
  if (count) {
    const b = document.createElement('span')
    b.textContent = count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count)
    b.style.cssText = 'position:absolute;bottom:-7px;right:-7px;background:#0b0b0b;border:1px solid #555;border-radius:999px;font-size:9px;font-weight:700;padding:0 4px;line-height:14px'
    el.appendChild(b)
  }
  return el
}
```

- [ ] **Step 2: Commit**

```bash
git add src/war/icons.jsx
git commit -m "feat(war): inline-SVG unit icons + marker builder"
```

---

## Task 11: War data hook (load + realtime)

Mirrors the old `WarGame`'s `loadAll` + realtime subscriptions, but for the v2 tables and as a reusable hook.

**Files:**
- Create: `src/war/useWarData.js`

- [ ] **Step 1: Write `src/war/useWarData.js`**

```js
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../supabase'

// Loads the province graph (once) + live game state (regions/players/movements).
export function useWarData(userId) {
  const [graph, setGraph]         = useState(null)              // provinces.json
  const [regions, setRegions]     = useState({})               // region_id -> row
  const [players, setPlayers]     = useState([])
  const [movements, setMovements] = useState([])
  const [loading, setLoading]     = useState(true)
  const graphLoaded = useRef(false)

  // Province graph (static asset)
  useEffect(() => {
    if (graphLoaded.current) return
    graphLoaded.current = true
    fetch('/war/provinces.json').then(r => r.json()).then(setGraph).catch(e => console.error('graph load', e))
  }, [])

  const loadAll = useCallback(async () => {
    const [rRes, pRes, mRes] = await Promise.all([
      supabase.from('war_regions').select('*'),
      supabase.from('war_players').select('*'),
      supabase.from('war_movements').select('*').eq('status', 'moving'),
    ])
    if (rRes.data) {
      const m = {}
      rRes.data.forEach(row => { m[row.region_id] = row })
      setRegions(m)
    }
    if (pRes.data) setPlayers(pRes.data)
    if (mRes.data) setMovements(mRes.data)
    setLoading(false)
  }, [])

  useEffect(() => { if (userId) loadAll() }, [userId, loadAll])

  // Realtime
  useEffect(() => {
    if (!userId) return
    const ch = supabase.channel('war-rt-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'war_regions' }, payload => {
        const row = payload.new || payload.old
        if (!row) return
        setRegions(prev => {
          const next = { ...prev }
          if (payload.eventType === 'DELETE') delete next[row.region_id]
          else next[payload.new.region_id] = payload.new
          return next
        })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'war_players' }, payload => {
        setPlayers(prev => {
          const id = (payload.new || payload.old)?.user_id
          const filtered = prev.filter(p => p.user_id !== id)
          return payload.eventType === 'DELETE' ? filtered : [...filtered, payload.new]
        })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'war_movements' }, payload => {
        const m = payload.new || payload.old
        setMovements(prev => {
          const filtered = prev.filter(x => x.id !== m?.id)
          return payload.new?.status === 'moving' ? [...filtered, payload.new] : filtered
        })
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [userId])

  return { graph, regions, players, movements, loading, setRegions, loadAll }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds (the hook isn't imported yet; this just type-checks the syntax).

- [ ] **Step 3: Commit**

```bash
git add src/war/useWarData.js
git commit -m "feat(war): useWarData hook (load + realtime)"
```

---

## Task 12: MapView (MapLibre rendering)

Renders the basemap + province fills (tinted by feature-state for owned regions) + markers for owned regions, the HQ, and in-transit movements. Emits `onRegionClick(region_id)`.

**Files:**
- Create: `src/war/MapView.jsx`

- [ ] **Step 1: Write `src/war/MapView.jsx`**

```jsx
import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { feature } from 'topojson-client'
import { markerEl } from './icons.jsx'
import { UNIT_TYPES } from './units.js'

const BASE_STYLE = {
  version: 8,
  sources: {
    carto: {
      type: 'raster', tileSize: 256,
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      attribution: '© OpenStreetMap, © CARTO',
    },
  },
  layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
}

// Dominant unit in a region (for the single marker we show per owned region).
function topUnit(region) {
  let best = 'soldier', n = -1
  for (const t of UNIT_TYPES) if ((region[t] || 0) > n) { n = region[t] || 0; best = t }
  return best
}
function regionTotal(region) {
  return UNIT_TYPES.reduce((s, t) => s + (region[t] || 0), 0)
}

export default function MapView({ graph, regions, movements, onRegionClick }) {
  const mapRef     = useRef(null)
  const containerRef = useRef(null)
  const markersRef = useRef([])     // unit/HQ markers
  const moveMarkersRef = useRef({}) // movement id -> marker
  const readyRef   = useRef(false)

  // Init map once
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: [0, 25], zoom: 1.6, maxZoom: 5.5, minZoom: 1,
      attributionControl: true,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    mapRef.current = map

    map.on('load', async () => {
      const res = await fetch('/war/provinces.topojson')
      const topo = await res.json()
      const gj = feature(topo, topo.objects.p) // TopoJSON -> GeoJSON FeatureCollection
      map.addSource('provinces', { type: 'geojson', data: gj, promoteId: 'adm1_code' })
      map.addLayer({
        id: 'province-fills', type: 'fill', source: 'provinces',
        paint: {
          'fill-color': ['case', ['boolean', ['feature-state', 'owned'], false],
            ['feature-state', 'color'], 'rgba(255,255,255,0.02)'],
          'fill-opacity': ['case', ['boolean', ['feature-state', 'owned'], false], 0.55, 0.5],
        },
      })
      map.addLayer({
        id: 'province-lines', type: 'line', source: 'provinces',
        paint: { 'line-color': 'rgba(255,255,255,0.15)', 'line-width': 0.5 },
      })
      map.on('click', 'province-fills', (e) => {
        const f = e.features?.[0]
        if (f) onRegionClick(f.properties.adm1_code)
      })
      map.getCanvas().style.cursor = 'pointer'
      readyRef.current = true
      syncOwnership()
      syncMarkers()
    })

    return () => map.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tint owned provinces via feature-state
  const syncOwnership = () => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    // Clear then set (cheap at our scale: only owned regions are tracked)
    Object.values(regions).forEach((r) => {
      map.setFeatureState({ source: 'provinces', id: r.region_id },
        r.owner_id ? { owned: true, color: r.color || '#888' } : { owned: false, color: '' })
    })
  }

  // One marker per owned region (dominant unit + count), HQ gets a star.
  const syncMarkers = () => {
    const map = mapRef.current
    if (!map || !readyRef.current || !graph) return
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []
    Object.values(regions).forEach((r) => {
      if (!r.owner_id) return
      const c = graph.regions[r.region_id]?.centroid
      if (!c) return
      const total = regionTotal(r)
      const el = markerEl({ type: topUnit(r), color: r.color || '#888', count: total, hq: r.is_hq })
      const mk = new maplibregl.Marker({ element: el }).setLngLat(c).addTo(map)
      markersRef.current.push(mk)
    })
  }

  useEffect(syncOwnership, [regions])
  useEffect(syncMarkers, [regions, graph])

  // In-transit movement dots (interpolated each animation frame)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !graph) return
    let raf
    const tick = () => {
      const now = Date.now()
      const live = new Set()
      movements.forEach((mv) => {
        if (mv.status !== 'moving') return
        const from = graph.regions[mv.from_region]?.centroid
        const to   = graph.regions[mv.to_region]?.centroid
        if (!from || !to) return
        const total = new Date(mv.arrives_at) - new Date(mv.created_at)
        const t = Math.min(1, Math.max(0, (now - new Date(mv.created_at).getTime()) / total))
        const lng = from[0] + (to[0] - from[0]) * t
        const lat = from[1] + (to[1] - from[1]) * t
        live.add(mv.id)
        let mk = moveMarkersRef.current[mv.id]
        if (!mk) {
          const el = markerEl({ type: mv.unit_type, color: '#fff', count: mv.count })
          el.style.opacity = '0.85'
          mk = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)
          moveMarkersRef.current[mv.id] = mk
        } else {
          mk.setLngLat([lng, lat])
        }
      })
      // remove arrived/gone movement markers
      Object.keys(moveMarkersRef.current).forEach((id) => {
        if (!live.has(id)) { moveMarkersRef.current[id].remove(); delete moveMarkersRef.current[id] }
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [movements, graph])

  return <div ref={containerRef} className="absolute inset-0" />
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/war/MapView.jsx
git commit -m "feat(war): MapLibre MapView with owned-region tinting + markers"
```

---

## Task 13: Buy units modal

**Files:**
- Create: `src/war/BuyUnitsModal.jsx`

- [ ] **Step 1: Write `src/war/BuyUnitsModal.jsx`**

```jsx
import { useState } from 'react'
import { UNITS, UNIT_TYPES } from './units.js'
import { troopCost, maxAffordable } from './economy.js'
import { UnitIcon } from './icons.jsx'

export default function BuyUnitsModal({ balance, onConfirm, onClose, loading }) {
  const [type, setType]   = useState('soldier')
  const [count, setCount] = useState('')
  const max   = maxAffordable(type, balance)
  const n     = parseInt(count) || 0
  const cost  = troopCost(type, n)
  const valid = n >= 1 && n <= max

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-cp-card border border-cp-border rounded-3xl p-6 space-y-5 shadow-2xl">
        <h3 className="font-display text-lg text-cp-text">Buy Units</h3>

        <div className="grid grid-cols-3 gap-2">
          {UNIT_TYPES.map((t) => (
            <button key={t} onClick={() => { setType(t); setCount('') }}
              className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs transition-colors ${
                type === t ? 'border-red-500/60 bg-red-500/10 text-cp-text' : 'border-cp-border text-cp-muted hover:text-cp-text'
              }`}>
              <UnitIcon type={t} className="w-5 h-5" />
              <span>{UNITS[t].label}</span>
              <span className="text-amber-400/80">{UNITS[t].cost}</span>
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs text-cp-muted uppercase tracking-wider mb-1.5">
            How many (max {max.toLocaleString()})
          </label>
          <input autoFocus type="number" min={1} max={max} value={count}
            onChange={(e) => setCount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && valid && onConfirm(type, n)}
            className="w-full bg-cp-elevated border border-cp-border rounded-xl px-4 py-3 text-cp-text text-sm focus:border-red-500/50 focus:outline-none"
            placeholder={`1 – ${max}`} />
          {valid && <p className="text-xs text-amber-400/80 mt-1.5">Cost: {cost.toLocaleString()} coins</p>}
          {count && !valid && n > 0 && <p className="text-xs text-red-400 mt-1.5">Not enough coins.</p>}
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-cp-border text-cp-muted text-sm hover:text-cp-text transition-colors">Cancel</button>
          <button onClick={() => valid && onConfirm(type, n)} disabled={!valid || loading}
            className="flex-1 py-2.5 rounded-xl bg-red-500/80 hover:bg-red-500 text-white text-sm font-semibold transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
            {loading && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            Buy
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/war/BuyUnitsModal.jsx
git commit -m "feat(war): buy units modal"
```

---

## Task 14: Move units modal

Shows the chosen source region's available units, lets the player pick a unit type, a destination, and a count. Destination options come from the pure geo module (land neighbors for land units; air-reachable for jets).

**Files:**
- Create: `src/war/MoveUnitsModal.jsx`

- [ ] **Step 1: Write `src/war/MoveUnitsModal.jsx`**

```jsx
import { useState, useMemo } from 'react'
import { UNITS, UNIT_TYPES } from './units.js'
import { landNeighbors, airReachable } from './geo.js'
import { UnitIcon } from './icons.jsx'

export default function MoveUnitsModal({ graph, regions, fromRegion, onConfirm, onClose, loading }) {
  const fromRow = regions[fromRegion]
  const available = (t) => fromRow?.[t] || 0
  const firstWithUnits = UNIT_TYPES.find((t) => available(t) > 0) || 'soldier'
  const [type, setType]   = useState(firstWithUnits)
  const [dest, setDest]   = useState('')
  const [count, setCount] = useState('')

  // Destinations the chosen unit type can reach.
  const destinations = useMemo(() => {
    if (!graph) return []
    const ids = UNITS[type].mode === 'air'
      ? airReachable(fromRegion, graph, UNITS[type].airRangeKm)
      : landNeighbors(fromRegion, graph)
    return ids.map((id) => ({
      id,
      label: graph.regions[id]?.city || graph.regions[id]?.name || id,
      owner: regions[id]?.owner_name,
      enemy: regions[id]?.owner_id && regions[id].owner_id !== fromRow?.owner_id,
    }))
  }, [graph, type, fromRegion, regions, fromRow])

  const max   = available(type)
  const n     = parseInt(count) || 0
  const valid = dest && n >= 1 && n <= max
  const destRow = regions[dest]
  const isAttack = destRow?.owner_id && destRow.owner_id !== fromRow?.owner_id

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-cp-card border border-cp-border rounded-3xl p-6 space-y-4 shadow-2xl">
        <h3 className="font-display text-lg text-cp-text">{isAttack ? '⚔️ Attack' : '🏃 Move Units'}</h3>

        <div className="grid grid-cols-3 gap-2">
          {UNIT_TYPES.map((t) => (
            <button key={t} disabled={available(t) === 0}
              onClick={() => { setType(t); setDest(''); setCount('') }}
              className={`flex flex-col items-center gap-1 py-2 rounded-xl border text-xs transition-colors disabled:opacity-30 ${
                type === t ? 'border-blue-500/60 bg-blue-500/10 text-cp-text' : 'border-cp-border text-cp-muted hover:text-cp-text'
              }`}>
              <UnitIcon type={t} className="w-5 h-5" />
              <span>{available(t).toLocaleString()}</span>
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs text-cp-muted uppercase tracking-wider mb-1.5">Destination</label>
          <select value={dest} onChange={(e) => setDest(e.target.value)}
            className="w-full bg-cp-elevated border border-cp-border rounded-xl px-4 py-3 text-cp-text text-sm focus:border-blue-500/50 focus:outline-none">
            <option value="">{destinations.length ? 'Choose…' : 'No reachable provinces'}</option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>{d.label}{d.enemy ? ` — ⚔ ${d.owner}` : d.owner ? ` — ${d.owner}` : ' — neutral'}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-cp-muted uppercase tracking-wider mb-1.5">
            {UNITS[type].label}s to send (max {max.toLocaleString()})
          </label>
          <input type="number" min={1} max={max} value={count}
            onChange={(e) => setCount(e.target.value)}
            className="w-full bg-cp-elevated border border-cp-border rounded-xl px-4 py-3 text-cp-text text-sm focus:border-blue-500/50 focus:outline-none"
            placeholder={`1 – ${max}`} />
          <p className="text-xs text-cp-muted mt-1.5">Arrives in {UNITS[type].travelSeconds}s.</p>
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-cp-border text-cp-muted text-sm hover:text-cp-text transition-colors">Cancel</button>
          <button onClick={() => valid && onConfirm({ type, dest, count: n })} disabled={!valid || loading}
            className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors disabled:opacity-40 flex items-center justify-center gap-2 ${isAttack ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'}`}>
            {loading && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {isAttack ? 'Launch Attack' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/war/MoveUnitsModal.jsx
git commit -m "feat(war): move/attack units modal"
```

---

## Task 15: Sidebar

**Files:**
- Create: `src/war/Sidebar.jsx`

- [ ] **Step 1: Write `src/war/Sidebar.jsx`**

```jsx
import { UNIT_TYPES } from './units.js'

export default function Sidebar({ me, myRegions, myUnits, balance, leaderboard, onBuy, eliminated }) {
  return (
    <aside className="w-full lg:w-72 flex-shrink-0 bg-cp-card border-t lg:border-t-0 lg:border-l border-cp-border overflow-y-auto">
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 pt-1">
          <h1 className="font-display text-lg text-cp-text">CP War</h1>
        </div>

        {me && (
          <div className="bg-cp-elevated border border-cp-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: me.color }} />
              <span className="text-cp-text text-sm font-semibold truncate">{me.display_name}</span>
              {eliminated && <span className="text-[10px] text-red-400 bg-red-500/15 border border-red-500/25 px-1.5 py-0.5 rounded-full">Eliminated</span>}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-cp-card rounded-xl p-2.5"><p className="text-cp-muted mb-0.5">Provinces</p><p className="text-cp-text font-bold text-base">{myRegions}</p></div>
              <div className="bg-cp-card rounded-xl p-2.5"><p className="text-cp-muted mb-0.5">Units</p><p className="text-cp-text font-bold text-base">{myUnits.toLocaleString()}</p></div>
              <div className="bg-cp-card rounded-xl p-2.5 col-span-2"><p className="text-cp-muted mb-0.5">Coins</p><p className="text-amber-400 font-bold">{(balance ?? 0).toLocaleString()}</p></div>
            </div>
            <button onClick={onBuy} className="w-full py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 hover:border-red-500/50 text-sm font-semibold transition-all">
              Buy Units
            </button>
          </div>
        )}

        <div>
          <p className="text-xs text-cp-muted uppercase tracking-wider mb-2">Leaderboard</p>
          <div className="space-y-1.5">
            {leaderboard.map((p, i) => (
              <div key={p.user_id} className="flex items-center gap-2 px-3 py-2 bg-cp-elevated rounded-xl">
                <span className="text-xs text-cp-muted/60 w-4 text-right">{i + 1}</span>
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
                <span className="flex-1 text-xs text-cp-text truncate">{p.display_name}</span>
                <span className="text-xs text-cp-muted">{p.regionCount} prov.</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-cp-elevated border border-cp-border rounded-2xl p-4 space-y-2">
          <p className="text-xs font-semibold text-cp-muted uppercase tracking-wider">How to Play</p>
          <div className="space-y-1.5 text-xs text-cp-muted leading-relaxed">
            <p>🖱 Click one of your provinces to select it</p>
            <p>🎯 Click again to choose units + a destination</p>
            <p>🪖 Soldiers/tanks move to bordering provinces</p>
            <p>✈️ Jets fly across water to nearby provinces</p>
            <p>⚔️ Combat resolves when units arrive</p>
            <p>💰 Buy units with coins; expand to win</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/war/Sidebar.jsx
git commit -m "feat(war): sidebar (stats, buy, leaderboard, how-to)"
```

---

## Task 16: WarPage orchestrator (spawn, buy, move, resolve)

Replaces the hex `WarGame`. Owns top-level state and the action handlers, wiring the hook + MapView + modals + sidebar together. Keeps the `COMING_SOON` flag pattern.

**Files:**
- Modify: `src/pages/WarPage.jsx` (replace entire file)

- [ ] **Step 1: Replace `src/pages/WarPage.jsx` with:**

```jsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { useApp } from '../context/AppContext'
import { useCasino } from '../context/CasinoContext'
import { useWarData } from '../war/useWarData.js'
import MapView from '../war/MapView.jsx'
import Sidebar from '../war/Sidebar.jsx'
import BuyUnitsModal from '../war/BuyUnitsModal.jsx'
import MoveUnitsModal from '../war/MoveUnitsModal.jsx'
import { UNITS, UNIT_TYPES, START_ARMY } from '../war/units.js'
import { troopCost } from '../war/economy.js'
import { stackStrength, resolveCombat, emptyStack } from '../war/combat.js'
import { landNeighbors, airReachable } from '../war/geo.js'
import { pickRandomSpawn } from '../war/spawn.js'

// Flip to false to enable the live game.
const COMING_SOON = false

const PLAYER_COLORS = [
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899',
  '#06b6d4','#84cc16','#f43f5e','#fb923c','#a3e635','#2dd4bf','#60a5fa','#c084fc',
]

export default function WarPage() {
  if (COMING_SOON) return <WarComingSoon />
  return <WarGame />
}

function WarComingSoon() {
  const navigate = useNavigate()
  return (
    <div className="min-h-[calc(100vh-64px)] bg-cp-bg flex items-center justify-center p-6">
      <div className="flex flex-col items-center text-center max-w-sm gap-6">
        <h1 className="font-display text-2xl text-cp-text font-normal">CP War — Coming Soon</h1>
        <button onClick={() => navigate('/')} className="px-6 py-2.5 rounded-xl border border-cp-border text-cp-muted text-sm font-medium hover:text-cp-text transition-all">Back to Home</button>
      </div>
    </div>
  )
}

function WarGame() {
  const { session } = useApp()
  const { balance, adjustBalance } = useCasino()
  const userId   = session?.user?.id
  const userName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || 'Player'

  const { graph, regions, players, movements, loading } = useWarData(userId)

  const [selected, setSelected]   = useState(null)   // region_id (one of mine)
  const [showBuy, setShowBuy]     = useState(false)
  const [moveFrom, setMoveFrom]   = useState(null)    // region_id for the move modal
  const [busy, setBusy]           = useState(false)
  const [flash, setFlash]         = useState('')
  const initRef = useRef(false)

  const me = players.find((p) => p.user_id === userId) || null
  const myRegionRows = Object.values(regions).filter((r) => r.owner_id === userId)
  const myUnits = myRegionRows.reduce((s, r) => s + UNIT_TYPES.reduce((a, t) => a + (r[t] || 0), 0), 0)
  const eliminated = me && myRegionRows.length === 0

  const showFlash = (m) => { setFlash(m); setTimeout(() => setFlash(''), 4000) }

  // ── First join: assign a random spawn province ──────────────────────────────
  useEffect(() => {
    if (loading || !graph || !userId || initRef.current) return
    if (me) { initRef.current = true; return }
    initRef.current = true
    ;(async () => {
      const claimed = new Set(Object.keys(regions))
      const used = new Set(players.map((p) => p.color))
      const color = PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[players.length % PLAYER_COLORS.length]
      const spawn = pickRandomSpawn(graph, claimed, Math.random)
      if (!spawn) { showFlash('The world is full!'); return }

      await supabase.from('war_players').insert({ user_id: userId, display_name: userName, color, spawn_region: spawn })
      await supabase.from('war_regions').upsert({
        region_id: spawn, country_code: graph.regions[spawn]?.country || null,
        owner_id: userId, owner_name: userName, color, is_hq: true, ...START_ARMY,
      }, { onConflict: 'region_id' })
      showFlash(`You start in ${graph.regions[spawn]?.city || spawn}!`)
    })()
  }, [loading, graph, userId, me, regions, players, userName])

  // ── Buy units (deploy onto HQ region) ───────────────────────────────────────
  const handleBuy = useCallback(async (type, count) => {
    if (busy || !me) return
    setBusy(true)
    try {
      const cost = troopCost(type, count)
      if ((balance ?? 0) < cost) { showFlash('Not enough coins.'); return }
      // Target = HQ region, or any owned region if HQ lost, or respawn.
      let target = myRegionRows.find((r) => r.is_hq) || myRegionRows[0]
      if (!target) {
        const claimed = new Set(Object.keys(regions))
        const spawn = pickRandomSpawn(graph, claimed, Math.random)
        if (!spawn) { showFlash('No room to respawn.'); return }
        await adjustBalance(-cost)
        await supabase.from('war_regions').upsert({
          region_id: spawn, owner_id: userId, owner_name: me.display_name, color: me.color,
          is_hq: true, ...emptyStack(), [type]: count,
        }, { onConflict: 'region_id' })
        await supabase.from('war_players').update({ spawn_region: spawn }).eq('user_id', userId)
        showFlash(`Respawned in ${graph.regions[spawn]?.city || spawn}!`)
        return
      }
      await adjustBalance(-cost)
      await supabase.from('war_regions')
        .update({ [type]: (target[type] || 0) + count, updated_at: new Date().toISOString() })
        .eq('region_id', target.region_id)
      showFlash(`+${count} ${UNITS[type].label}${count > 1 ? 's' : ''}`)
    } finally { setShowBuy(false); setBusy(false) }
  }, [busy, me, balance, myRegionRows, regions, graph, userId, adjustBalance])

  // ── Send a movement ─────────────────────────────────────────────────────────
  const handleMove = useCallback(async ({ type, dest, count }) => {
    if (busy || !moveFrom) return
    setBusy(true)
    try {
      const src = regions[moveFrom]
      if (!src || (src[type] || 0) < count) { showFlash('Not enough units.'); return }
      const mode = UNITS[type].mode
      const arrivesAt = new Date(Date.now() + UNITS[type].travelSeconds * 1000).toISOString()
      await supabase.from('war_regions')
        .update({ [type]: (src[type] || 0) - count, updated_at: new Date().toISOString() })
        .eq('region_id', moveFrom)
      await supabase.from('war_movements').insert({
        player_id: userId, from_region: moveFrom, to_region: dest, unit_type: type, count, mode, arrives_at: arrivesAt,
      })
      showFlash(`${count} ${UNITS[type].label}s en route — arrives in ${UNITS[type].travelSeconds}s`)
    } finally { setMoveFrom(null); setSelected(null); setBusy(false) }
  }, [busy, moveFrom, regions, userId])

  // ── Resolve arrived movements (client poll; Phase 3 moves this server-side) ──
  const resolveMovements = useCallback(async () => {
    const now = Date.now()
    const due = movements.filter((m) => m.status === 'moving' && new Date(m.arrives_at).getTime() <= now)
    for (const mv of due) {
      // Claim the movement so only one client resolves it.
      const { error } = await supabase.from('war_movements').update({ status: 'arrived' }).eq('id', mv.id).eq('status', 'moving')
      if (error) continue
      const dest = regions[mv.to_region]
      const player = players.find((p) => p.user_id === mv.player_id)
      const incoming = { ...emptyStack(), [mv.unit_type]: mv.count }

      if (!dest || !dest.owner_id) {
        // Move into unclaimed/empty province.
        await supabase.from('war_regions').upsert({
          region_id: mv.to_region, country_code: graph?.regions[mv.to_region]?.country || null,
          owner_id: mv.player_id, owner_name: player?.display_name || 'Player', color: player?.color || '#888',
          is_hq: false, ...emptyStack(), [mv.unit_type]: mv.count, updated_at: new Date().toISOString(),
        }, { onConflict: 'region_id' })
      } else if (dest.owner_id === mv.player_id) {
        // Reinforce own province.
        await supabase.from('war_regions')
          .update({ [mv.unit_type]: (dest[mv.unit_type] || 0) + mv.count, updated_at: new Date().toISOString() })
          .eq('region_id', mv.to_region)
      } else {
        // Combat.
        const defense = { soldier: dest.soldier, tank: dest.tank, jet: dest.jet }
        const r = resolveCombat(incoming, defense)
        if (r.winner === 'attacker') {
          await supabase.from('war_regions').update({
            owner_id: mv.player_id, owner_name: player?.display_name || 'Player', color: player?.color || '#888',
            is_hq: false, ...r.survivors, updated_at: new Date().toISOString(),
          }).eq('region_id', mv.to_region)
        } else {
          await supabase.from('war_regions')
            .update({ ...r.survivors, updated_at: new Date().toISOString() })
            .eq('region_id', mv.to_region)
        }
      }
    }
  }, [movements, regions, players, graph])

  useEffect(() => {
    const id = setInterval(resolveMovements, 4000)
    return () => clearInterval(id)
  }, [resolveMovements])

  // ── Province click: select own → open move modal on second click ────────────
  const onRegionClick = useCallback((regionId) => {
    const row = regions[regionId]
    if (!selected) {
      if (row?.owner_id === userId) setSelected(regionId)
      return
    }
    if (regionId === selected) { setSelected(null); return }
    // Reachable from the selected region by any owned unit type?
    const src = regions[selected]
    const reachableLand = landNeighbors(selected, graph)
    const reachableAir  = graph ? airReachable(selected, graph, UNITS.jet.airRangeKm) : []
    const canReach = reachableLand.includes(regionId) || reachableAir.includes(regionId)
    const hasUnits = src && UNIT_TYPES.some((t) => (src[t] || 0) > 0)
    if (canReach && hasUnits) { setMoveFrom(selected); return }
    // Otherwise: reselect if it's mine, else clear.
    if (row?.owner_id === userId) setSelected(regionId)
    else setSelected(null)
  }, [selected, regions, userId, graph])

  const leaderboard = players
    .map((p) => ({ ...p, regionCount: Object.values(regions).filter((r) => r.owner_id === p.user_id).length }))
    .sort((a, b) => b.regionCount - a.regionCount)
    .slice(0, 8)

  if (loading || !graph) return (
    <div className="min-h-screen bg-cp-bg flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-2 border-red-400 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-cp-muted text-sm">Loading war map…</p>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-64px)] overflow-hidden bg-[#0a0a0a]">
      {showBuy && <BuyUnitsModal balance={balance} loading={busy} onConfirm={handleBuy} onClose={() => setShowBuy(false)} />}
      {moveFrom && <MoveUnitsModal graph={graph} regions={regions} fromRegion={moveFrom} loading={busy} onConfirm={handleMove} onClose={() => { setMoveFrom(null); setSelected(null) }} />}

      {flash && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-cp-card border border-cp-border rounded-2xl text-sm font-medium text-cp-text shadow-xl pointer-events-none">
          {flash}
        </div>
      )}
      {eliminated && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 max-w-sm w-full mx-4 px-5 py-4 bg-red-900/80 border border-red-500/40 rounded-2xl text-center shadow-2xl backdrop-blur-sm">
          <p className="text-white font-semibold text-sm mb-1">💀 You have no provinces left!</p>
          <button onClick={() => setShowBuy(true)} className="mt-2 px-4 py-2 bg-red-500 hover:bg-red-400 text-white text-xs font-semibold rounded-xl transition-colors">Buy units to respawn</button>
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        <MapView graph={graph} regions={regions} movements={movements} onRegionClick={onRegionClick} />
        {selected && (
          <div className="absolute top-3 left-3 z-10 bg-cp-card border border-cp-border rounded-xl px-3 py-2 text-xs text-cp-text shadow-xl">
            Selected: <b>{graph.regions[selected]?.city || selected}</b> — click a reachable province to move/attack, or click it again to deselect.
          </div>
        )}
      </div>

      <Sidebar me={me} myRegions={myRegionRows.length} myUnits={myUnits} balance={balance}
        leaderboard={leaderboard} onBuy={() => setShowBuy(true)} eliminated={eliminated} />
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/WarPage.jsx
git commit -m "feat(war): MapLibre WarPage orchestrator (spawn/buy/move/resolve)"
```

---

## Task 17: Make the navbar "War" link active

**Files:**
- Modify: `src/components/Navbar.jsx:329-333`

- [ ] **Step 1: Replace the unclickable War span**

Find (around line 329):

```jsx
            {/* War — visible but unclickable (coming soon) */}
            <span className="text-sm font-medium flex items-center gap-1.5 text-red-400/30 cursor-not-allowed select-none" title="Coming soon">
              <SwordIcon />
              War
            </span>
```

Replace with:

```jsx
            {/* War */}
            <NavLink
              to="/war"
              className={({ isActive }) =>
                `text-sm font-medium transition-colors duration-150 flex items-center gap-1.5 ${
                  isActive ? 'text-red-400' : 'text-red-400/60 hover:text-red-400'
                }`
              }
            >
              <SwordIcon />
              War
            </NavLink>
```

(`NavLink` and `SwordIcon` are already imported/defined in this file — verify with `grep -n "NavLink\\|SwordIcon" src/components/Navbar.jsx`.)

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/Navbar.jsx
git commit -m "feat(war): enable the War nav link"
```

---

## Task 18: Document the schema + manual end-to-end verification

**Files:**
- Modify: `docs/DATABASE.md`

- [ ] **Step 1: Update the CP War section of `docs/DATABASE.md`**

Replace the "CP War (migration `015`)" section's table descriptions with the v2 tables: `war_players` (now `spawn_region`, `season_id`, `shield_until`, `last_income_at`), `war_regions` (keyed by `region_id` = `adm1_code`; per-unit columns `soldier`/`tank`/`jet`; `is_hq`), `war_movements` (`from_region`/`to_region`, `unit_type`, `count`, `mode`). Note that the `015` hex tables were dropped by `019`, that `war_regions` writes are broad-authenticated for Phase 1 client-side combat resolution, and add `019_cp_war_v2.sql` to the migrations table.

- [ ] **Step 2: Commit**

```bash
git add docs/DATABASE.md
git commit -m "docs(db): document CP War v2 tables"
```

- [ ] **Step 3: Manual end-to-end walkthrough** (`npm run dev`)

Verify each, ideally with two browser profiles (two accounts) to test combat:
- [ ] Visiting `/war` loads the real dark map; provinces are faintly tinted; no console errors.
- [ ] On first visit you're assigned a **random province** with a ⭐ HQ marker and the starting army; a flash names your city.
- [ ] **Buy units** (each type) deducts the right coins (check the sidebar/casino balance) and the HQ marker's count grows.
- [ ] Click your province, then a **bordering** province: the move modal opens; soldiers/tanks list it as a land destination.
- [ ] Pick **jets** and confirm an **overseas** province appears as a destination (land units don't show it).
- [ ] Sending units shows an in-transit marker that moves toward the target and resolves after the unit's timer.
- [ ] Moving into an **empty** province claims it (it tints your color). Reinforcing your own province adds units.
- [ ] Attacking an **enemy** province with a larger force flips it to you with the correct survivors; a smaller force leaves the defender holding with reduced units.
- [ ] Losing your last province shows the eliminated banner; buying units respawns you on a new random province.
- [ ] `npm run build` passes.

- [ ] **Step 4: Commit any fixes from the walkthrough**, then open a PR.

```bash
git commit -am "fix(war): address Phase 1 walkthrough findings" # if needed
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** This plan delivers Phase 1 of the spec only — real map (MapLibre + admin-1 provinces), random-city spawn, soldiers/tanks/jets, land/air movement, client-resolved subtraction combat, buy-with-coins, leaderboard. Buildings, warships, conquest spoils, shields, the `pg_cron` server tick, and offline income are **Phase 2/3** and intentionally excluded (see "Phase 1 simplifications").
- **Concurrency caveat (known, acceptable for friends-and-family):** like the old game, combat is resolved by whichever client polls first, guarded by the `update ... where status='moving'` claim. It is not server-authoritative until Phase 3.
- **Asset coupling:** `war_regions.region_id`, the `provinces.geojson` feature `adm1_code` (via `promoteId`), and the keys in `provinces.json` must all be the same `adm1_code`. They are, because all three come from `build-war-geo.mjs`.
- **Tile source:** CARTO dark tiles are used keyless for now (fine at this scale); note attribution. If they rate-limit, swap the `tiles` URLs in `MapView.jsx`.
```
