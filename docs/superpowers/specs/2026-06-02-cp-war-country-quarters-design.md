# CP War 3.0 — Country Quarters + Distance-Based Travel

**Date:** 2026-06-02
**Status:** Approved (maintainer) → implement + deploy to cp-studios-pi.vercel.app
**Builds on:** `2026-05-31-cp-war-real-map-redesign-design.md`, `2026-06-01-cp-war-engagement-balance-design.md`

## Summary

Two maintainer-requested changes to CP War, both deployable to the testing Vercel:

1. **Territory model:** replace the ~4,600 real Natural Earth **admin-1 provinces** with **country quarters** — each country split by its bounding-box center into four quadrants (NW/NE/SW/SE), ~1,000 clean tiles. "Attacking certain provinces" becomes "attacking adjacent/reachable country-quarters."
2. **Travel time:** make the attack-leg travel time **distance-based** instead of a flat per-unit constant — typical inter-country hop ≈ **3 min**, soldiers cap at **10 min**, jets stay fastest.

Neither touches the server tick, combat, income, targeting, or reachability logic: all of `src/war/*` is map-agnostic and reads the bundled province graph. Only the geo **asset** (`build-war-geo.mjs` → `public/war/provinces.*`) and the **travel-time math** (`units.js` + `movement.js`) change.

## 1. Country quarters

`scripts/build-war-geo.mjs` is rewritten to:

- Fetch Natural Earth **admin-0 countries** (`ne_10m_admin_0_countries`) instead of admin-1.
- For each country (excluding Antarctica), compute its bbox center and clip the polygon into four quadrant rectangles with `@turf/bbox-clip` (build-time dev dep; never shipped to the browser). Empty quadrants (country doesn't reach that corner) are skipped.
- Region id = `<ADM0_A3>_<Q>` e.g. `FRA_NW`, `USA_SE`.
- Per quarter: centroid (largest-ring average), coastal flag (single-use arc = coastline), country name, and the **most-populous populated place** inside the quadrant as the HQ city label (fallback `"<Country> <Q>"`).
- **Neighbors:** cross-country adjacency from shared border arcs (`topojson neighbors()`, same mechanism as before) **plus** the four intra-country edge pairs (NW–NE, NW–SW, NE–SE, SW–SE) added explicitly so intra-country land movement is always reliable. Diagonal pairs (NW–SE, NE–SW) are *not* neighbors (corner-touch only).

**Alternative rejected:** dissolving each country's real provinces into 4 groups — fails for the many countries with only 1–2 admin-1 units, so it can't guarantee 4 quarters. Straight lat/lng quadrants always yield clean NW/NE/SW/SE pieces.

**Known acceptable rough edges** (friends-and-family build): Antarctica excluded; antimeridian-spanning countries (Russia, US-with-Alaska, Fiji) get approximate cuts at lng 0.

The feature id property is renamed `adm1_code → region_id`; `MapView.jsx` updates its `promoteId` and click handler (2 lines).

## 2. Distance-based travel time

Replace flat `UNITS[t].travelSeconds` with a per-unit `[minTravelSeconds, maxTravelSeconds]` band, scaled by the great-circle distance `d` (km) between the source and destination centroids:

```
frac = clamp((d − TRAVEL_NEAR_KM) / (TRAVEL_FAR_KM − TRAVEL_NEAR_KM), 0, 1)   // NEAR=400, FAR=4000
travelSecondsFor(type, d) = round(min[type] + (max[type] − min[type]) × frac)
```

| Unit | Near (≤400 km) | Far (≥4000 km) |
|------|---------------|----------------|
| Soldier | 180s (3m) | 600s (10m) |
| Tank | 240s (4m) | 600s (10m) |
| Jet | 60s (1m) | 180s (3m) |
| Warship | 240s (4m) | 600s (10m) |

A leg's arrival = `max(travelSecondsFor(t, d))` over the stack's unit types (unchanged "arrive at the slowest unit" rule). In-territory reinforcement stays instant (WarPage). Lives in `units.js` (constants + `travelSecondsFor`) and `movement.js` (`validateMove` computes `d` from the graph centroids). Client-side only — the tick still honours the written `arrives_at`. No SQL/parity impact (travel constants are not embedded in migrations).

## 3. Data reset

Old `war_regions`/`war_movements`/`war_buildings` rows reference dead admin-1 ids; they're inert on the new map (only graph ids render/own). An idempotent `035_war_map_reset.sql` truncates the war tables so players respawn onto the new map — applied by Jonas like the other pending war migrations. The frontend deploy works without it.

## Testing / deploy

- `node --test src/war/*.test.js` green (update `movement.test.js` + `units.test.js` for the new travel math).
- `npm run build:war-geo` regenerates the asset; sanity-check region count, sample neighbors/coastal/city.
- `npm run build` clean.
- Deploy to **cp-studios-pi.vercel.app** via `vercel deploy --prod --yes --scope chipeater2202-8374s-projects`.
