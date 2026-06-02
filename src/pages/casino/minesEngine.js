// ── Mines engine ──────────────────────────────────────────────────────────────
// Pure, dependency-free mines math. No React, no DOM. The same code runs in the
// browser component (MinesGame.jsx) and is the source of truth the SQL is
// translated from. All randomness comes through an injectable `rng` (default
// Math.random) so the unit tests are deterministic / reproducible.
//
// keep in sync with 041_casino_mines.sql

// Multiplier formula (5% house edge). Mirrors getMult() in MinesGame.jsx exactly:
//   m = Π_{i<revealed} (25-i)/(25-mines-i); return +Math.max(1.01, m*0.95).toFixed(2)
// `revealed` = number of safe tiles uncovered so far; 0 revealed → no payout yet → 1.
export function minesMult(revealed, mines) {
  if (revealed === 0) return 1
  let m = 1.0
  for (let i = 0; i < revealed; i++) {
    m *= (25 - i) / (25 - mines - i)
  }
  // Floor at 1.01 so even 1-mine games always show a positive multiplier.
  return +Math.max(1.01, m * 0.95).toFixed(2)
}

// Pick `count` DISTINCT mine cell indices in 0..24. Same observable result as
// buildGrid() in MinesGame.jsx (N distinct mine positions), but uses a partial
// Fisher–Yates draw instead of rejection sampling so it always terminates for
// any rng — including a constant one — and so the SQL (_mines_pick) can mirror
// it without a redraw loop.
export function buildMines(count, rng = Math.random) {
  const deck = Array.from({ length: 25 }, (_, i) => i)
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (25 - i))
    const t = deck[i]
    deck[i] = deck[j]
    deck[j] = t
  }
  return deck.slice(0, count)
}
