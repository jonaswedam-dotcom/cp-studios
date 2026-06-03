// Fails (exit 1) if the shipped war adjacency graph REGRESSES. Run after build:war-geo.
// Not wired into any pipeline by default — invoke manually.
//
// NOTE on thresholds: raw "zero-cross-border quarters" and "connected components" are NOT good
// pass/fail gates here. ~50 real island nations (Japan, Iceland, Fiji, the Caribbean/Pacific…)
// MUST stay as separate land components — you're supposed to need ships/jets to reach them — and
// island/coastal quarters legitimately have no cross-border LAND neighbour. So those counts stay
// high (≈310 zeroCross / ≈67 components) on a perfectly healthy map. We instead guard the two
// invariants that actually map to the bug ("land troops can invade nearby/same-landmass
// countries"): the continental backbone must stay connected, and most quarters must be able to
// reach a foreign country by land. (zeroCross/components are still printed, for diagnostics.)
import { readFileSync } from 'node:fs'

const g = JSON.parse(readFileSync('public/war/provinces.json', 'utf8')).regions
const ids = Object.keys(g)

function distanceKm([lng1, lat1], [lng2, lat2]) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

// Connected components of the land-neighbour graph (same logic as src/war/geo.js).
const comp = new Map(); let cn = 0; const sizes = []
for (const id of ids) {
  if (comp.has(id)) continue
  const c = cn++, st = [id]; comp.set(id, c); let sz = 0
  while (st.length) { const x = st.pop(); sz++; for (const y of (g[x].neighbors || [])) if (g[y] && !comp.has(y)) { comp.set(y, c); st.push(y) } }
  sizes.push(sz)
}
sizes.sort((a, b) => b - a)
const largest = sizes[0] || 0

// Diagnostic: quarters with no cross-border land neighbour (dominated by real islands).
let zeroCross = 0
for (const id of ids) {
  const nb = (g[id].neighbors || []).filter((n) => g[n])
  if (!nb.some((n) => g[n].country !== g[id].country)) zeroCross++
}

// Core gameplay metric: a quarter can "invade a foreign country by land" if it has any
// same-component land target within 2000km (soldier/tank range) that belongs to another country.
const LAND_RANGE_KM = 2000
let canReachForeign = 0
for (const id of ids) {
  const reach = new Set((g[id].neighbors || []).filter((n) => g[n]))
  const from = g[id].centroid, cid = comp.get(id)
  for (const rid of ids) { if (rid === id) continue; if (comp.get(rid) === cid && distanceKm(from, g[rid].centroid) <= LAND_RANGE_KM) reach.add(rid) }
  reach.delete(id)
  for (const t of reach) { if (g[t].country !== g[id].country) { canReachForeign++; break } }
}
const foreignReachPct = canReachForeign / ids.length

const MIN_REGIONS = 1000           // sanity: the full ~1027-quarter map built
const MIN_LARGEST_COMPONENT = 550  // continental backbone connected (orig 532, post-fix 600)
const MIN_FOREIGN_REACH = 0.74     // ≥74% of quarters can land-invade a foreign country (orig .648, post-fix .772)

console.log(`regions=${ids.length} largestComponent=${largest} foreignLandReach=${(100 * foreignReachPct).toFixed(1)}%`)
console.log(`diagnostics: zeroCross=${zeroCross} components=${cn} topComponentSizes=${sizes.slice(0, 6).join(',')}`)

let bad = false
if (ids.length < MIN_REGIONS) { console.error(`FAIL: only ${ids.length} regions < ${MIN_REGIONS}`); bad = true }
if (largest < MIN_LARGEST_COMPONENT) { console.error(`FAIL: largest land component ${largest} < ${MIN_LARGEST_COMPONENT} (continent fragmented)`); bad = true }
if (foreignReachPct < MIN_FOREIGN_REACH) { console.error(`FAIL: foreign land-reach ${(100 * foreignReachPct).toFixed(1)}% < ${(100 * MIN_FOREIGN_REACH).toFixed(0)}%`); bad = true }
if (bad) process.exit(1)
console.log('OK: war adjacency graph is healthy.')
