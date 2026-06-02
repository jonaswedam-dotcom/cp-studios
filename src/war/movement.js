import { UNITS, UNIT_TYPES, travelSecondsFor } from './units.js'
import { landReachable, airReachable, seaReachable, centroidOf, distanceKm } from './geo.js'

export const WARSHIP_CAPACITY = 20 // land units ferried per warship

const present = (stack) => UNIT_TYPES.filter((t) => (stack[t] || 0) > 0)

// Leg arrival = the slowest unit's distance-based travel time over fromId→toId.
const arrival = (types, fromId, toId, graph) => {
  const a = centroidOf(fromId, graph)
  const b = centroidOf(toId, graph)
  const d = a && b ? distanceKm(a, b) : 0
  return Math.max(...types.map((t) => travelSecondsFor(t, d)))
}

// Returns { mode, arrivesInSeconds } for a valid mixed-stack leg, else { error }.
export function validateMove(fromId, toId, stack, graph) {
  const types = present(stack)
  if (types.length === 0) return { error: 'No units selected.' }
  const set = new Set(types)
  const onlyLand = types.every((t) => UNITS[t].mode === 'land')
  const onlyAir = types.every((t) => t === 'jet')
  const hasWarship = set.has('warship')

  // Air: jets only.
  if (set.has('jet')) {
    if (!onlyAir) return { error: 'Jets fly alone — no other units on an air strike.' }
    if (!airReachable(fromId, graph, UNITS.jet.airRangeKm).includes(toId)) return { error: 'Out of jet range.' }
    return { mode: 'air', arrivesInSeconds: arrival(types, fromId, toId, graph) }
  }
  // Sea: warships, optionally ferrying soldiers/tanks.
  if (hasWarship) {
    const cargo = (stack.soldier || 0) + (stack.tank || 0)
    if (cargo > WARSHIP_CAPACITY * (stack.warship || 0)) return { error: 'Over warship capacity.' }
    if (!seaReachable(fromId, graph, UNITS.warship.seaRangeKm).includes(toId)) return { error: 'No sea route.' }
    return { mode: 'sea', arrivesInSeconds: arrival(types, fromId, toId, graph) }
  }
  // Land: soldiers/tanks march over connected land — a bordering province, or a nearby one on
  // the same landmass within the stack's land range (the slowest unit's range bounds the leg).
  if (onlyLand) {
    const landRangeKm = Math.min(...types.map((t) => UNITS[t].landRangeKm))
    if (!landReachable(fromId, graph, landRangeKm).includes(toId)) return { error: 'No land route in range.' }
    return { mode: 'land', arrivesInSeconds: arrival(types, fromId, toId, graph) }
  }
  return { error: 'Invalid unit mix.' }
}
