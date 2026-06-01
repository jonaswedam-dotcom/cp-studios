// Pure targeting logic for click-to-attack: which provinces a player can act on,
// and from where. Split into two functions on purpose:
//   • computeTargets  → the BOUNDED set we badge/glow on the map (clean frontier).
//   • sourcesForDest  → the PERMISSIVE launch options for whatever the player clicks
//                       (so nothing reachable is ever a dead click).
import { UNITS } from './units.js'
import { landNeighbors, distanceKm } from './geo.js'

const AIR = UNITS.jet.airRangeKm
const SEA = UNITS.warship.seaRangeKm

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
export function sourcesForDest(dest, regions, graph, { userId, airRangeKm = AIR, seaRangeKm = SEA } = {}) {
  const dc = graph.regions[dest]?.centroid
  const destCoastal = !!graph.regions[dest]?.coastal
  const out = []
  for (const s of Object.values(regions)) {
    if (s.owner_id !== userId) continue
    const sid = s.region_id
    if (sid === dest) continue
    const sc = graph.regions[sid]?.centroid
    const km = (sc && dc) ? distanceKm(sc, dc) : Infinity

    if (landUnits(s) > 0 && landNeighbors(sid, graph).includes(dest)) {
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
export function computeTargets(regions, graph, { userId, shieldedOwnerIds = new Set(), airRangeKm = AIR, seaRangeKm = SEA } = {}) {
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
    if (landUnits(s) > 0) {
      for (const nb of landNeighbors(sid, graph)) consider(nb)
    }
    const hasJet = (s.jet || 0) > 0
    const hasSea = (s.warship || 0) > 0 && graph.regions[sid]?.coastal
    if ((hasJet || hasSea) && sc) {
      for (const c of claimed) {
        const cc = graph.regions[c.region_id]?.centroid
        if (!cc) continue
        const km = distanceKm(sc, cc)
        if (hasJet && km <= airRangeKm) consider(c.region_id)
        else if (hasSea && graph.regions[c.region_id]?.coastal && km <= seaRangeKm) consider(c.region_id)
      }
    }
  }

  return [...kinds].map(([id, kind]) => ({ id, kind }))
}
