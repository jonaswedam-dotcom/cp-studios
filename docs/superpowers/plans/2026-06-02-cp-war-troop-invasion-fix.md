# CP War — Fix "Troops Can't Invade Other Countries" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. ALSO start with superpowers:systematic-debugging mindset — the root cause is already established below; re-verify it (Task 0) before changing code.

**Goal:** Make land troops (soldiers/tanks) reliably able to invade bordering / same-landmass countries for *every* player, and make those targets discoverable on the map — without requiring jets.

**Architecture:** Two complementary client-side fixes. (A) Repair the province **adjacency graph** (`scripts/build-war-geo.mjs` → regenerates `public/war/provinces.json`), which is missing ~43% of real international borders; this fixes both direct-neighbor moves and the same-landmass connected-components used by the 2000 km land-reach fallback. (B) Make `computeTargets` (`src/war/targeting.js`) **badge** same-landmass-within-range *neutral* quarters as `expand`, so land-expansion targets glow instead of being invisible blind-clicks.

**Tech Stack:** Vite + React SPA, vanilla JS war-logic modules under `src/war/` (tested with `node --test`), TopoJSON map asset built by a Node build script. **No backend/SQL changes** — see "Migration note" at the end.

---

## ⚠️ Read first: established root cause (with evidence)

The user reports: *"You can't invade other countries with your own troops. For some it works, for some it doesn't, even bordering countries. They have to use jets."* Desired behavior: **land troops invade across borders / same landmass easily; only open-water crossings need ships or jets.** (Do NOT add a "3-country distance limit" yet — the existing 2000 km land range is fine and out of scope.)

### How invasion currently works (verified by reading the code)

- The map forwards **every** province click to `onRegionClick` (`src/war/MapView.jsx:126-129`), which calls `sourcesForDest(...)` (`src/pages/WarPage.jsx:303-314`). So land invasion is *mechanically* possible by clicking any reachable tile — there is **no hard click gate**.
- Land reach = `landReachable(id, graph, rangeKm)` (`src/war/geo.js:61-78`): **direct graph neighbours** (filtered to existing regions) **PLUS** any **same-connected-component** quarter whose centroid is within `rangeKm` (2000 km for soldiers/tanks, `src/war/units.js:13-14`). The "same component" guard is what stops soldiers swimming across open sea.
- The map only **glows** ("badges") targets returned by `computeTargets` (`src/war/targeting.js:60-118`). For **neutral / unclaimed** countries it badges **only direct graph neighbours** (line 78). The on-map hint literally says *"Tap a glowing tile to attack / take it"* (`WarPage.jsx:364`).

### The two root causes

**ROOT CAUSE 1 — the adjacency graph is missing ~43% of real international borders (data bug).**
`build-war-geo.mjs:201` derives cross-country adjacency from `neighbors(topo.objects.p.geometries)` — TopoJSON **shared-arc** detection. But each country is clipped to **its own** centroid-based quadrant rectangles (`clipToRect`, lines 148-160), so a shared international border is cut at *different* points for each country. The two countries' border segments no longer form identical shared arcs, so `neighbors()` misses most international adjacencies.

Measured on the shipped `public/war/provinces.json` (1027 quarters):
- **438 quarters (42.6%) have ZERO cross-border land neighbours** — their only graph neighbours are their own country's sibling quarters (NW/NE/SW/SE).
- The neighbour graph fragments into **96 connected components** (largest 532, then 92, 20, several 8s/4s). Because the 2000 km land-reach fallback is gated by *same component*, a player whose quarter is stranded in a small fragment (or whose real neighbour's edge is missing) can't reach geographic neighbours by land.
- Major borders that *do* have an edge (FRA↔DEU, USA↔MEX, USA↔CAN, ESP↔FRA, IND↔PAK, BRA↔ARG were all verified `directNeighbor=true`) work fine — which is exactly why it **"works for some, not others."**

**ROOT CAUSE 2 — land-expansion targets are never badged (discoverability bug).**
`computeTargets` badges *enemy-owned* same-landmass quarters within land range (the `claimed` loop, `targeting.js:86-93`), but has **no equivalent pass for unclaimed/neutral** quarters — those are only badged if they are *direct* neighbours (line 78). Combined with Root Cause 1, ~43% of players see no foreign country glow for a land invasion and conclude "troops can't invade — I need jets." (Note: `sourcesForDest` *does* allow the click, but players follow the glowing-tile instruction and never try.)

### Re-verification snippets (Task 0 uses these)

Run from repo root. Save as throwaway and delete after.

```bash
# A) cross-border-zero count + components (the headline numbers)
node -e '
const g=JSON.parse(require("fs").readFileSync("public/war/provinces.json","utf8")).regions;
const ids=Object.keys(g);
let noCross=0;
for(const id of ids){const nb=(g[id].neighbors||[]).filter(n=>g[n]); if(!nb.some(n=>g[n].country!==g[id].country)) noCross++;}
const comp=new Map();let next=0;
for(const id of ids){if(comp.has(id))continue;const c=next++,st=[id];comp.set(id,c);
  while(st.length){const x=st.pop();for(const y of (g[x].neighbors||[]))if(g[y]&&!comp.has(y)){comp.set(y,c);st.push(y);}}}
console.log("quarters w/ ZERO cross-border neighbour:",noCross,"/",ids.length,"("+(100*noCross/ids.length).toFixed(1)+"%)");
console.log("connected components:",next);
'
```

Expected on the **current (buggy)** asset: ~`438 / 1027 (42.6%)`, `96 components`.
Target after Fix A: cross-border-zero **< ~30 (genuine islands only)**, components **collapse toward continents (~a dozen, dominated by Afro-Eurasia/Americas/etc.)**.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `scripts/build-war-geo.mjs` | Builds the map asset + adjacency graph | **Modify**: add a geometric proximity pass that augments cross-country neighbours; pin Natural Earth source; print adjacency stats. |
| `public/war/provinces.json` | Shipped graph (`{regions:{id:{...,neighbors}}}`) | **Regenerated** by the build script (committed artifact). |
| `public/war/provinces.topojson` | Shipped map geometry | **Regenerated** (must stay ID-stable). |
| `src/war/targeting.js` | What glows (`computeTargets`) + what a click can do (`sourcesForDest`) | **Modify**: add a bounded neutral land-expand badging pass. |
| `src/war/targeting.test.js` | Unit tests for the above | **Modify**: add failing tests for neutral land-expand badging. |
| `scripts/check-war-adjacency.mjs` | One-shot graph-health assertion (CI-style guard) | **Create**: re-runs the diagnostics and exits non-zero if the graph regresses. |

**Idempotency / safety invariant:** Region IDs (`<ADM0_A3>_<Q>`, e.g. `IDN_NW`) MUST remain byte-identical after regeneration — existing `war_regions` rows in Supabase key off them. Adding neighbour edges does not change IDs, but re-fetching Natural Earth from a moving `master` branch could. Task 1 pins the source and Task 4 asserts ID stability.

---

## Task 0: Reproduce & confirm root cause (no code changes)

**Files:** none (diagnostics only).

- [ ] **Step 1: Confirm the headline numbers**

Run the re-verification snippet (A) above.
Expected: `~438 / 1027 (42.6%)` zero-cross-border quarters, `96` components.

- [ ] **Step 2: Confirm the mechanic already allows land invasion (so the fix is data + badging, not the move pipeline)**

Re-read `src/pages/WarPage.jsx:303-314` (`onRegionClick`) and `src/war/MapView.jsx:126-129` (map click). Confirm clicks route through `sourcesForDest` for any tile, and that `MoveUnitsModal` → `handleMove` → `validateMove` (`src/war/movement.js:40-44`) gates land moves on `landReachable`. Write one sentence confirming there is no target-only click gate.

- [ ] **Step 3: Confirm the server does NOT reject valid land moves (scope check for a possible migration)**

Inspect the tick. Run:
```bash
grep -ni "reachab\|neighbor\|from_region\|distance\|landReach\|adjacent" supabase/migrations/023_war_tick.sql supabase/migrations/037_war_remap_to_quarters.sql supabase/migrations/0*war*.sql 2>/dev/null
```
Read `war_tick()` (latest war-tick migration — start at `023_war_tick.sql`, then any later `*_war_*` that redefines it, e.g. `026`,`027`,`036`,`038`). Determine: **does the tick validate that a movement's `from_region`→`to_region` is reachable, or does it only resolve combat on arrival?**
- If the tick does **not** validate reachability (expected, per project notes): the entire fix is client-side, **no SQL migration**.
- If it **does** validate against a server-side adjacency table/list that is also sparse: note it — a migration to refresh server adjacency would then be required. **Record the finding in the summary; do not write the migration until the client fix is verified.**

- [ ] **Step 4: Commit the investigation note (docs only)**

```bash
git checkout -b fix/war-troop-invasion
git add docs/superpowers/plans/2026-06-02-cp-war-troop-invasion-fix.md
git commit -m "docs(war): troop-invasion root-cause + fix plan"
```

---

## Task 1: Pin the Natural Earth source (prevent ID drift on regen)

**Files:**
- Modify: `scripts/build-war-geo.mjs:13-14`

- [ ] **Step 1: Replace the moving `master` refs with a pinned commit**

Pick a current commit SHA of `nvkelso/natural-earth-vector` (use `git ls-remote https://github.com/nvkelso/natural-earth-vector HEAD` or the GitHub UI) and substitute it for `master` in both URLs so future rebuilds are reproducible:

```js
// scripts/build-war-geo.mjs (was: .../natural-earth-vector/master/geojson/...)
const NE_REF  = 'master' // TODO: replace with a pinned 40-char commit SHA for reproducibility
const ADMIN0 = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_REF}/geojson/ne_10m_admin_0_countries.geojson`
const PLACES = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_REF}/geojson/ne_10m_populated_places.geojson`
```

> If pinning is impractical (network/unknown SHA), keep `master` but rely on Task 4's ID-stability guard to catch drift. Do not skip Task 4.

- [ ] **Step 2: Commit**

```bash
git add scripts/build-war-geo.mjs
git commit -m "chore(war): pin Natural Earth source ref for reproducible map builds"
```

---

## Task 2: Add a geometric proximity adjacency pass to the build script (Fix A)

**Files:**
- Modify: `scripts/build-war-geo.mjs` (helpers near the other geometry helpers ~line 46; augmentation in the region-assembly loop ~lines 216-233; stats print ~line 240)

**Why proximity, not just shared arcs:** Two quarters are land-adjacent if their clipped polygon boundaries are within a small distance of each other. This is robust to the per-country clipping that breaks shared arcs. It augments (does not replace) the existing TopoJSON `neighbors()` + intra-country edges.

- [ ] **Step 1: Add geometry helpers (after `ringArea`, ~line 46)**

```js
// All outer-ring vertices of a Polygon/MultiPolygon as [lng,lat] points.
function boundaryPoints(geometry) {
  const pts = []
  for (const poly of polysOf(geometry)) for (const pt of poly[0]) pts.push(pt)
  return pts
}
// Axis-aligned bbox [minX,minY,maxX,maxY] of a point list (reuse bboxOf for geoms).
function pointsBbox(pts) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
  for (const [x, y] of pts) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y }
  return [a, b, c, d]
}
// Cheap lng/lat-degree padding for an ~EPS_KM proximity test near the equator/mid-latitudes.
// 1 deg lat ~= 111km; we pad generously and confirm with true haversine distKm below.
const ADJ_EPS_KM  = 40   // border counts as "touching" if boundary vertices come within this
const ADJ_PAD_DEG = 0.6  // bbox pre-filter padding (~66km); must comfortably exceed ADJ_EPS_KM
```

- [ ] **Step 2: Build the proximity augmentation just before the region loop (after `const simplified = feature(...)`, ~line 207)**

```js
// ── Proximity adjacency (Fix A) ──────────────────────────────────────────────
// TopoJSON shared-arc neighbours miss most international borders because each country is
// clipped to its OWN quadrant rectangles, so a shared border is cut at different points per
// country and no longer forms an identical arc. Repair it: any two quarters from DIFFERENT
// countries whose clipped boundaries come within ADJ_EPS_KM are land-adjacent.
const featById = new Map()
simplified.features.forEach((f, i) => featById.set(ids[i], { pts: boundaryPoints(f.geometry) }))
for (const [id, v] of featById) { v.bbox = pointsBbox(v.pts) }
const countryOf = (rid) => (meta[rid]?.country || '')
const proxNbrs = new Map(ids.map((id) => [id, new Set()]))
const bboxesNear = (A, B) =>
  A[0] - ADJ_PAD_DEG <= B[2] && B[0] - ADJ_PAD_DEG <= A[2] &&
  A[1] - ADJ_PAD_DEG <= B[3] && B[1] - ADJ_PAD_DEG <= A[3]
for (let i = 0; i < ids.length; i++) {
  const a = featById.get(ids[i])
  for (let j = i + 1; j < ids.length; j++) {
    if (countryOf(ids[i]) === countryOf(ids[j])) continue       // siblings handled by intraNeighbors
    const b = featById.get(ids[j])
    if (!bboxesNear(a.bbox, b.bbox)) continue                    // cheap reject
    let touch = false
    outer: for (const pa of a.pts) for (const pb of b.pts) {
      if (distKm(pa, pb) <= ADJ_EPS_KM) { touch = true; break outer }
    }
    if (touch) { proxNbrs.get(ids[i]).add(ids[j]); proxNbrs.get(ids[j]).add(ids[i]) }
  }
}
```

- [ ] **Step 3: Merge proximity edges into each region's neighbours (modify the region loop, ~line 223)**

Change:
```js
const neigh = new Set([...nbrs[i].map((j) => ids[j]), ...intraNeighbors(rid)])
```
to:
```js
const neigh = new Set([...nbrs[i].map((j) => ids[j]), ...intraNeighbors(rid), ...proxNbrs.get(rid)])
```

- [ ] **Step 4: Print adjacency stats so the build self-reports health (modify final log, ~line 240-241)**

```js
const ridsArr = Object.keys(regions)
const zeroCross = ridsArr.filter((rid) => {
  const nb = (regions[rid].neighbors || []).filter((n) => regions[n])
  return !nb.some((n) => regions[n].country !== regions[rid].country)
}).length
// connected components
const comp = new Map(); let cn = 0
for (const rid of ridsArr) { if (comp.has(rid)) continue; const c = cn++, st = [rid]; comp.set(rid, c)
  while (st.length) { const x = st.pop(); for (const y of (regions[x].neighbors || [])) if (regions[y] && !comp.has(y)) { comp.set(y, c); st.push(y) } } }
console.log(`Wrote ${ridsArr.length} country-quarter regions from ${usedCode.size} countries (${nCoastal} coastal).`)
console.log(`Adjacency: ${zeroCross} quarters with zero cross-border neighbour, ${cn} connected components.`)
```

- [ ] **Step 5: Regenerate the asset**

```bash
npm run build:war-geo
```
Expected console: a markedly lower zero-cross-border count (target **< ~30**, genuine islands) and far fewer components (target **~5-15**, continent-scale). If the numbers don't improve, raise `ADJ_EPS_KM` (e.g. 60) and/or `ADJ_PAD_DEG` proportionally and rebuild. If the build is too slow, the bbox pre-filter (`bboxesNear`) is the bottleneck — it should already make most pairs O(1); only widen EPS if needed.

- [ ] **Step 6: Commit (regenerated asset + script)**

```bash
git add scripts/build-war-geo.mjs public/war/provinces.json public/war/provinces.topojson
git commit -m "fix(war): repair sparse cross-border land adjacency via proximity pass"
```

---

## Task 3: Badge neutral same-landmass land-expand targets (Fix B)

**Files:**
- Test: `src/war/targeting.test.js` (extend the existing `LANDMASS_*` fixture block ~lines 138-165)
- Modify: `src/war/targeting.js` (`computeTargets`, after the sea-expansion block ~line 115)

- [ ] **Step 1: Write the failing test (append to `targeting.test.js`)**

```js
// A neutral (unclaimed) country on the same landmass within land range must GLOW as expand,
// not just be a blind click — otherwise soldiers-only players think they can't invade.
test('computeTargets badges a nearby same-landmass NEUTRAL as expand for a soldiers-only player', () => {
  // FOE has no REGIONS row in a neutral variant -> it is unclaimed. Reuse LANDMASS_G geometry.
  const reg = {
    HOME: { region_id: 'HOME', owner_id: 'me', soldier: 100, tank: 0, jet: 0, warship: 0 },
    LINK: { region_id: 'LINK', owner_id: 'me', soldier: 1 }, // I own the link, FOE/ISLE neutral
  }
  const k = kindOf(computeTargets(reg, LANDMASS_G, OPTS))
  assert.equal(k.FOE, 'expand')   // same landmass, within land range, unclaimed -> glows
  assert.equal(k.ISLE, undefined) // different landmass (open sea) -> still needs a warship
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

```bash
node --test src/war/targeting.test.js
```
Expected: the new test FAILS (`k.FOE` is `undefined`, because neutral non-neighbours aren't badged today). All pre-existing tests still pass.

- [ ] **Step 3: Implement the bounded neutral land-expand pass in `computeTargets`**

In `src/war/targeting.js`, add a constant near `SEA_EXPAND_BADGES` (line 12):
```js
const LAND_EXPAND_BADGES = 16 // nearest unclaimed same-landmass quarters a land army badges (map readability)
```
Then, **after** the sea-expansion block (after line 115, before `return [...kinds]...`), add:
```js
  // Land expansion: badge the nearest UNCLAIMED quarters reachable by land (same landmass,
  // within land range) so a soldiers-only player always sees somewhere to march — mirroring the
  // sea-expansion badges above. Distant neutrals stay clickable via sourcesForDest regardless.
  const landArmyTiles = owned.filter((s) => landUnits(s) > 0)
  if (landArmyTiles.length) {
    const reach = new Set()
    for (const s of landArmyTiles) for (const id of landReachable(s.region_id, graph, landRangeKm)) reach.add(id)
    const landCands = []
    for (const id of reach) {
      if (kinds.has(id) || regions[id]?.owner_id) continue // already badged, or claimed (handled above)
      const cc = graph.regions[id]?.centroid
      if (!cc) continue
      let nearest = Infinity
      for (const s of landArmyTiles) {
        const sc = graph.regions[s.region_id]?.centroid
        if (sc) nearest = Math.min(nearest, distanceKm(sc, cc))
      }
      landCands.push({ id, km: nearest })
    }
    landCands.sort((a, b) => a.km - b.km)
    for (const c of landCands.slice(0, LAND_EXPAND_BADGES)) consider(c.id)
  }
```
> `landReachable`, `distanceKm`, and `consider` are already imported / in scope in this file (see lines 7 and 65). `landRangeKm` is already a parameter of `computeTargets` (line 60).

- [ ] **Step 4: Run tests — new test passes, nothing else breaks**

```bash
node --test src/war/targeting.test.js
```
Expected: ALL pass, including the existing `'computeTargets does NOT badge air-only (non-coastal) distant neutrals'` (NEUTRAL_FAR_AIR is ~333km but on a *different* landmass — `neighbors: []` — so it must stay un-badged; confirm it still does).

- [ ] **Step 5: Run the full war suite**

```bash
node --test src/war/*.test.js
```
Expected: all war tests pass (the suite was ~87 tests; confirm the count didn't drop and only grew by the new test).

- [ ] **Step 6: Commit**

```bash
git add src/war/targeting.js src/war/targeting.test.js
git commit -m "fix(war): glow nearby neutral land-expand targets so troop invasion is discoverable"
```

---

## Task 4: Graph-health guard + ID-stability check

**Files:**
- Create: `scripts/check-war-adjacency.mjs`

- [ ] **Step 1: Write the guard script**

```js
// Fails (exit 1) if the shipped war graph regresses: too many isolated quarters or too many
// components. Run after build:war-geo. Not wired into any pipeline by default — invoke manually.
import { readFileSync } from 'node:fs'
const g = JSON.parse(readFileSync('public/war/provinces.json', 'utf8')).regions
const ids = Object.keys(g)
let zeroCross = 0
for (const id of ids) {
  const nb = (g[id].neighbors || []).filter((n) => g[n])
  if (!nb.some((n) => g[n].country !== g[id].country)) zeroCross++
}
const comp = new Map(); let cn = 0
for (const id of ids) { if (comp.has(id)) continue; const c = cn++, st = [id]; comp.set(id, c)
  while (st.length) { const x = st.pop(); for (const y of (g[x].neighbors || [])) if (g[y] && !comp.has(y)) { comp.set(y, c); st.push(y) } } }
const MAX_ZERO_CROSS = 40   // genuine island nations only
const MAX_COMPONENTS  = 20  // continent-scale, not fragmented
console.log(`regions=${ids.length} zeroCross=${zeroCross} components=${cn}`)
let bad = false
if (zeroCross > MAX_ZERO_CROSS) { console.error(`FAIL: ${zeroCross} zero-cross-border quarters > ${MAX_ZERO_CROSS}`); bad = true }
if (cn > MAX_COMPONENTS) { console.error(`FAIL: ${cn} components > ${MAX_COMPONENTS}`); bad = true }
if (bad) process.exit(1)
console.log('OK: war adjacency graph is healthy.')
```

- [ ] **Step 2: Run it against the regenerated asset**

```bash
node scripts/check-war-adjacency.mjs
```
Expected: `OK: war adjacency graph is healthy.` If it FAILS, return to Task 2 Step 5 and raise `ADJ_EPS_KM`.

- [ ] **Step 3: Assert region IDs are unchanged vs the previous (committed) asset (ID-stability invariant)**

```bash
# Compare sorted region IDs between the committed (HEAD~) and working-tree provinces.json.
git show HEAD~3:public/war/provinces.json 2>/dev/null | node -e '
const fs=require("fs");
let prevRaw=""; process.stdin.on("data",d=>prevRaw+=d).on("end",()=>{
  const prev=Object.keys(JSON.parse(prevRaw).regions).sort();
  const cur=Object.keys(JSON.parse(fs.readFileSync("public/war/provinces.json","utf8")).regions).sort();
  const added=cur.filter(x=>!prev.includes(x)), removed=prev.filter(x=>!cur.includes(x));
  console.log("prev IDs:",prev.length,"cur IDs:",cur.length,"added:",added.length,"removed:",removed.length);
  if(added.length||removed.length){console.error("ID DRIFT — investigate before shipping:",{added:added.slice(0,20),removed:removed.slice(0,20)});process.exit(1);}
  console.log("OK: region IDs byte-stable (only neighbours changed).");
});'
```
> Adjust `HEAD~3` to whichever commit holds the pre-fix `provinces.json` if the history differs. Expected: `added: 0, removed: 0`. **If any IDs drifted, STOP** — the Natural Earth source moved; pin it (Task 1) to the SHA that produced the original asset, or you will orphan existing `war_regions` rows. (Centroid jitter alone is acceptable; ID changes are not.)

- [ ] **Step 4: Commit the guard**

```bash
git add scripts/check-war-adjacency.mjs
git commit -m "chore(war): adjacency-health guard + ID-stability check"
```

---

## Task 5: End-to-end verification (the user-visible behavior)

**Files:** none (manual + scripted verification). Use superpowers:verification-before-completion.

- [ ] **Step 1: Build passes**

```bash
npm run build
```
Expected: builds with no hard errors.

- [ ] **Step 2: Full war test suite green**

```bash
node --test src/war/*.test.js
```
Expected: all pass (old count + 1 new test). Note the exact pass count in the summary.

- [ ] **Step 3: Programmatic proof that the reported scenario is fixed**

Re-run the Task 0 / re-verification snippet (A). Then prove that a previously-stranded quarter can now reach a foreign neighbour by land:
```bash
node -e '
const g=JSON.parse(require("fs").readFileSync("public/war/provinces.json","utf8")).regions;
const ids=Object.keys(g);
const dist=([a,b],[c,d])=>{const R=6371,r=x=>x*Math.PI/180;const dla=r(d-b),dlo=r(c-a);const h=Math.sin(dla/2)**2+Math.cos(r(b))*Math.cos(r(d))*Math.sin(dlo/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));};
const comp=new Map();let cn=0;
for(const id of ids){if(comp.has(id))continue;const c=cn++,st=[id];comp.set(id,c);while(st.length){const x=st.pop();for(const y of (g[x].neighbors||[]))if(g[y]&&!comp.has(y)){comp.set(y,c);st.push(y);}}}
function landReach(id,range){const out=new Set((g[id].neighbors||[]).filter(n=>g[n]));const f=g[id].centroid,c=comp.get(id);
  for(const rid of ids){if(rid===id)continue;if(comp.get(rid)===c&&dist(f,g[rid].centroid)<=range)out.add(rid);}out.delete(id);return [...out];}
// sample 6 quarters that had zero cross-border neighbour BEFORE; show foreign land targets now.
let shown=0;
for(const id of ids){const nb=(g[id].neighbors||[]).filter(n=>g[n]);const foreign=landReach(id,2000).filter(t=>g[t].country!==g[id].country);
  if(foreign.length&&shown<6){console.log(id,g[id].country,"-> foreign land targets:",foreign.slice(0,5).map(t=>g[t].country).join(", "));shown++;}}
'
```
Expected: each sampled quarter lists several *foreign* countries reachable by land — i.e. troops can invade across borders.

- [ ] **Step 4: Manual smoke test in the app**

```bash
npm run dev
```
Then in CP War (`/war`): spawn (or reuse an account), buy soldiers, and confirm: (a) nearby **neutral** foreign countries now **glow green (expand)**, (b) tapping one opens the move panel with a **land** source (not only air), (c) a genuinely sea-separated island still does **not** offer a land option (needs warship/jet). Try a couple of different spawn locations to cover the "works for some" variability. Record what you saw.

- [ ] **Step 5: Final commit / branch ready (DO NOT push, DO NOT deploy)**

```bash
git status   # confirm only intended files changed
git log --oneline -8
```
Leave the branch `fix/war-troop-invasion` local. **Do not** `git push`, open a PR, or deploy to Vercel — per the user's instruction.

---

## Migration note (read before claiming done)

This bug is a **client-side data + UI problem**. Per project notes and Task 0 Step 3, CP War movement is created client-side and the `war_tick()` server function resolves combat on arrival; it does **not** re-validate land reachability. Therefore **this fix requires NO SQL migration** — `provinces.json`/`provinces.topojson` are client assets, and `targeting.js` is client logic.

**Only** if Task 0 Step 3 discovered that the tick (or any RPC) rejects/validates moves against a server-side adjacency list that is *also* sparse, write a new numbered migration (`049_*.sql`, idempotent) to refresh that server-side adjacency — and do it **after** the client fix is verified, as the user requested. Record the Task 0 Step 3 finding explicitly in the final summary either way.

---

## Self-Review (completed during planning)

- **Spec coverage:** Root cause 1 (sparse adjacency) → Tasks 1, 2, 4. Root cause 2 (no neutral land-expand badge) → Task 3. "Works for some, not others" → explained by the 42.6% stat and verified in Task 5 Step 3. "Cross-water needs ships/jets" → preserved (same-landmass component guard untouched; ISLE test in Task 3 Step 1). "No 3-country limit yet" → explicitly out of scope. "No deploy / no push / migrations only after" → Task 5 Step 5 + Migration note.
- **Placeholder scan:** No TBD/TODO-as-work; the one `TODO` (NE SHA) is an intentional, documented value to fill, with a fallback path (Task 4 ID guard). All code steps include complete code.
- **Type/name consistency:** `landReachable`, `distanceKm`, `consider`, `landRangeKm`, `owned`, `kinds`, `regions`, `graph` all already exist in `targeting.js` scope (verified against lines 6-7, 60-65). `boundaryPoints`/`pointsBbox`/`proxNbrs`/`featById`/`ids`/`meta`/`distKm`/`simplified` all exist or are defined within `build-war-geo.mjs` before use. Test helpers `kindOf`, `OPTS`, `LANDMASS_G` reused from the existing test file.

## Open questions for the implementer (low-risk defaults already chosen)

1. **`ADJ_EPS_KM` value** — 40 km is a starting point tuned to NE 10m + the existing `REMOVE_PCT=0.55` simplification. The Task 4 guard + Task 2 Step 5 stats tell you whether to raise it. Don't lower it below ~25 km (risks re-fragmenting).
2. **`LAND_EXPAND_BADGES` (16)** — purely a map-readability cap, mirroring `SEA_EXPAND_BADGES` (12). Safe to tune; doesn't affect what's clickable.
3. **Whether to also widen the *visible* hint text** ("Tap a glowing tile…") to mention that any nearby land country is invadable — optional polish, not required for the fix.
