// Pure targeting logic for click-to-attack: which provinces a player can act on,
// and from where. Split into two functions on purpose:
//   • computeTargets  → the BOUNDED set we badge/glow on the map (clean frontier).
//   • sourcesForDest  → the PERMISSIVE launch options for whatever the player clicks
//                       (so nothing reachable is ever a dead click).
import { UNITS } from './units.js'
import { landNeighbors, landReachable, distanceKm } from './geo.js'

const AIR = UNITS.jet.airRangeKm
const SEA = UNITS.warship.seaRangeKm
const LAND = UNITS.soldier.landRangeKm
const SEA_EXPAND_BADGES = 12 // most coastal neutrals a fleet badges at once (keeps the map readable)

const landUnits = (r) => (r?.soldier || 0) + (r?.tank || 0)

// Owner-based classification of a destination relative to `userId`.
//   unclaimed → 'expand', another player → 'attack', yourself → 'reinforce'.
function classify(destId, regions, userId) {
  const owner = regions[destId]?.owner_id
  if (!owner) return 'expand'
  if (owner === userId) return 'reinforce'
  return 'attack'
}

// Every valid {from, mode} the player can launch to reach `dest`, only counting
// sources that actually hold a unit of the matching mode. Ordered by mode
// preference (land → sea → air) then by largest relevant army first.
export function sourcesForDest(dest, regions, graph, { userId, airRangeKm = AIR, seaRangeKm = SEA, landRangeKm = LAND } = {}) {
  const dc = graph.regions[dest]?.centroid
  const destCoastal = !!graph.regions[dest]?.coastal
  const out = []
  for (const s of Object.values(regions)) {
    if (s.owner_id !== userId) continue
    const sid = s.region_id
    if (sid === dest) continue
    const sc = graph.regions[sid]?.centroid
    const km = (sc && dc) ? distanceKm(sc, dc) : Infinity

    if (landUnits(s) > 0 && landReachable(sid, graph, landRangeKm).includes(dest)) {
      out.push({ from: sid, mode: 'land', army: landUnits(s) })
    }
    if ((s.warship || 0) > 0 && graph.regions[sid]?.coastal && destCoastal && km <= seaRangeKm) {
      out.push({ from: sid, mode: 'sea', army: s.warship || 0 })
    }
    if ((s.jet || 0) > 0 && km <= airRangeKm) {
      out.push({ from: sid, mode: 'air', army: s.jet || 0 })
    }
  }
  const pref = { land: 0, sea: 1, air: 2 }
  out.sort((a, b) => pref[a.mode] - pref[b.mode] || b.army - a.army)
  return out.map(({ from, mode }) => ({ from, mode }))
}

// Bounded list of [{ id, kind }] to highlight, computed across ALL owned provinces:
//   • land adjacency for every owned province with land units (attack/expand), and
//   • air/sea reach added ONLY for already-claimed enemy provinces (bounded by player
//     count) — distant unclaimed neutrals are intentionally left un-badged so the map
//     stays readable; they remain reachable via sourcesForDest when clicked directly.
// Own provinces are never badged (reinforcement is reached by clicking your territory).
export function computeTargets(regions, graph, { userId, shieldedOwnerIds = new Set(), airRangeKm = AIR, seaRangeKm = SEA, landRangeKm = LAND } = {}) {
  const owned = Object.values(regions).filter((r) => r.owner_id === userId)
  const claimed = Object.values(regions).filter((r) => r.owner_id && r.owner_id !== userId)
  const kinds = new Map()

  const consider = (id) => {
    if (kinds.has(id)) return
    const kind = classify(id, regions, userId)
    if (kind === 'reinforce') return // own territory: not a map badge
    if (kind === 'attack' && shieldedOwnerIds.has(regions[id]?.owner_id)) return
    kinds.set(id, kind)
  }

  for (const s of owned) {
    const sid = s.region_id
    const sc = graph.regions[sid]?.centroid
    const hasLand = landUnits(s) > 0
    if (hasLand) {
      for (const nb of landNeighbors(sid, graph)) consider(nb)
    }
    const hasJet = (s.jet || 0) > 0
    const hasSea = (s.warship || 0) > 0 && graph.regions[sid]?.coastal
    if ((hasJet || hasSea || hasLand) && sc) {
      // Nearby same-landmass enemies are land-attackable too, so a soldiers-only player sees
      // them glow (claimed enemies only — bounded by player count, keeps the map readable).
      const landSet = hasLand ? new Set(landReachable(sid, graph, landRangeKm)) : null
      for (const c of claimed) {
        const cc = graph.regions[c.region_id]?.centroid
        if (!cc) continue
        const km = distanceKm(sc, cc)
        if (hasJet && km <= airRangeKm) consider(c.region_id)
        else if (hasSea && graph.regions[c.region_id]?.coastal && km <= seaRangeKm) consider(c.region_id)
        else if (landSet && landSet.has(c.region_id)) consider(c.region_id)
      }
    }
  }

  // Sea expansion: if the player has a coastal warship, also badge the nearest unclaimed
  // coastal quarters within sea range, so an island/coastal fleet always has a visible target.
  // (Distant neutrals were previously only reachable by a blind direct click, which made
  // warships feel land-locked.) Bounded to SEA_EXPAND_BADGES to keep the map readable.
  const coastalFleetTiles = owned.filter((s) => (s.warship || 0) > 0 && graph.regions[s.region_id]?.coastal)
  if (coastalFleetTiles.length) {
    const seaCands = []
    for (const [rid, gr] of Object.entries(graph.regions)) {
      if (!gr?.coastal || !gr.centroid || kinds.has(rid) || regions[rid]?.owner_id) continue
      let nearest = Infinity
      for (const s of coastalFleetTiles) {
        const sc = graph.regions[s.region_id]?.centroid
        if (sc) nearest = Math.min(nearest, distanceKm(sc, gr.centroid))
      }
      if (nearest <= seaRangeKm) seaCands.push({ id: rid, km: nearest })
    }
    seaCands.sort((a, b) => a.km - b.km)
    for (const c of seaCands.slice(0, SEA_EXPAND_BADGES)) consider(c.id)
  }

  return [...kinds].map(([id, kind]) => ({ id, kind }))
}
