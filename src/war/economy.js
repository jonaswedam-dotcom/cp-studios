import { UNITS } from './units.js'

export function troopCost(type, count) {
  const u = UNITS[type]
  if (!u || count <= 0) return 0
  return u.cost * count
}

export function maxAffordable(type, balance) {
  const u = UNITS[type]
  if (!u) return 0
  return Math.max(0, Math.floor((balance ?? 0) / u.cost))
}
