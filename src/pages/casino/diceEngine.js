// Pure dice resolution. Mirrors current DiceGame.jsx math (guess 1-6, 5x total return).
// keep in sync with 039_casino_play_singleshot.sql
export function resolveDice({ bet, guess, rng = Math.random }) {
  const roll = Math.floor(rng() * 6) + 1
  const win = roll === guess
  return { roll, win, delta: win ? bet * 4 : -bet }
}
