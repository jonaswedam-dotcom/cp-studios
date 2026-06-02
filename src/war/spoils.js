export const COIN_PER_STRENGTH = 15 // tunable. Raised 5→15 so conquest is far less coin-negative
// (a won fight no longer returns ~25× less than the army it destroyed). Mirrored in the live
// war_tick() loot literal — see supabase/migrations/038_war_balance.sql + parity.test.js.

// Fraction of value looted, scaled by share of the defender destroyed (cap 0.8).
export function lootFraction(defendersKilled, defenderForce) {
  if (defenderForce <= 0) return 0
  return Math.min(0.8, 0.8 * (defendersKilled / defenderForce))
}

export function lootCoins(fraction, defenderStrength) {
  return Math.round(fraction * defenderStrength * COIN_PER_STRENGTH)
}
