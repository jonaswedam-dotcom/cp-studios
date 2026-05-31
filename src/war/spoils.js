export const COIN_PER_STRENGTH = 5 // tunable

// Fraction of value looted, scaled by share of the defender destroyed (cap 0.8).
export function lootFraction(defendersKilled, defenderForce) {
  if (defenderForce <= 0) return 0
  return Math.min(0.8, 0.8 * (defendersKilled / defenderForce))
}

export function lootCoins(fraction, defenderStrength) {
  return Math.round(fraction * defenderStrength * COIN_PER_STRENGTH)
}
