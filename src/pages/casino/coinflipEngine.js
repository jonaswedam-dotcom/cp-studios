// keep in sync with 039_casino_play_singleshot.sql ; mirrors CoinFlipGame.jsx
export function resolveCoinFlip({ bet, choice, rng = Math.random }) {
  const result = rng() > 0.5 ? 'heads' : 'tails'
  const win = result === choice
  return { result, win, delta: win ? Math.floor(bet * 0.95) : -bet }
}
