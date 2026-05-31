# CP War Phase 2 — Depth (Warships, Buildings, Modifiers, Spoils) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add strategic depth on top of the playable Phase 1 core: warships (sea movement), five upgradeable buildings, building modifiers in combat/economy, neutral garrisons, and conquest spoils (loot + building downgrade, no total wipeout).

**Architecture:** Same shape as Phase 1 — pure, unit-tested logic modules under `src/war/` plus a thin React/MapLibre layer. New building effects are pure functions that combat/economy consume via optional, defaulted arguments (so Phase 1 behaviour and tests are preserved). Combat is still client-resolved (server tick is Phase 3).

**Tech Stack:** React 18 + Vite, Supabase (Postgres + RLS + Realtime), maplibre-gl, Node `node:test`. No new npm deps.

---

## Prerequisites (must exist before starting — from Phase 1)

This plan builds directly on `docs/superpowers/plans/2026-05-31-cp-war-phase1-conquest-core.md`. Verify these exist:

- **`src/war/units.js`** — `UNITS` (`soldier`/`tank`/`jet`, each `{label,strength,cost,mode,travelSeconds,airRangeKm?}`), `UNIT_TYPES`, `START_ARMY`.
- **`src/war/combat.js`** — `emptyStack()`, `stackTotal(stack)`, `stackStrength(stack)`, `resolveCombat(attackStack, defenseStack) -> {winner, survivors}`.
- **`src/war/economy.js`** — `troopCost(type, count)`, `maxAffordable(type, balance)`.
- **`src/war/geo.js`** — `landNeighbors(id, graph)`, `centroidOf(id, graph)`, `distanceKm(a, b)`, `airReachable(id, graph, rangeKm)`.
- **`src/war/spawn.js`** — `pickRandomSpawn(graph, claimedSet, rng)`.
- **`src/war/icons.jsx`** — `UNIT_SVG`, `UnitIcon`, `markerEl({type,color,count,hq})`.
- **`src/war/useWarData.js`** — `useWarData(userId) -> {graph, regions, players, movements, loading, setRegions, loadAll}`.
- **`src/war/MapView.jsx`**, **`BuyUnitsModal.jsx`**, **`MoveUnitsModal.jsx`**, **`Sidebar.jsx`**, **`src/pages/WarPage.jsx`** (orchestrator with `handleBuy`, `handleMove`, `resolveMovements`, `onRegionClick`).
- **`scripts/build-war-geo.mjs`** → `public/war/provinces.json` (`{regions:{[adm1_code]:{name,city,country,centroid,neighbors}}}`) + `public/war/provinces.topojson`. **NOTE (changed during Phase 1):** the asset is now Natural Earth **10m** admin-1 (~4,596 provinces) shipped as compact **TopoJSON** (converted to GeoJSON client-side via `topojson-client`); there is no `provinces.geojson`. The build pipeline is `topology()` (unquantized) → `presimplify`+`simplify` (`topojson-simplify`) → `quantize` (`topojson-client`). When this phase adds a `coastal` flag, compute the arc-usage counts on the **unquantized** topology (right after `topology()`/`neighbors`, before simplify/quantize), and add `coastal` to each `regions[code]` entry.
- **DB tables** `war_players`, `war_regions` (cols `soldier`/`tank`/`jet`, `is_hq`, …), `war_movements`. Migrations up to `019`.
- **`src/context/CasinoContext.jsx`** exposes `adjustBalance(delta)`.

Tests run with `node --test <path>`. Branch before the first commit (e.g. `git checkout -b feature/war-phase2`).

---

## Task 1: Add coastal flag + sea reachability to the geo asset

A province is **coastal** if it has a polygon edge not shared with any neighbour (worldwide admin-1 data shares every land border, so an unshared arc ≈ coastline). Warships travel between coastal provinces within a sea range.

**Files:**
- Modify: `scripts/build-war-geo.mjs`
- Regenerate: `public/war/provinces.json`, `public/war/provinces.geojson`
- Modify: `src/war/geo.js`
- Modify: `src/war/geo.test.js`

- [ ] **Step 1: Compute `coastal` in `scripts/build-war-geo.mjs`**

After the `const nbrs = neighbors(...)` line and before building `regions`, add an arc-usage count and a coastal test:

```js
// Count how many geometries use each arc (by absolute index). Inter-province
// borders are shared (count 2); an arc used once is a coastline/dataset edge.
const arcUse = new Map()
function arcsOf(geom) {
  // topojson geometry arcs: Polygon = [[ringArcs...]], MultiPolygon = [[[ringArcs...]]]
  const out = []
  const walk = (a) => Array.isArray(a) ? a.forEach(walk) : out.push(Math.abs(a))
  walk(geom.arcs ?? [])
  return out
}
const topoGeoms = topo.objects.p.geometries
topoGeoms.forEach((g) => arcsOf(g).forEach((idx) => arcUse.set(idx, (arcUse.get(idx) || 0) + 1)))
function isCoastal(g) { return arcsOf(g).some((idx) => (arcUse.get(idx) || 0) === 1) }
```

Then in the `feats.forEach(...)` loop, add `coastal` to each region (use the matching topo geometry by index `i`):

```js
  regions[code] = {
    name: p.name || code,
    city: cityHit ? cityHit.name : (p.name || code),
    country,
    centroid: centroid(f.geometry),
    coastal: isCoastal(topoGeoms[i]),
    neighbors: nbrs[i].map(j => codes[j]),
  }
```

- [ ] **Step 2: Regenerate the asset**

Run: `npm run build:war-geo`
Expected: prints `Wrote NNNN provinces.`

- [ ] **Step 3: Sanity-check coastal flags**

Run: `node -e "const g=require('./public/war/provinces.json').regions;const c=Object.values(g).filter(r=>r.coastal).length;console.log('coastal',c,'of',Object.keys(g).length)"`
Expected: a large but not total count (most coastal provinces flagged; landlocked ones not).

- [ ] **Step 4: Add `seaReachable` to `src/war/geo.js`**

Append:

```js
// Coastal provinces reachable by sea from a coastal `id` within rangeKm.
// Returns [] if `id` itself is not coastal.
export function seaReachable(id, graph, rangeKm) {
  const self = graph.regions[id]
  if (!self || !self.coastal) return []
  const from = self.centroid
  const out = []
  for (const [rid, r] of Object.entries(graph.regions)) {
    if (rid === id || !r.coastal) continue
    if (distanceKm(from, r.centroid) <= rangeKm) out.push(rid)
  }
  return out
}
```

- [ ] **Step 5: Add a failing test then confirm it passes**

Add to `src/war/geo.test.js`:

```js
import { seaReachable } from './geo.js'

const SEA = {
  regions: {
    P: { centroid: [0, 0],  coastal: true,  neighbors: [] },
    Q: { centroid: [5, 0],  coastal: true,  neighbors: [] },   // ~555km
    R: { centroid: [0, 0.1],coastal: false, neighbors: [] },   // close but landlocked
  },
}

test('seaReachable links coastal provinces in range, skips landlocked', () => {
  assert.deepEqual(seaReachable('P', SEA, 1000), ['Q'])
})

test('seaReachable from a landlocked province is empty', () => {
  assert.deepEqual(seaReachable('R', SEA, 100000), [])
})
```

Run: `node --test src/war/geo.test.js`
Expected: PASS (original geo tests + 2 new).

- [ ] **Step 6: Commit**

```bash
git add scripts/build-war-geo.mjs public/war/provinces.json public/war/provinces.geojson src/war/geo.js src/war/geo.test.js
git commit -m "feat(war): coastal flag + sea reachability for warships"
```

---

## Task 2: Warship unit (config, schema, stacks, movement)

Adding a 4th unit touches the stack shape everywhere. Order the edits so the build stays green.

**Files:**
- Modify: `src/war/units.js`
- Modify: `src/war/combat.js` (+ `combat.test.js`)
- Modify: `src/war/icons.jsx`
- Create: `supabase/migrations/020_war_warship.sql`
- Modify: `src/war/MoveUnitsModal.jsx`
- Modify: `src/pages/WarPage.jsx`

- [ ] **Step 1: Add the warship to `src/war/units.js`**

```js
export const UNITS = {
  soldier: { label: 'Soldier', strength: 1, cost: 100, mode: 'land', travelSeconds: 30 },
  tank:    { label: 'Tank',    strength: 5, cost: 500, mode: 'land', travelSeconds: 45 },
  jet:     { label: 'Jet',     strength: 3, cost: 800, mode: 'air',  travelSeconds: 20, airRangeKm: 4500 },
  warship: { label: 'Warship', strength: 2, cost: 600, mode: 'sea',  travelSeconds: 60, seaRangeKm: 7000 },
}

export const UNIT_TYPES = ['soldier', 'tank', 'jet', 'warship']

export const START_ARMY = { soldier: 500, tank: 0, jet: 0, warship: 0 }
```

- [ ] **Step 2: Update `emptyStack()` + a stack-from-row helper in `src/war/combat.js`**

Replace `emptyStack` and add `stackFromRow`:

```js
export function emptyStack() {
  return { soldier: 0, tank: 0, jet: 0, warship: 0 }
}

// Build a stack object from a war_regions row (or movement), reading UNIT_TYPES.
export function stackFromRow(row) {
  const s = emptyStack()
  for (const t of UNIT_TYPES) s[t] = row?.[t] || 0
  return s
}
```

(`scaleToStrength` already loops `UNIT_TYPES`, so it covers warships automatically.)

- [ ] **Step 3: Update the emptyStack test in `src/war/combat.test.js`**

```js
test('emptyStack has all unit types at 0', () => {
  assert.deepEqual(emptyStack(), { soldier: 0, tank: 0, jet: 0, warship: 0 })
})
```

Run: `node --test src/war/combat.test.js`
Expected: PASS.

- [ ] **Step 4: Add the warship icon to `src/war/icons.jsx`** (add to `UNIT_SVG`)

```js
  warship: '<svg viewBox="0 0 24 24"><path d="M3 14 h18 l-2.5 5 a2 2 0 0 1 -1.8 1 H7.3 a2 2 0 0 1 -1.8 -1 Z" fill="currentColor"/><rect x="10" y="6" width="2" height="7" fill="currentColor"/><rect x="12" y="7" width="6" height="2" fill="currentColor"/></svg>',
```

- [ ] **Step 5: Write `supabase/migrations/020_war_warship.sql`**

```sql
-- Migration 020: add warships + sea movement to CP War. Idempotent.
alter table public.war_regions   add column if not exists warship integer not null default 0;
alter table public.war_movements drop  constraint if exists war_movements_unit_type_check;
alter table public.war_movements add   constraint war_movements_unit_type_check
  check (unit_type in ('soldier','tank','jet','warship'));
alter table public.war_movements drop  constraint if exists war_movements_mode_check;
alter table public.war_movements add   constraint war_movements_mode_check
  check (mode in ('land','air','sea'));
```

Apply it by hand in the Supabase SQL editor. Verify: `select warship from public.war_regions limit 1;` runs without error.

- [ ] **Step 6: Handle `mode === 'sea'` in `src/war/MoveUnitsModal.jsx`**

In the `destinations` useMemo, replace the reachability branch:

```js
  const destinations = useMemo(() => {
    if (!graph) return []
    const mode = UNITS[type].mode
    let ids = []
    if (mode === 'air') ids = airReachable(fromRegion, graph, UNITS[type].airRangeKm)
    else if (mode === 'sea') ids = seaReachable(fromRegion, graph, UNITS[type].seaRangeKm)
    else ids = landNeighbors(fromRegion, graph)
    return ids.map((id) => ({
      id,
      label: graph.regions[id]?.city || graph.regions[id]?.name || id,
      owner: regions[id]?.owner_name,
      enemy: regions[id]?.owner_id && regions[id].owner_id !== fromRow?.owner_id,
    }))
  }, [graph, type, fromRegion, regions, fromRow])
```

And update the import line at the top:

```js
import { landNeighbors, airReachable, seaReachable } from './geo.js'
```

- [ ] **Step 7: Update reachability + combat defense in `src/pages/WarPage.jsx`**

(a) Add `seaReachable` and `stackFromRow` to the imports:

```js
import { landNeighbors, airReachable, seaReachable } from '../war/geo.js'
import { stackStrength, resolveCombat, emptyStack, stackFromRow } from '../war/combat.js'
```

(b) In `onRegionClick`, extend reachability:

```js
    const reachableLand = landNeighbors(selected, graph)
    const reachableAir  = graph ? airReachable(selected, graph, UNITS.jet.airRangeKm) : []
    const reachableSea  = graph ? seaReachable(selected, graph, UNITS.warship.seaRangeKm) : []
    const canReach = reachableLand.includes(regionId) || reachableAir.includes(regionId) || reachableSea.includes(regionId)
```

(c) In `resolveMovements`, replace the explicit defense object with the helper:

```js
        const defense = stackFromRow(dest)
        const r = resolveCombat(incoming, defense)
```

- [ ] **Step 8: Verify build + tests**

Run: `npm run build && node --test src/war/`
Expected: build succeeds; all war tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/war/units.js src/war/combat.js src/war/combat.test.js src/war/icons.jsx supabase/migrations/020_war_warship.sql src/war/MoveUnitsModal.jsx src/pages/WarPage.jsx
git commit -m "feat(war): warships + sea movement"
```

---

## Task 3: Buildings — schema + config module (TDD)

**Files:**
- Create: `supabase/migrations/021_war_buildings.sql`
- Create: `src/war/buildings.js`
- Test: `src/war/buildings.test.js`

- [ ] **Step 1: Write `supabase/migrations/021_war_buildings.sql`**

```sql
-- Migration 021: CP War buildings. Idempotent.
create table if not exists public.war_buildings (
  id         uuid primary key default gen_random_uuid(),
  region_id  text not null references public.war_regions(region_id) on delete cascade,
  owner_id   uuid references auth.users(id) on delete set null,
  type       text not null check (type in ('bunker','antiair','factory','lab','bank')),
  level      integer not null default 1 check (level between 1 and 3),
  created_at timestamptz not null default now()
);
create index if not exists war_buildings_region_idx on public.war_buildings(region_id);
create index if not exists war_buildings_owner_idx   on public.war_buildings(owner_id);

alter table public.war_buildings enable row level security;
create policy "war_buildings_select" on public.war_buildings for select using (auth.role() = 'authenticated');
-- Broad write in Phase 2 (client resolves combat/capture). Phase 3 tightens this.
create policy "war_buildings_insert" on public.war_buildings for insert with check (auth.role() = 'authenticated');
create policy "war_buildings_update" on public.war_buildings for update using (auth.role() = 'authenticated');
create policy "war_buildings_delete" on public.war_buildings for delete using (auth.role() = 'authenticated');

-- Realtime: alter publication supabase_realtime add table public.war_buildings;
```

Apply by hand; enable Realtime for `war_buildings`.

- [ ] **Step 2: Write the failing test `src/war/buildings.test.js`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildingCost, SLOTS_PER_REGION, BUILDING_TYPES,
  defenseMultiplier, antiAirFactor, costMultiplier, strengthMultiplier, incomePerTick,
} from './buildings.js'

test('there are five building types and three slots', () => {
  assert.equal(BUILDING_TYPES.length, 5)
  assert.equal(SLOTS_PER_REGION, 3)
})

test('buildingCost scales by level and is Infinity past max', () => {
  assert.equal(buildingCost('bunker', 0), 800)   // build (0 -> 1)
  assert.equal(buildingCost('bunker', 1), 1600)  // upgrade (1 -> 2)
  assert.equal(buildingCost('bunker', 2), 3200)  // upgrade (2 -> 3)
  assert.equal(buildingCost('bunker', 3), Infinity)
})

test('defenseMultiplier rises with bunker level', () => {
  assert.equal(defenseMultiplier([]), 1)
  assert.equal(defenseMultiplier([{ type: 'bunker', level: 2 }]), 2) // 1 + 0.5*2
})

test('antiAirFactor caps at 0.75', () => {
  assert.equal(antiAirFactor([]), 0)
  assert.equal(antiAirFactor([{ type: 'antiair', level: 3 }]), 0.75)
})

test('global economy multipliers sum building levels', () => {
  assert.equal(costMultiplier([{ type: 'factory', level: 2 }]), 0.8)   // -10%/lvl
  assert.equal(strengthMultiplier([{ type: 'lab', level: 3 }]), 1.3)   // +10%/lvl
})

test('incomePerTick scales with bank levels and tick length', () => {
  // 2 bank levels, 3600s tick, 50 coins/level/hour -> 100
  assert.equal(incomePerTick([{ type: 'bank', level: 2 }], 3600), 100)
})
```

Run: `node --test src/war/buildings.test.js`
Expected: FAIL — cannot find module `./buildings.js`.

- [ ] **Step 3: Write `src/war/buildings.js`**

```js
export const SLOTS_PER_REGION = 3
export const INCOME_PER_BANK_LEVEL_PER_HOUR = 50 // tunable

export const BUILDINGS = {
  bunker:  { label: 'Bunker',      kind: 'defense', cost: [800, 1600, 3200],  desc: 'Defenders here fight much harder.' },
  antiair: { label: 'Anti-Air',    kind: 'defense', cost: [1000, 2000, 4000], desc: 'Shoots down incoming jets.' },
  factory: { label: 'War Factory', kind: 'economy', cost: [1500, 3000, 6000], desc: 'Cheaper troops everywhere.' },
  lab:     { label: 'Command Lab', kind: 'economy', cost: [1500, 3000, 6000], desc: 'Stronger troops everywhere.' },
  bank:    { label: 'Bank',        kind: 'economy', cost: [1200, 2400, 4800], desc: 'Passive coin income.' },
}
export const BUILDING_TYPES = Object.keys(BUILDINGS)

// Cost to go from `currentLevel` to `currentLevel + 1`. currentLevel 0 = build.
export function buildingCost(type, currentLevel) {
  const t = BUILDINGS[type]
  if (!t || currentLevel >= 3) return Infinity
  return t.cost[currentLevel]
}

// ── Local (per-region) defensive effects ────────────────────────────────────
export function defenseMultiplier(regionBuildings) {
  const b = regionBuildings.find((x) => x.type === 'bunker')
  return b ? 1 + 0.5 * b.level : 1
}
export function antiAirFactor(regionBuildings) {
  const b = regionBuildings.find((x) => x.type === 'antiair')
  return b ? Math.min(0.75, 0.25 * b.level) : 0
}

// ── Global (per-player) economy effects ─────────────────────────────────────
function totalLevel(buildings, type) {
  return buildings.filter((b) => b.type === type).reduce((s, b) => s + b.level, 0)
}
export function costMultiplier(playerBuildings) {
  return Math.max(0.4, 1 - 0.1 * totalLevel(playerBuildings, 'factory'))
}
export function strengthMultiplier(playerBuildings) {
  return 1 + 0.1 * totalLevel(playerBuildings, 'lab')
}
export function incomePerTick(playerBuildings, tickSeconds) {
  const lv = totalLevel(playerBuildings, 'bank')
  return Math.round(lv * INCOME_PER_BANK_LEVEL_PER_HOUR * (tickSeconds / 3600))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/war/buildings.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/021_war_buildings.sql src/war/buildings.js src/war/buildings.test.js
git commit -m "feat(war): buildings schema + config/effects module"
```

---

## Task 4: Apply building modifiers in combat & economy (TDD, backward-compatible)

Add **optional** modifier args so all Phase 1 calls keep working unchanged.

**Files:**
- Modify: `src/war/combat.js` (+ `combat.test.js`)
- Modify: `src/war/economy.js` (+ `economy.test.js`)

- [ ] **Step 1: Add modifier tests to `src/war/combat.test.js`**

```js
test('bunker defenseMult lets a smaller defender win', () => {
  // 100 atk vs 60 def, but x2 bunker -> def 120 > 100
  const r = resolveCombat({ soldier: 100 }, { soldier: 60 }, { defenseMult: 2 })
  assert.equal(r.winner, 'defender')
})

test('antiAir removes incoming jet strength', () => {
  // 10 jets = 30 atk str; 0.5 anti-air removes 15 -> 15 atk vs 20 def -> defender
  const r = resolveCombat({ jet: 10 }, { soldier: 20 }, { antiAir: 0.5 })
  assert.equal(r.winner, 'defender')
})
```

- [ ] **Step 2: Update `resolveCombat` in `src/war/combat.js`**

Replace the `resolveCombat` function:

```js
import { UNITS, UNIT_TYPES } from './units.js'
// ... (emptyStack, stackTotal, stackStrength, stackFromRow, scaleToStrength unchanged) ...

// opts: { attackMult=1, defenseMult=1, antiAir=0 }
export function resolveCombat(attackStack, defenseStack, opts = {}) {
  const { attackMult = 1, defenseMult = 1, antiAir = 0 } = opts
  const atk = { ...emptyStack(), ...attackStack }
  const def = { ...emptyStack(), ...defenseStack }

  let aStr = stackStrength(atk) * attackMult
  // Anti-air removes a fraction of the incoming jet contribution.
  aStr -= antiAir * (atk.jet || 0) * UNITS.jet.strength * attackMult
  aStr = Math.max(0, aStr)
  const dStr = stackStrength(def) * defenseMult

  if (aStr > dStr) {
    return { winner: 'attacker', survivors: scaleToStrength(atk, aStr, aStr - dStr) }
  }
  if (dStr > aStr) {
    return { winner: 'defender', survivors: scaleToStrength(def, dStr, dStr - aStr) }
  }
  return { winner: 'defender', survivors: { ...emptyStack(), soldier: 1 } }
}
```

(Note: `scaleToStrength(stack, fromStrength, targetStrength)` already divides target by from, so passing the *modified* `aStr`/`dStr` as `fromStrength` keeps proportions correct.)

- [ ] **Step 3: Add a cost-modifier test to `src/war/economy.test.js`**

```js
test('troopCost applies an optional cost multiplier', () => {
  assert.equal(troopCost('soldier', 10, 0.8), 800) // 1000 * 0.8
  assert.equal(troopCost('soldier', 10), 1000)     // default 1
})
```

- [ ] **Step 4: Update `troopCost` in `src/war/economy.js`**

```js
export function troopCost(type, count, costMult = 1) {
  const u = UNITS[type]
  if (!u || count <= 0) return 0
  return Math.round(u.cost * count * costMult)
}
```

- [ ] **Step 5: Run tests**

Run: `node --test src/war/combat.test.js src/war/economy.test.js`
Expected: PASS (all old + new).

- [ ] **Step 6: Commit**

```bash
git add src/war/combat.js src/war/combat.test.js src/war/economy.js src/war/economy.test.js
git commit -m "feat(war): building modifiers in combat + economy (backward-compatible)"
```

---

## Task 5: Buildings in the data hook + build/upgrade UI + wiring

**Files:**
- Modify: `src/war/useWarData.js`
- Create: `src/war/BuildingsModal.jsx`
- Modify: `src/pages/WarPage.jsx`
- Modify: `src/war/MapView.jsx`

- [ ] **Step 1: Load + subscribe to buildings in `src/war/useWarData.js`**

(a) Add state: `const [buildings, setBuildings] = useState([])` (after `movements` state).

(b) In `loadAll`, add a fourth query and setter:

```js
    const [rRes, pRes, mRes, bRes] = await Promise.all([
      supabase.from('war_regions').select('*'),
      supabase.from('war_players').select('*'),
      supabase.from('war_movements').select('*').eq('status', 'moving'),
      supabase.from('war_buildings').select('*'),
    ])
    // ... existing setters ...
    if (bRes.data) setBuildings(bRes.data)
```

(c) Add a realtime handler inside the channel chain (before `.subscribe()`):

```js
      .on('postgres_changes', { event: '*', schema: 'public', table: 'war_buildings' }, payload => {
        const b = payload.new || payload.old
        setBuildings(prev => {
          const filtered = prev.filter(x => x.id !== b?.id)
          return payload.eventType === 'DELETE' ? filtered : [...filtered, payload.new]
        })
      })
```

(d) Return `buildings` in the hook's return object.

- [ ] **Step 2: Write `src/war/BuildingsModal.jsx`**

```jsx
import { BUILDINGS, BUILDING_TYPES, SLOTS_PER_REGION, buildingCost } from './buildings.js'

export default function BuildingsModal({ regionName, regionBuildings, balance, onBuild, onUpgrade, onClose, loading }) {
  const used = regionBuildings.length
  const slotsLeft = SLOTS_PER_REGION - used

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-cp-card border border-cp-border rounded-3xl p-6 space-y-4 shadow-2xl">
        <h3 className="font-display text-lg text-cp-text">Buildings — {regionName}</h3>
        <p className="text-xs text-cp-muted">{slotsLeft} of {SLOTS_PER_REGION} slots free. Economy buildings help your whole empire but are lost if this province is captured.</p>

        {/* Existing buildings (upgradeable) */}
        {regionBuildings.map((b) => {
          const next = buildingCost(b.type, b.level)
          return (
            <div key={b.id} className="flex items-center gap-3 bg-cp-elevated border border-cp-border rounded-xl px-3 py-2.5">
              <div className="flex-1">
                <p className="text-sm text-cp-text">{BUILDINGS[b.type].label} <span className="text-cp-muted">Lv {b.level}</span></p>
                <p className="text-[11px] text-cp-muted">{BUILDINGS[b.type].desc}</p>
              </div>
              <button disabled={loading || b.level >= 3 || (balance ?? 0) < next}
                onClick={() => onUpgrade(b)}
                className="px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-semibold disabled:opacity-30">
                {b.level >= 3 ? 'Max' : `Upgrade · ${next.toLocaleString()}`}
              </button>
            </div>
          )
        })}

        {/* Build new (if slots free) */}
        {slotsLeft > 0 && (
          <div className="grid grid-cols-1 gap-2 pt-1">
            <p className="text-xs text-cp-muted uppercase tracking-wider">Build new</p>
            {BUILDING_TYPES.filter((t) => !regionBuildings.some((b) => b.type === t)).map((t) => {
              const cost = buildingCost(t, 0)
              return (
                <button key={t} disabled={loading || (balance ?? 0) < cost} onClick={() => onBuild(t)}
                  className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-cp-border text-left hover:border-cp-border-soft disabled:opacity-30">
                  <span className="text-sm text-cp-text">{BUILDINGS[t].label}<span className="block text-[11px] text-cp-muted">{BUILDINGS[t].desc}</span></span>
                  <span className="text-amber-400 text-xs font-semibold">{cost.toLocaleString()}</span>
                </button>
              )
            })}
          </div>
        )}

        <button onClick={onClose} className="w-full py-2.5 rounded-xl border border-cp-border text-cp-muted text-sm hover:text-cp-text transition-colors">Done</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire buildings into `src/pages/WarPage.jsx`**

(a) Imports:

```js
import BuildingsModal from '../war/BuildingsModal.jsx'
import { costMultiplier, defenseMultiplier, antiAirFactor, strengthMultiplier, buildingCost, SLOTS_PER_REGION } from '../war/buildings.js'
```

(b) Pull `buildings` from the hook: `const { graph, regions, players, movements, buildings, loading } = useWarData(userId)`.

(c) Add a `buildFor` state (region whose buildings modal is open): `const [buildFor, setBuildFor] = useState(null)`.

(d) Helpers near the other derived values:

```js
  const myBuildings = buildings.filter((b) => b.owner_id === userId)
  const buildingsIn = (regionId) => buildings.filter((b) => b.region_id === regionId)
  const myCostMult     = costMultiplier(myBuildings)
  const myStrengthMult = strengthMultiplier(myBuildings)
```

(e) Apply the cost multiplier in `handleBuy`: change `const cost = troopCost(type, count)` to `const cost = troopCost(type, count, myCostMult)`.

(f) Apply modifiers in `resolveMovements` combat branch — replace the combat block:

```js
      } else {
        const defense = stackFromRow(dest)
        const defBuildings = buildings.filter((b) => b.region_id === mv.to_region)
        const r = resolveCombat(incoming, defense, {
          attackMult: strengthMultiplier(buildings.filter((b) => b.owner_id === mv.player_id)),
          defenseMult: defenseMultiplier(defBuildings),
          antiAir: antiAirFactor(defBuildings),
        })
        if (r.winner === 'attacker') {
          // Spoils + capture handled in Task 6; for now transfer the region.
          await supabase.from('war_regions').update({
            owner_id: mv.player_id, owner_name: player?.display_name || 'Player', color: player?.color || '#888',
            is_hq: false, ...r.survivors, updated_at: new Date().toISOString(),
          }).eq('region_id', mv.to_region)
        } else {
          await supabase.from('war_regions').update({ ...r.survivors, updated_at: new Date().toISOString() }).eq('region_id', mv.to_region)
        }
      }
```

(g) Add build/upgrade handlers:

```js
  const handleBuild = useCallback(async (type) => {
    if (busy || !buildFor) return
    setBusy(true)
    try {
      const cost = buildingCost(type, 0)
      if ((balance ?? 0) < cost) { showFlash('Not enough coins.'); return }
      if (buildingsIn(buildFor).length >= SLOTS_PER_REGION) { showFlash('No slots left.'); return }
      await adjustBalance(-cost)
      await supabase.from('war_buildings').insert({ region_id: buildFor, owner_id: userId, type, level: 1 })
      showFlash(`Built ${type}.`)
    } finally { setBusy(false) }
  }, [busy, buildFor, balance, buildings, userId, adjustBalance])

  const handleUpgrade = useCallback(async (b) => {
    if (busy) return
    setBusy(true)
    try {
      const cost = buildingCost(b.type, b.level)
      if ((balance ?? 0) < cost) { showFlash('Not enough coins.'); return }
      await adjustBalance(-cost)
      await supabase.from('war_buildings').update({ level: b.level + 1 }).eq('id', b.id)
      showFlash(`Upgraded ${b.type} to Lv ${b.level + 1}.`)
    } finally { setBusy(false) }
  }, [busy, balance, adjustBalance])
```

(h) Open the buildings modal from a selected own province. In `onRegionClick`, when the player clicks their **already-selected** province (the deselect branch), open buildings instead of just deselecting:

```js
    if (regionId === selected) { setBuildFor(selected); setSelected(null); return }
```

(i) Render the modal (next to the others):

```jsx
      {buildFor && (
        <BuildingsModal regionName={graph.regions[buildFor]?.city || buildFor}
          regionBuildings={buildingsIn(buildFor)} balance={balance} loading={busy}
          onBuild={handleBuild} onUpgrade={handleUpgrade} onClose={() => setBuildFor(null)} />
      )}
```

- [ ] **Step 4: Show building dots on owned regions in `src/war/MapView.jsx`**

Accept a `buildings` prop and render a tiny count dot. Change the signature to `export default function MapView({ graph, regions, movements, buildings = [], onRegionClick })` and, inside `syncMarkers`, after creating each region marker, append a badge if that region has buildings:

```js
      const bn = buildings.filter((b) => b.region_id === r.region_id).length
      if (bn > 0) {
        const dot = document.createElement('div')
        dot.textContent = '🏗'
        dot.style.cssText = 'position:absolute;top:-9px;right:-7px;font-size:11px'
        el.appendChild(dot)
      }
```

Add `buildings` to the `syncMarkers` effect deps: `useEffect(syncMarkers, [regions, graph, buildings])`. Pass it from WarPage: `<MapView graph={graph} regions={regions} movements={movements} buildings={buildings} onRegionClick={onRegionClick} />`.

- [ ] **Step 5: Verify build + tests**

Run: `npm run build && node --test src/war/`
Expected: build succeeds; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/war/useWarData.js src/war/BuildingsModal.jsx src/pages/WarPage.jsx src/war/MapView.jsx
git commit -m "feat(war): build/upgrade buildings + apply modifiers"
```

---

## Task 6: Neutral garrisons + conquest spoils (TDD for the pure parts)

**Files:**
- Create: `src/war/neutral.js` (+ `neutral.test.js`)
- Create: `src/war/spoils.js` (+ `spoils.test.js`)
- Modify: `src/pages/WarPage.jsx`

- [ ] **Step 1: Write `src/war/neutral.test.js`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { neutralGarrison } from './neutral.js'

test('neutralGarrison is deterministic and in range', () => {
  const a = neutralGarrison('USA-3514')
  const b = neutralGarrison('USA-3514')
  assert.deepEqual(a, b)
  assert.ok(a.soldier >= 50 && a.soldier <= 300)
  assert.equal(a.tank, 0)
})
```

Run: `node --test src/war/neutral.test.js` → FAIL (no module).

- [ ] **Step 2: Write `src/war/neutral.js`**

```js
import { emptyStack } from './combat.js'

// Deterministic small defending force on an unclaimed province (50–300 soldiers).
export function neutralGarrison(regionId) {
  let h = 0
  for (let i = 0; i < regionId.length; i++) h = (h * 31 + regionId.charCodeAt(i)) >>> 0
  return { ...emptyStack(), soldier: 50 + (h % 251) }
}
```

Run: `node --test src/war/neutral.js`... use `node --test src/war/neutral.test.js` → PASS.

- [ ] **Step 3: Write `src/war/spoils.test.js`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lootFraction, lootCoins } from './spoils.js'

test('lootFraction scales with how much of the defender you destroyed, capped 0.8', () => {
  assert.equal(lootFraction(0, 100), 0)
  assert.equal(lootFraction(50, 100), 0.4) // 0.8 * 0.5
  assert.equal(lootFraction(100, 100), 0.8)
  assert.equal(lootFraction(100, 0), 0)    // no defenders -> no loot
})

test('lootCoins multiplies fraction by defender strength and a coin rate', () => {
  // defenderStrength 200, fraction 0.4, rate 5 -> 400
  assert.equal(lootCoins(0.4, 200), 400)
})
```

Run: `node --test src/war/spoils.test.js` → FAIL.

- [ ] **Step 4: Write `src/war/spoils.js`**

```js
export const COIN_PER_STRENGTH = 5 // tunable

// Fraction of value looted, scaled by share of the defender destroyed (cap 0.8).
export function lootFraction(defendersKilled, defenderForce) {
  if (defenderForce <= 0) return 0
  return Math.min(0.8, 0.8 * (defendersKilled / defenderForce))
}

export function lootCoins(fraction, defenderStrength) {
  return Math.round(fraction * defenderStrength * COIN_PER_STRENGTH)
}
```

Run: `node --test src/war/spoils.test.js` → PASS.

- [ ] **Step 5: Use garrisons + spoils in `resolveMovements` (`src/pages/WarPage.jsx`)**

(a) Imports:

```js
import { neutralGarrison } from '../war/neutral.js'
import { lootFraction, lootCoins } from '../war/spoils.js'
import { stackStrength } from '../war/combat.js' // (already imported alongside resolveCombat)
```

(b) Replace the whole `if (!dest || !dest.owner_id) { ... } else if (...) { ... } else { ... }` block with garrison + spoils logic:

```js
      if (!dest || !dest.owner_id) {
        // Unclaimed: must beat the neutral garrison to take it.
        const garrison = neutralGarrison(mv.to_region)
        const r = resolveCombat(incoming, garrison, {
          attackMult: strengthMultiplier(buildings.filter((b) => b.owner_id === mv.player_id)),
        })
        if (r.winner === 'attacker') {
          await supabase.from('war_regions').upsert({
            region_id: mv.to_region, country_code: graph?.regions[mv.to_region]?.country || null,
            owner_id: mv.player_id, owner_name: player?.display_name || 'Player', color: player?.color || '#888',
            is_hq: false, ...r.survivors, updated_at: new Date().toISOString(),
          }, { onConflict: 'region_id' })
        }
        // If the attack failed, the units are simply lost (garrison held).
      } else if (dest.owner_id === mv.player_id) {
        await supabase.from('war_regions')
          .update({ [mv.unit_type]: (dest[mv.unit_type] || 0) + mv.count, updated_at: new Date().toISOString() })
          .eq('region_id', mv.to_region)
      } else {
        // Enemy province.
        const defense = stackFromRow(dest)
        const defBuildings = buildings.filter((b) => b.region_id === mv.to_region)
        const defStrength = stackStrength(defense) * defenseMultiplier(defBuildings)
        const r = resolveCombat(incoming, defense, {
          attackMult: strengthMultiplier(buildings.filter((b) => b.owner_id === mv.player_id)),
          defenseMult: defenseMultiplier(defBuildings),
          antiAir: antiAirFactor(defBuildings),
        })
        if (r.winner === 'attacker') {
          // Spoils: loot coins (credited only on the attacker's own client) + downgrade captured buildings.
          if (mv.player_id === userId) {
            const frac = lootFraction(stackTotal(defense), stackTotal(defense)) // full kill on capture
            const loot = lootCoins(frac, defStrength)
            if (loot > 0) { await adjustBalance(loot); showFlash(`Conquered + looted ${loot.toLocaleString()} coins`) }
          }
          // Downgrade/transfer the captured province's buildings (loser keeps a remnant of value).
          for (const b of defBuildings) {
            if (b.level <= 1) await supabase.from('war_buildings').delete().eq('id', b.id)
            else await supabase.from('war_buildings').update({ level: b.level - 1, owner_id: mv.player_id }).eq('id', b.id)
          }
          await supabase.from('war_regions').update({
            owner_id: mv.player_id, owner_name: player?.display_name || 'Player', color: player?.color || '#888',
            is_hq: false, ...r.survivors, updated_at: new Date().toISOString(),
          }).eq('region_id', mv.to_region)
        } else {
          await supabase.from('war_regions').update({ ...r.survivors, updated_at: new Date().toISOString() }).eq('region_id', mv.to_region)
        }
      }
```

(c) Ensure `stackTotal` is imported: update the combat import line to
`import { stackStrength, stackTotal, resolveCombat, emptyStack, stackFromRow } from '../war/combat.js'`.

- [ ] **Step 6: Verify build + tests**

Run: `npm run build && node --test src/war/`
Expected: build succeeds; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/war/neutral.js src/war/neutral.test.js src/war/spoils.js src/war/spoils.test.js src/pages/WarPage.jsx
git commit -m "feat(war): neutral garrisons + conquest spoils (loot + building downgrade)"
```

---

## Task 7: Sidebar bonuses, how-to, docs + manual verification

**Files:**
- Modify: `src/war/Sidebar.jsx`
- Modify: `docs/DATABASE.md`

- [ ] **Step 1: Show the player's global bonuses in `src/war/Sidebar.jsx`**

Add a `bonuses` prop (`{ costMult, strengthMult, banks }`) and render a small panel under the stats grid:

```jsx
        {bonuses && (
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="px-2 py-1 rounded-lg bg-cp-card text-cp-muted">Troops −{Math.round((1 - bonuses.costMult) * 100)}% cost</span>
            <span className="px-2 py-1 rounded-lg bg-cp-card text-cp-muted">+{Math.round((bonuses.strengthMult - 1) * 100)}% strength</span>
          </div>
        )}
```

Pass it from WarPage: `bonuses={{ costMult: myCostMult, strengthMult: myStrengthMult }}`. Also add a how-to line: `<p>🏗 Click a province you own again to build/upgrade</p>`.

- [ ] **Step 2: Document Phase 2 schema in `docs/DATABASE.md`**

Add `war_buildings` (region_id FK, owner_id, type ∈ {bunker,antiair,factory,lab,bank}, level 1–3) to the CP War section; note `war_regions.warship`; note movements now allow `unit_type='warship'` and `mode='sea'`; add migrations `020` and `021` to the migrations table. Note that economy buildings give global effects but transfer/downgrade on capture.

- [ ] **Step 3: Commit**

```bash
git add src/war/Sidebar.jsx src/pages/WarPage.jsx docs/DATABASE.md
git commit -m "feat(war): sidebar bonuses + Phase 2 docs"
```

- [ ] **Step 4: Manual end-to-end walkthrough** (`npm run dev`, two accounts)

- [ ] Build a **warship** in a coastal province; confirm it can target an overseas coastal province (and that landlocked provinces never offer sea destinations).
- [ ] Click an owned province twice → **Buildings** modal opens; build each of the five types (slots cap at 3); upgrade to Lv 3; coins deducted correctly.
- [ ] **Factory** reduces troop prices in the Buy modal; **Lab** makes your attacks win where they previously wouldn't; **Bunker** lets a defender hold against a slightly larger force; **Anti-Air** blunts a jet-only attack.
- [ ] Attacking an **unclaimed** province now fights a small garrison (a tiny stack can fail).
- [ ] Conquering an **enemy** province credits loot coins to the attacker and **downgrades** that province's buildings rather than deleting them all.
- [ ] `npm run build` passes; `node --test src/war/` passes.

---

## Self-review notes (for the implementer)

- **Spec coverage (Phase 2):** warships + sea ✓ (Tasks 1–2); buildings + Lv 1–3 upgrades ✓ (Tasks 3, 5); modifiers (bunker/anti-air/factory/lab) ✓ (Task 4–5); neutral garrisons ✓ (Task 6); conquest spoils (loot + downgrade, loser keeps a remnant) ✓ (Task 6). Bank income is *defined* here (`incomePerTick`) but only **paid out** by the Phase 3 server tick — intentional.
- **Known simplifications (client-resolved, friends-and-family):** loot coins are credited to the attacker without debiting the defender (pillage, not transfer), and only on the attacker's own client (`mv.player_id === userId`). Server-authoritative coin handling arrives in Phase 3. A failed attack on a garrison/enemy loses the in-transit units (they don't bounce back).
- **Cross-cutting change:** adding `warship` widened the stack shape — `emptyStack`, the `war_regions` columns, `START_ARMY`, and the combat `defense` object all had to include it. `stackFromRow` (Task 2) centralises reading a stack from a row so future units only touch `units.js` + a migration.
- **Type consistency:** `resolveCombat(attack, defense, opts?)` opts = `{attackMult, defenseMult, antiAir}`; `troopCost(type, count, costMult=1)`; building effects take the relevant building array (`defenseMultiplier`/`antiAirFactor` take a region's buildings; `costMultiplier`/`strengthMultiplier`/`incomePerTick` take a player's buildings).
```
