// ── Slots engine ───────────────────────────────────────────────────────────────
// Pure, dependency-free slot math. No React, no DOM. The same code runs in the
// browser component (SlotsGame.jsx) and in scripts/slots-sim.mjs (RTP tuning).
// All randomness comes through an injectable `rng` (default Math.random) so the
// unit tests and the simulation are deterministic / reproducible.

export const SYMBOLS = ['🍒', '🍋', '7️⃣', '⭐', '💎']
export const WEIGHTS = [6, 6, 4, 3, 1] // sum = 20
const WEIGHT_TOTAL = WEIGHTS.reduce((a, b) => a + b, 0)

export const REELS = 5
export const ROWS = 3

// 5 paylines as [row, col] paths across the reels: 3 rows + 2 diagonals.
export const PAYLINES = [
  [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], // top row
  [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]], // middle row
  [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]], // bottom row
  [[0, 0], [1, 1], [2, 2], [1, 3], [0, 4]], // V
  [[2, 0], [1, 1], [0, 2], [1, 3], [2, 4]], // Λ
]

// Total-return multiplier per symbol index, keyed by run length (3, 4, 5).
// "Total return" = multiple of the total bet, stake included (same convention as
// the old game's "10×"). Net wallet change for a spin = (totalReturn - 1) * bet.
export const PAYTABLE = [
  { 3: 1, 4: 3, 5: 10 },    // 🍒 cherry
  { 3: 1, 4: 3, 5: 10 },    // 🍋 lemon
  { 3: 3, 4: 8, 5: 25 },    // 7️⃣ seven
  { 3: 5, 4: 15, 5: 60 },   // ⭐ star
  { 3: 20, 4: 80, 5: 300 }, // 💎 diamond
]

// Pick a symbol INDEX using one rng() draw against WEIGHTS.
export function drawSymbol(rng = Math.random) {
  let r = rng() * WEIGHT_TOTAL
  for (let i = 0; i < WEIGHTS.length; i++) {
    r -= WEIGHTS[i]
    if (r < 0) return i
  }
  return WEIGHTS.length - 1
}

// Build a ROWS×REELS grid of symbol indices, one independent draw per cell.
export function spinGrid(rng = Math.random) {
  const grid = []
  for (let row = 0; row < ROWS; row++) {
    grid[row] = []
    for (let col = 0; col < REELS; col++) grid[row][col] = drawSymbol(rng)
  }
  return grid
}

// Evaluate every payline. A line pays when its leftmost symbol repeats on 3+
// consecutive cells from the left. Winnings stack across lines.
export function evaluateGrid(grid) {
  const lines = []
  let totalReturn = 0
  PAYLINES.forEach((path, lineIndex) => {
    const symbol = grid[path[0][0]][path[0][1]]
    let runLength = 1
    for (let i = 1; i < path.length; i++) {
      const [r, c] = path[i]
      if (grid[r][c] === symbol) runLength++
      else break
    }
    if (runLength >= 3) {
      const multiplier = PAYTABLE[symbol][runLength]
      totalReturn += multiplier
      lines.push({ lineIndex, symbol, runLength, multiplier, cells: path.slice(0, runLength) })
    }
  })
  return { totalReturn, lines }
}

// Net wallet change for a spin: totalReturn 0 → -bet (loss); 1 → 0 (push); ≥2 → profit.
export function netForBet(totalReturn, bet) {
  return (totalReturn - 1) * bet
}

// Closed-form RTP from the constants (expected total return per unit bet).
// Each payline is 5 i.i.d. cells, so E[return] = PAYLINES.length * E[one line].
// P(leftmost symbol s, run exactly k): k=3 → p^3(1-p); k=4 → p^4(1-p); k=5 → p^5.
export function theoreticalRTP() {
  const p = WEIGHTS.map((w) => w / WEIGHT_TOTAL)
  let perLine = 0
  for (let s = 0; s < SYMBOLS.length; s++) {
    const ps = p[s]
    perLine += ps ** 3 * (1 - ps) * PAYTABLE[s][3]
    perLine += ps ** 4 * (1 - ps) * PAYTABLE[s][4]
    perLine += ps ** 5 * PAYTABLE[s][5]
  }
  return PAYLINES.length * perLine
}
