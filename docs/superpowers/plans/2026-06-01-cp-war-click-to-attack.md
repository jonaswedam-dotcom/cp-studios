# CP War — Click-to-Attack UX Redesign (plan)

**Date:** 2026-06-01 · **Branch:** `feature/war-click-to-attack` · **Migrations:** none (client-only)
**Design:** [specs/2026-06-01-cp-war-click-to-attack-design.md](../specs/2026-06-01-cp-war-click-to-attack-design.md)

Goal: make attacking obvious — reachable targets auto-glow as clickable hexagons, click one to
send troops, no destination dropdown, no "select your own province first" step.

## Steps (each verified)

1. **`src/war/targeting.js` + `targeting.test.js`** (TDD, 13 tests) → verify: `node --test src/war/*.test.js` green.
   - `sourcesForDest(dest, regions, graph, {userId})` → ordered `{from, mode}` launch options (permissive; powers the click).
   - `computeTargets(regions, graph, {userId, shieldedOwnerIds})` → bounded `{id, kind}` badge set (land adjacency + claimed-only air/sea; excludes own + shielded).
2. **`MoveUnitsModal.jsx`** → streamlined send panel: no destination dropdown; auto source/mode from `sources`; counts default to max (sea cargo opt-in); All/Half presets (sea-capacity-aware); arrival + "leaves N" readout. → verify: build.
3. **`MapView.jsx`** → glowing clickable hexagon target markers + brighter fill/outline driven by a `targets` prop; `ready` is now state so paint effects re-run after the map loads. → verify: build.
4. **`WarPage.jsx`** → drop `selected/moveFrom/moveDest`; add `targets`/`shieldedOwnerIds` memos; `onRegionClick`: own→manage, shielded→flash, reachable→send panel, unreachable→flash; `handleMove({from,dest,stack})` keeps deduct→insert→rollback and stores validated `v.mode`. → verify: build + no dangling refs.
5. **`BuildingsModal.jsx`** → optional "Reinforce here" button (opens send panel pointed at the owned province). → verify: build.
6. **`Sidebar.jsx`** → "How to Play" rewritten for the new flow. → verify: build.

## Verification (done)

- `node --test src/war/*.test.js` → **71 pass / 0 fail** (58 existing + 13 new).
- `npm run build` → clean (142 modules).
- Independent reviewer subagent: **no blockers**; server move contract (`{from_region,to_region,units,mode,arrives_at}` + source deduction + rollback) preserved; `sourcesForDest`↔`validateMove` agree on reachability. Flagged items addressed: map load-race (→ `ready` state), sea "All" capacity (→ capped presets), persist `v.mode`.

## Known pre-existing (unchanged, not a regression)

`handleMove` writes absolute source counts from a render snapshot (client last-write-wins trust
model — identical to the prior code). Hardening would need an optimistic-locked update / RPC;
left out of scope.

## Ship

No migrations. Merge `feature/war-click-to-attack` → `main` and deploy (Vercel). Nothing for Jonas to apply.
