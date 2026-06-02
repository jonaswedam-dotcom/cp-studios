// Pure roulette resolution. Ports calcWin + red-number set from RouletteGame.jsx exactly.
// keep in sync with 039_casino_play_singleshot.sql
export const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36])

function getNumberColor(n) {
  if (n === 0) return 'green'
  return RED_NUMBERS.has(n) ? 'red' : 'black'
}

export function resolveRoulette({ bet, kind, number, rng = Math.random }) {
  const result = Math.floor(rng() * 37) // 0-36
  const color = getNumberColor(result)

  let win
  if (kind === 'number') win = number === result
  else if (kind === 'red') win = color === 'red'
  else if (kind === 'black') win = color === 'black'
  else if (kind === 'odd') win = result !== 0 && result % 2 !== 0
  else if (kind === 'even') win = result !== 0 && result % 2 === 0
  else win = false

  let delta
  if (!win) delta = -bet
  else delta = kind === 'number' ? bet * 35 : bet

  return { result, win, delta }
}
