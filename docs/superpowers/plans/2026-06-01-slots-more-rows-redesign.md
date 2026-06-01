# Slots Redesign (more rows, house-positive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the OP 3-reel/1-line Slots game with a 5-reel × 3-row, 5-payline machine whose math is house-positive (~93% RTP), keeping the existing amber aesthetic and shared UI.

**Architecture:** All slot math moves into a new pure, injectable-`rng` module `src/pages/casino/slotsEngine.js` (mirrors `aviamastersEngine.js`), covered by a `node:test` suite and a `scripts/slots-sim.mjs` Monte-Carlo tuner. `SlotsGame.jsx` is rewritten to render the 5×3 grid against that engine and to feed the **net** change to the unchanged `placeBet`.

**Tech Stack:** React 18 (hooks), Vite, Tailwind (`cp-*` palette + `amber-*`), `node:test`.

**Decisions locked (were spec open questions):** keep the push tier (🍒/🍋 ×3 returns the bet); 💎 5-of-a-kind jackpot stays at 300×.

**Spec:** `docs/superpowers/specs/2026-06-01-slots-more-rows-redesign-design.md`

---

## File structure

- **Create** `src/pages/casino/slotsEngine.js` — pure constants + `drawSymbol`, `spinGrid`, `evaluateGrid`, `netForBet`, `theoreticalRTP`. No React/DOM.
- **Create** `src/pages/casino/slotsEngine.test.js` — `node:test` suite for evaluation, net mapping, RTP band.
- **Create** `scripts/slots-sim.mjs` — Monte-Carlo report (RTP / hit / win / push / loss).
- **Rewrite** `src/pages/casino/SlotsGame.jsx` — 5×3 grid UI against the engine.
- No other files change. `CasinoContext.placeBet`, `shared.jsx`, `CasinoPage.jsx` registration stay as-is.

---

### Task 1: Slots engine (pure module) + tests

**Files:**
- Create: `src/pages/casino/slotsEngine.js`
- Test: `src/pages/casino/slotsEngine.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/pages/casino/slotsEngine.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SYMBOLS, REELS, ROWS, PAYLINES,
  drawSymbol, spinGrid, evaluateGrid, netForBet, theoreticalRTP,
} from './slotsEngine.js'

const CHERRY = 0, LEMON = 1, SEVEN = 2, STAR = 3, DIAMOND = 4
const gridOf = (rows) => rows.map((r) => [...r])

test('drawSymbol returns first symbol when rng is 0', () => {
  assert.equal(drawSymbol(() => 0), CHERRY)
})

test('drawSymbol lands in the correct weight bucket', () => {
  // cumulative weights (sum 20): cherry[0,6) lemon[6,12) seven[12,16) star[16,19) diamond[19,20)
  assert.equal(drawSymbol(() => 6 / 20), LEMON)
  assert.equal(drawSymbol(() => 19.5 / 20), DIAMOND)
})

test('spinGrid has ROWS×REELS valid symbol indices', () => {
  const grid = spinGrid(Math.random)
  assert.equal(grid.length, ROWS)
  for (const row of grid) {
    assert.equal(row.length, REELS)
    for (const s of row) assert.ok(s >= 0 && s < SYMBOLS.length)
  }
})

test('no win when nothing makes a 3-from-left run', () => {
  const { totalReturn, lines } = evaluateGrid(gridOf([
    [CHERRY, LEMON, CHERRY, LEMON, CHERRY],
    [LEMON, CHERRY, LEMON, CHERRY, LEMON],
    [SEVEN, STAR, SEVEN, STAR, SEVEN],
  ]))
  assert.equal(totalReturn, 0)
  assert.equal(lines.length, 0)
})

test('3-from-left seven on the middle row pays 3x', () => {
  const { totalReturn, lines } = evaluateGrid(gridOf([
    [CHERRY, LEMON, CHERRY, LEMON, DIAMOND],
    [SEVEN, SEVEN, SEVEN, CHERRY, LEMON],
    [STAR, CHERRY, STAR, CHERRY, STAR],
  ]))
  assert.equal(totalReturn, 3)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].lineIndex, 1)
  assert.equal(lines[0].symbol, SEVEN)
  assert.equal(lines[0].runLength, 3)
  assert.equal(lines[0].multiplier, 3)
  assert.deepEqual(lines[0].cells, [[1, 0], [1, 1], [1, 2]])
})

test('a 2-from-left run does not count', () => {
  const { totalReturn, lines } = evaluateGrid(gridOf([
    [STAR, STAR, CHERRY, STAR, STAR],
    [CHERRY, LEMON, SEVEN, STAR, DIAMOND],
    [LEMON, CHERRY, LEMON, CHERRY, LEMON],
  ]))
  assert.equal(totalReturn, 0)
  assert.equal(lines.length, 0)
})

test('5-of-a-kind diamond pays the 300x jackpot', () => {
  const { totalReturn, lines } = evaluateGrid(gridOf([
    [DIAMOND, DIAMOND, DIAMOND, DIAMOND, DIAMOND],
    [CHERRY, LEMON, SEVEN, STAR, CHERRY],
    [LEMON, CHERRY, LEMON, CHERRY, LEMON],
  ]))
  assert.equal(totalReturn, 300)
  assert.equal(lines[0].runLength, 5)
  assert.deepEqual(lines[0].cells, [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]])
})

test('winnings stack across multiple lines', () => {
  // top: 3 stars (5x) + middle: 3 sevens (3x) = 8x
  const { totalReturn, lines } = evaluateGrid(gridOf([
    [STAR, STAR, STAR, LEMON, CHERRY],
    [SEVEN, SEVEN, SEVEN, CHERRY, LEMON],
    [CHERRY, LEMON, CHERRY, LEMON, CHERRY],
  ]))
  assert.equal(lines.length, 2)
  assert.equal(totalReturn, 8)
})

test('the V diagonal line is evaluated', () => {
  // V path (0,0)(1,1)(2,2)(1,3)(0,4): 3 sevens on the first three cells
  const { lines } = evaluateGrid(gridOf([
    [SEVEN, CHERRY, LEMON, STAR, DIAMOND],
    [LEMON, SEVEN, CHERRY, LEMON, STAR],
    [CHERRY, LEMON, SEVEN, CHERRY, LEMON],
  ]))
  const v = lines.find((l) => l.lineIndex === 3)
  assert.ok(v, 'V diagonal should win')
  assert.equal(v.symbol, SEVEN)
  assert.equal(v.runLength, 3)
})

test('netForBet maps totalReturn to loss / push / win', () => {
  assert.equal(netForBet(0, 100), -100) // loss
  assert.equal(netForBet(1, 100), 0)    // push
  assert.equal(netForBet(3, 100), 200)  // 3x return -> +2x net
})

test('theoreticalRTP is house-positive and in the 92-94% band', () => {
  const rtp = theoreticalRTP()
  assert.ok(rtp > 0.92 && rtp < 0.94, `RTP ${rtp} out of band`)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/pages/casino/slotsEngine.test.js`
Expected: FAIL — `Cannot find module './slotsEngine.js'`.

- [ ] **Step 3: Write the engine**

Create `src/pages/casino/slotsEngine.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/pages/casino/slotsEngine.test.js`
Expected: PASS — all tests, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/casino/slotsEngine.js src/pages/casino/slotsEngine.test.js
git commit -m "$(cat <<'EOF'
feat(casino): add pure slots engine (5x3, 5 paylines, ~93% RTP)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Monte-Carlo sim script

**Files:**
- Create: `scripts/slots-sim.mjs`

- [ ] **Step 1: Write the script**

Create `scripts/slots-sim.mjs`:

```js
// Monte-Carlo RTP / hit-rate report for the slots engine.
// Run: node scripts/slots-sim.mjs [spins]   (default 5,000,000)
import {
  spinGrid, evaluateGrid, netForBet, theoreticalRTP, PAYLINES,
} from '../src/pages/casino/slotsEngine.js'

const N = Number(process.argv[2] || 5_000_000)
let sumReturn = 0, win = 0, push = 0, loss = 0, maxReturn = 0

for (let n = 0; n < N; n++) {
  const { totalReturn } = evaluateGrid(spinGrid())
  sumReturn += totalReturn
  if (totalReturn > maxReturn) maxReturn = totalReturn
  const net = netForBet(totalReturn, 1)
  if (net > 0) win++
  else if (net === 0) push++
  else loss++
}

const pct = (x) => (x / N * 100).toFixed(2) + '%'
console.log(`spins               ${N.toLocaleString()}`)
console.log(`paylines            ${PAYLINES.length}`)
console.log(`RTP (closed-form)   ${(theoreticalRTP() * 100).toFixed(2)}%`)
console.log(`RTP (monte-carlo)   ${(sumReturn / N * 100).toFixed(2)}%`)
console.log(`house edge          ${((1 - sumReturn / N) * 100).toFixed(2)}%`)
console.log(`hit rate (win+push) ${pct(win + push)}`)
console.log(`  net-positive win  ${pct(win)}`)
console.log(`  push (bet back)   ${pct(push)}`)
console.log(`  loss              ${pct(loss)}`)
console.log(`largest return seen ${maxReturn}x`)
```

- [ ] **Step 2: Run it**

Run: `node scripts/slots-sim.mjs 2000000`
Expected: RTP closed-form ≈ **93.08%**, monte-carlo within ±0.2%, house edge ≈ 6.9%,
net-positive win ≈ 14–15%, push ≈ 14%, loss ≈ 71–72%.

- [ ] **Step 3: Commit**

```bash
git add scripts/slots-sim.mjs
git commit -m "$(cat <<'EOF'
chore(casino): add slots Monte-Carlo RTP sim script

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Rewrite SlotsGame.jsx (5×3 grid UI)

**Files:**
- Modify (full rewrite): `src/pages/casino/SlotsGame.jsx`

- [ ] **Step 1: Replace the file contents**

Overwrite `src/pages/casino/SlotsGame.jsx` with:

```jsx
import { useState, useEffect, useRef } from 'react'
import { GameLayout, BetChips, ResultBanner } from './shared'
import { useCasino } from '../../context/CasinoContext'
import {
  SYMBOLS, PAYTABLE, REELS, ROWS,
  drawSymbol, spinGrid, evaluateGrid, netForBet,
} from './slotsEngine'

// Per-column stop times (ms), left → right.
const STOP_TIMES = [1000, 1300, 1600, 1900, 2200]

const cellKey = (r, c) => `${r}-${c}`

// A calm, non-winning starting grid.
function initialGrid() {
  return Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: REELS }, (_, c) => (r + c) % SYMBOLS.length)
  )
}

function describe(lines, totalReturn) {
  if (lines.length === 0) return 'No win'
  if (totalReturn === 1) return 'Push — 3 of a kind, bet returned'
  if (lines.length === 1) {
    const l = lines[0]
    return `${SYMBOLS[l.symbol]} ×${l.runLength} — ${l.multiplier}× line`
  }
  return `${lines.length} winning lines · ${totalReturn}× total`
}

function Cell({ symbolIdx, spinning, highlight }) {
  return (
    <div
      className="flex items-center justify-center border bg-cp-bg rounded-lg overflow-hidden"
      style={{
        height: 56,
        borderColor: highlight ? 'rgba(52,211,153,0.7)' : 'rgba(251,191,36,0.2)',
        boxShadow: highlight
          ? '0 0 14px rgba(52,211,153,0.55) inset, 0 0 8px rgba(52,211,153,0.5)'
          : spinning
            ? '0 0 10px rgba(251,191,36,0.2) inset'
            : '0 0 6px rgba(0,0,0,0.4) inset',
        transition: 'box-shadow 0.25s, border-color 0.25s',
      }}
    >
      <span
        style={{
          fontSize: 32,
          lineHeight: 1,
          display: 'block',
          animation: spinning ? 'slotReelBlur 0.08s linear infinite' : 'none',
          filter: spinning ? 'blur(1px)' : 'none',
          transition: spinning ? 'none' : 'filter 0.2s',
          userSelect: 'none',
        }}
      >
        {SYMBOLS[symbolIdx]}
      </span>
    </div>
  )
}

export default function SlotsGame() {
  const { balance, placeBet } = useCasino()

  const [grid, setGrid] = useState(initialGrid)
  const [spinningCols, setSpinningCols] = useState(Array(REELS).fill(false))
  const [phase, setPhase] = useState('idle') // 'idle' | 'spinning' | 'result'
  const [bet, setBet] = useState(50)
  const [gameResult, setGameResult] = useState(null) // 'win' | 'loss' | 'push' | null
  const [resultAmount, setResultAmount] = useState(0)
  const [resultLabel, setResultLabel] = useState('')
  const [winCells, setWinCells] = useState(() => new Set())

  const intervalRefs = useRef(Array(REELS).fill(null))
  const timeoutRefs = useRef([])

  // Inject the reel-blur keyframes once.
  useEffect(() => {
    const id = 'slots-reel-keyframes'
    if (!document.getElementById(id)) {
      const style = document.createElement('style')
      style.id = id
      style.textContent =
        '@keyframes slotReelBlur {0%{transform:translateY(-5px)}50%{transform:translateY(5px)}100%{transform:translateY(-5px)}}'
      document.head.appendChild(style)
    }
  }, [])

  // Cleanup on unmount.
  useEffect(() => () => {
    intervalRefs.current.forEach((id) => id && clearInterval(id))
    timeoutRefs.current.forEach((id) => clearTimeout(id))
  }, [])

  function resolveSpin(finalGrid) {
    const { totalReturn, lines } = evaluateGrid(finalGrid)
    const net = netForBet(totalReturn, bet)
    const result = totalReturn === 0 ? 'loss' : totalReturn === 1 ? 'push' : 'win'

    const cells = new Set()
    lines.forEach((l) => l.cells.forEach(([r, c]) => cells.add(cellKey(r, c))))
    setWinCells(cells)

    setGameResult(result)
    setResultAmount(result === 'loss' ? bet : net)
    setResultLabel(describe(lines, totalReturn))
    setPhase('result')
    placeBet('slots', bet, net)
  }

  function handleSpin() {
    if (phase === 'spinning') return

    setPhase('spinning')
    setGameResult(null)
    setResultAmount(0)
    setResultLabel('')
    setWinCells(new Set())

    const finalGrid = spinGrid()
    setSpinningCols(Array(REELS).fill(true))

    // Each column cycles its 3 cells with random symbols.
    for (let col = 0; col < REELS; col++) {
      intervalRefs.current[col] = setInterval(() => {
        setGrid((prev) => {
          const next = prev.map((row) => [...row])
          for (let r = 0; r < ROWS; r++) next[r][col] = drawSymbol()
          return next
        })
      }, 80)
    }

    // Stop columns left → right, then resolve after the last one.
    STOP_TIMES.forEach((stopTime, col) => {
      const t = setTimeout(() => {
        clearInterval(intervalRefs.current[col])
        intervalRefs.current[col] = null
        setGrid((prev) => {
          const next = prev.map((row) => [...row])
          for (let r = 0; r < ROWS; r++) next[r][col] = finalGrid[r][col]
          return next
        })
        setSpinningCols((prev) => {
          const next = [...prev]
          next[col] = false
          return next
        })
        if (col === REELS - 1) {
          const t2 = setTimeout(() => resolveSpin(finalGrid), 250)
          timeoutRefs.current.push(t2)
        }
      }, stopTime)
      timeoutRefs.current.push(t)
    })
  }

  function handleNewGame() {
    setPhase('idle')
    setGameResult(null)
    setResultAmount(0)
    setResultLabel('')
    setWinCells(new Set())
  }

  const isSpinning = phase === 'spinning'

  return (
    <GameLayout title="Slots">
      <div className="flex flex-col items-center gap-8">

        {/* ── Slot machine frame ── */}
        <div
          className="w-full max-w-xl rounded-2xl border-2 border-amber-400/30 bg-cp-card p-5"
          style={{
            boxShadow: isSpinning
              ? '0 0 40px rgba(251,191,36,0.25), 0 0 80px rgba(251,191,36,0.1)'
              : '0 0 20px rgba(0,0,0,0.4)',
            transition: 'box-shadow 0.4s',
          }}
        >
          {/* Machine top decoration */}
          <div className="flex items-center justify-center mb-4 gap-2">
            <div className="h-px flex-1 bg-amber-400/20" />
            <span className="text-amber-400 text-xs font-bold tracking-[0.2em] uppercase">CP Slots</span>
            <div className="h-px flex-1 bg-amber-400/20" />
          </div>

          {/* 5 reels × 3 rows */}
          <div className="flex gap-2">
            {Array.from({ length: REELS }, (_, col) => (
              <div key={col} className="flex-1 flex flex-col gap-2">
                {Array.from({ length: ROWS }, (_, row) => (
                  <Cell
                    key={row}
                    symbolIdx={grid[row][col]}
                    spinning={spinningCols[col]}
                    highlight={winCells.has(cellKey(row, col))}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* Payline hint */}
          <div className="flex items-center justify-center mt-4 gap-2">
            <div className="h-px flex-1 bg-amber-400/15" />
            <span className="text-cp-muted text-xs">5 PAYLINES · 3+ FROM LEFT</span>
            <div className="h-px flex-1 bg-amber-400/15" />
          </div>
        </div>

        {/* ── Paytable ── */}
        <div className="w-full max-w-xl bg-cp-card border border-cp-border rounded-2xl p-4">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs text-cp-muted font-semibold uppercase tracking-wider">Paytable</p>
            <p className="text-xs text-cp-muted">×&nbsp;your bet · wins stack</p>
          </div>
          <div className="grid grid-cols-4 gap-x-2 gap-y-1 text-xs">
            <span className="text-cp-muted/70 font-semibold">Symbol</span>
            <span className="text-cp-muted/70 font-semibold text-right">3×</span>
            <span className="text-cp-muted/70 font-semibold text-right">4×</span>
            <span className="text-cp-muted/70 font-semibold text-right">5×</span>
            {SYMBOLS.map((sym, i) => (
              <Row key={i} sym={sym} pay={PAYTABLE[i]} />
            ))}
          </div>
          <p className="mt-3 pt-3 border-t border-cp-border text-xs text-cp-muted">
            3 🍒/🍋 returns your bet (push). 💎 is the rarest — biggest payouts.
          </p>
        </div>

        {/* ── Bet chips ── */}
        <div className="w-full max-w-xl bg-cp-card border border-cp-border rounded-2xl p-4">
          <BetChips bet={bet} onBet={setBet} balance={balance ?? 0} disabled={isSpinning} />
        </div>

        {/* ── Spin / Play Again ── */}
        {phase !== 'result' ? (
          <button
            onClick={handleSpin}
            disabled={!bet || isSpinning || (balance ?? 0) < bet}
            className={`w-full max-w-xl py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
              ${(!bet || isSpinning || (balance ?? 0) < bet)
                ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                : 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_24px_rgba(251,191,36,0.3)] hover:shadow-[0_0_32px_rgba(251,191,36,0.45)] active:scale-95'
              }
            `}
          >
            {isSpinning ? 'Spinning…' : 'Spin!'}
          </button>
        ) : (
          <button
            onClick={handleNewGame}
            className="w-full max-w-xl py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95"
          >
            Spin Again
          </button>
        )}

        {/* ── Result banner ── */}
        <div className="w-full max-w-xl">
          <ResultBanner result={gameResult} amount={resultAmount} message={resultLabel || null} />
        </div>

      </div>
    </GameLayout>
  )
}

function Row({ sym, pay }) {
  return (
    <>
      <span className="text-cp-text">{sym}</span>
      <span className="text-amber-400 text-right">{pay[3]}×</span>
      <span className="text-amber-400 text-right">{pay[4]}×</span>
      <span className="text-amber-400 text-right">{pay[5]}×</span>
    </>
  )
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds, no errors referencing `SlotsGame` or `slotsEngine`.

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`, open the Casino → Slots. Verify: 5 columns × 3 rows render; pressing
Spin cycles all columns and they stop left → right; winning lines glow green; the balance
changes by the expected net (loss = −bet, push = 0 with "bet returned", win = profit); the
paytable reads correctly; layout holds on a narrow window.

- [ ] **Step 4: Commit**

```bash
git add src/pages/casino/SlotsGame.jsx
git commit -m "$(cat <<'EOF'
feat(casino): rewrite Slots as 5x3 / 5-payline machine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Final verification

- [ ] **Step 1: Full engine test run**

Run: `node --test src/pages/casino/slotsEngine.test.js`
Expected: PASS, `fail 0`.

- [ ] **Step 2: Confirm RTP via sim**

Run: `node scripts/slots-sim.mjs 3000000`
Expected: closed-form RTP 93.08%, monte-carlo within ±0.2%, house edge ~6.9%.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Confirm no stray references**

Run: `grep -rn "calcPayout\|weightedRandom" src/pages/casino/`
Expected: no matches (the old 3-reel helpers are gone).

---

## Self-review notes

- **Spec coverage:** grid model (Task 1 constants), 5 paylines + 3-from-left + stacking
  (Task 1 `evaluateGrid` + tests), paytable & weights (Task 1 constants), net/push/loss →
  `placeBet` (Task 1 `netForBet`, Task 3 `resolveSpin`), engine module + test + sim
  (Tasks 1–2), UI rewrite with grid/animation/highlight/paytable (Task 3), RTP/hit
  verification (Tasks 2 & 4). All spec sections map to a task.
- **No placeholders:** every code step is complete and runnable.
- **Type consistency:** `evaluateGrid` returns `{ totalReturn, lines:[{lineIndex, symbol,
  runLength, multiplier, cells}] }`; consumed identically in `SlotsGame.resolveSpin`.
  `netForBet(totalReturn, bet)` signature matches both the engine test and the component.
  `drawSymbol`/`spinGrid`/`SYMBOLS`/`PAYTABLE`/`REELS`/`ROWS` names match across files.
