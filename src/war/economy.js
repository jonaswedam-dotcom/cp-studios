import { UNITS } from './units.js'

export function armySizeMultiplier(totalUnits) {
  return Math.min(3, 1 + 0.25 * Math.floor((totalUnits || 0) / 1000))
}

export function troopCost(type, count, costMult = 1, armyMult = 1) {
  const u = UNITS[type]
  if (!u || count <= 0) return 0
  return Math.round(u.cost * count * costMult * armyMult)
}

export function maxAffordable(type, balance, costMult = 1, armyMult = 1) {
  const u = UNITS[type]
  if (!u) return 0
  return Math.max(0, Math.floor((balance ?? 0) / (u.cost * costMult * armyMult)))
}
