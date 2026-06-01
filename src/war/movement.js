import { UNITS, UNIT_TYPES } from './units.js'
import { landNeighbors, airReachable, seaReachable } from './geo.js'

export const WARSHIP_CAPACITY = 20 // land units ferried per warship

const present = (stack) => UNIT_TYPES.filter((t) => (stack[t] || 0) > 0)
const arrival = (types) => Math.max(...types.map((t) => UNITS[t].travelSeconds))

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
    return { mode: 'air', arrivesInSeconds: arrival(types) }
  }
  // Sea: warships, optionally ferrying soldiers/tanks.
  if (hasWarship) {
    const cargo = (stack.soldier || 0) + (stack.tank || 0)
    if (cargo > WARSHIP_CAPACITY * (stack.warship || 0)) return { error: 'Over warship capacity.' }
    if (!seaReachable(fromId, graph, UNITS.warship.seaRangeKm).includes(toId)) return { error: 'No sea route.' }
    return { mode: 'sea', arrivesInSeconds: arrival(types) }
  }
  // Land: soldiers/tanks to a bordering province.
  if (onlyLand) {
    if (!landNeighbors(fromId, graph).includes(toId)) return { error: 'Not a bordering province.' }
    return { mode: 'land', arrivesInSeconds: arrival(types) }
  }
  return { error: 'Invalid unit mix.' }
}
