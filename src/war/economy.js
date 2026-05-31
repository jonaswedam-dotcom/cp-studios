import { UNITS } from './units.js'

export function troopCost(type, count, costMult = 1) {
  const u = UNITS[type]
  if (!u || count <= 0) return 0
  return Math.round(u.cost * count * costMult)
}

export function maxAffordable(type, balance) {
  const u = UNITS[type]
  if (!u) return 0
  return Math.max(0, Math.floor((balance ?? 0) / u.cost))
}
