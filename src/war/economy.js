import { UNITS } from './units.js'

// Anti-snowball surcharge on buying more force. Scales on total army STRENGTH (not raw unit
// count) so a few high-strength units can't dodge it, and is uncapped so a large casino
// balance can't simply buy an unbounded doomstack at a flat 3x. Tunable.
export function armySizeMultiplier(totalStrength) {
  return 1 + 0.25 * Math.floor((totalStrength || 0) / 2500)
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
