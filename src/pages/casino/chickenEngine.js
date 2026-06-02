// Pure Chicken Road resolution. Mirrors ChickenRoadGame.jsx math (7 lanes, cash out
// anytime). Lanes are pre-rolled once at round start so the server commits the full
// outcome up front. Pure (no React/DOM); inject rng for testing.
// keep in sync with 042_casino_chicken.sql
export const LANE_MULTIPLIERS = [1.3, 2.0, 3.2, 4.8, 7.2, 11.0, 18.0]
export const SAFE_PROBS       = [0.72, 0.64, 0.56, 0.48, 0.40, 0.32, 0.25]

// Pre-roll all 7 lane outcomes: lane i is safe iff rng() < SAFE_PROBS[i].
export function preRollLanes(rng = Math.random) {
  return SAFE_PROBS.map((p) => rng() < p)
}

// Total credited on cashing out after crossing `lane` lanes (1-based).
// bet + floor(bet * (multiplier - 1)) = original stake + net winnings.
export function chickenPayout(bet, lane) {
  return bet + Math.floor(bet * (LANE_MULTIPLIERS[lane - 1] - 1))
}
