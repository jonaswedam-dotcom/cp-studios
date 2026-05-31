# Aviamasters Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a faithful, client-only "Aviamasters" crash game to the CP Studios casino: a plane auto-flies a randomized path collecting multiply/add nodes while rockets halve the multiplier, then lands (win `bet × mult`, capped ×250) or splashes (lose), at ~97% RTP.

**Architecture:** A pure, dependency-free engine module (`aviamastersEngine.js`) generates each round deterministically from an injectable RNG; it is unit-tested with Node's built-in test runner and reused by a Monte-Carlo simulation script that tunes the RTP constant. A React component (`AviamastersGame.jsx`), modeled on the existing `AviatorGame.jsx`, animates the pre-rolled round and settles the wallet via the existing `CasinoContext.placeBet`. New route + catalogue card wire it in. No DB, RLS, or migration changes.

**Tech Stack:** Vite + React, Tailwind (`cp` palette), Node 24 built-in test runner (`node --test`), `useCasino().placeBet`. Project is `"type": "module"`, so `.js` files are ESM in both Vite and Node.

---

## File Structure

- **Create** `src/pages/casino/aviamastersEngine.js` — pure round generation: constants (node tables, rocket chance, node-count table, `P_LAND`, `MAX_MULT`, `SPEEDS`), a `pickWeighted` helper, and `generateRound(rng)`. No React, no DOM. Default RNG `Math.random`, injectable for tests/sim.
- **Create** `src/pages/casino/aviamastersEngine.test.js` — `node --test` unit tests for the engine.
- **Create** `scripts/aviamasters-sim.mjs` — Monte-Carlo over `generateRound`; prints `E[min(mult,250)]`, recommended `P_LAND`, measured RTP, win rate, max mult.
- **Create** `src/pages/casino/AviamastersGame.jsx` — React component; animates a pre-rolled round, settles via `placeBet('aviamasters', …)`.
- **Modify** `src/App.jsx` — import the component and add the `/casino/aviamasters` route.
- **Modify** `src/pages/CasinoPage.jsx` — add an Aviamasters card to the `GAMES` array.

The engine is deliberately separated from the component so the math is testable in isolation and shared verbatim with the simulation (DRY). The component holds only animation/UI state.

---

## Task 1: Engine constants, weighted picker, and `generateRound`

**Files:**
- Create: `src/pages/casino/aviamastersEngine.js`
- Test: `src/pages/casino/aviamastersEngine.test.js`

The engine generates a round as an ordered list of `events`. Each of `nodeCount` slots is independently either a **rocket** (÷2) with probability `ROCKET_CHANCE`, or a **value node** that is multiplicative (prob `MULT_NODE_SHARE`) or additive. Coupling rockets to per-slot probability makes longer flights naturally hit more rockets (rocket count ≈ Binomial(nodeCount, ROCKET_CHANCE)). The final multiplier is computed by applying events in order, clamped to `MAX_MULT`. The land/splash outcome is an independent Bernoulli draw with probability `P_LAND`.

- [ ] **Step 1: Write the failing test**

Create `src/pages/casino/aviamastersEngine.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  pickWeighted,
  generateRound,
  MAX_MULT,
  START_MULT,
} from './aviamastersEngine.js'

// Deterministic RNG that replays a fixed queue of values, then 0.
function seq(values) {
  let i = 0
  return () => (i < values.length ? values[i++] : 0)
}

test('pickWeighted returns first value when rng is 0', () => {
  const table = [{ value: 'a', weight: 1 }, { value: 'b', weight: 3 }]
  assert.equal(pickWeighted(table, () => 0), 'a')
})

test('pickWeighted lands in the correct weight bucket', () => {
  const table = [{ value: 'a', weight: 1 }, { value: 'b', weight: 3 }]
  // total weight 4; rng 0.5 -> 2.0 into the line -> past 'a' (1), into 'b'
  assert.equal(pickWeighted(table, () => 0.5), 'b')
})

test('generateRound returns a well-formed round', () => {
  const r = generateRound(Math.random)
  assert.ok(Array.isArray(r.events))
  assert.ok(r.events.length >= 1)
  assert.ok(['land', 'splash'].includes(r.outcome))
  assert.ok(typeof r.finalMult === 'number')
  assert.ok(r.finalMult <= MAX_MULT)
  for (const e of r.events) {
    assert.ok(['mult', 'add', 'rocket'].includes(e.kind))
    assert.ok(typeof e.value === 'number')
    assert.ok(typeof e.multAfter === 'number')
  }
})

test('finalMult never exceeds MAX_MULT even on a huge run', () => {
  // Force: max node count, every slot a value node (no rocket), every node the
  // richest multiplicative value, and a land outcome.
  // Slot loop per node calls rng() in this order:
  //   1) rocket roll (want > ROCKET_CHANCE -> 0.99 = no rocket)
  //   2) mult-vs-add roll (want < MULT_NODE_SHARE -> 0 = multiplicative)
  //   3) pickWeighted over MULT_NODES (want last/richest -> 0.999)
  // nodeCount roll first (want richest count -> 0.999), outcome last (0 -> land)
  const rng = seq([
    0.999,                                  // node count -> max
    ...Array(40).fill(0).flatMap(() => [0.99, 0, 0.999]), // 10 slots * 3 rolls (extra ok)
    0,                                      // outcome -> land
  ])
  const r = generateRound(rng)
  assert.ok(r.finalMult <= MAX_MULT, `finalMult ${r.finalMult} > ${MAX_MULT}`)
})

test('a rocket halves the running multiplier', () => {
  // 1 node, force it to be a rocket: nodeCount roll -> small (1 node),
  // slot rocket roll -> 0 (< ROCKET_CHANCE = rocket), outcome -> land.
  const rng = seq([
    0,    // node count -> minimum (1)
    0,    // slot 1 rocket roll -> rocket
    0,    // outcome -> land
  ])
  const r = generateRound(rng)
  assert.equal(r.events.length, 1)
  assert.equal(r.events[0].kind, 'rocket')
  assert.equal(r.events[0].multAfter, START_MULT / 2)
  assert.equal(r.finalMult, START_MULT / 2)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/pages/casino/aviamastersEngine.test.js`
Expected: FAIL — `Cannot find module './aviamastersEngine.js'` (file not created yet).

- [ ] **Step 3: Write the engine**

Create `src/pages/casino/aviamastersEngine.js`:

```js
// ── Aviamasters engine ─────────────────────────────────────────────────────────
// Pure, dependency-free round generation. No React, no DOM. The same code runs
// in the browser component and in scripts/aviamasters-sim.mjs (RTP tuning).
// All randomness comes through an injectable `rng` (default Math.random) so the
// unit tests and the simulation are deterministic / reproducible.

export const START_MULT = 1.0
export const MAX_MULT   = 250

// How many collectible slots a flight has (weighted).
export const NODE_COUNT = [
  { value: 1,  weight: 2  },
  { value: 2,  weight: 5  },
  { value: 3,  weight: 12 },
  { value: 4,  weight: 18 },
  { value: 5,  weight: 22 },
  { value: 6,  weight: 18 },
  { value: 7,  weight: 12 },
  { value: 8,  weight: 6  },
  { value: 9,  weight: 3  },
  { value: 10, weight: 2  },
]

// Per-slot probability a slot is a rocket (÷2) instead of a value node.
// Couples rocket count to flight length: count ≈ Binomial(nodeCount, ROCKET_CHANCE).
export const ROCKET_CHANCE = 0.18

// Given a value node, probability it is multiplicative (vs additive).
export const MULT_NODE_SHARE = 0.5

// Multiplicative node faces (×N) and their relative weights.
export const MULT_NODES = [
  { value: 2, weight: 50 },
  { value: 3, weight: 28 },
  { value: 4, weight: 15 },
  { value: 5, weight: 7  },
]

// Additive node faces (+N) and their relative weights.
export const ADD_NODES = [
  { value: 1,  weight: 45 },
  { value: 2,  weight: 30 },
  { value: 5,  weight: 18 },
  { value: 10, weight: 7  },
]

// Probability the plane lands (wins) vs splashes (loses). Independent of the
// multiplier. TUNED IN TASK 2 so simulated RTP ≈ 0.97. Placeholder until then.
export const P_LAND = 0.5

// Animation tick interval (ms per event) per speed setting. UI-only; no effect
// on odds or payouts.
export const SPEEDS = {
  tortoise:  1100,
  walking:   700,
  hare:      400,
  lightning: 180,
}

// Pick a value from a [{ value, weight }] table using one rng() draw.
export function pickWeighted(table, rng) {
  const total = table.reduce((sum, e) => sum + e.weight, 0)
  let r = rng() * total
  for (const e of table) {
    r -= e.weight
    if (r < 0) return e.value
  }
  return table[table.length - 1].value
}

// Generate one full round up-front. Returns the ordered events (for animation),
// the final clamped multiplier, and the land/splash outcome.
export function generateRound(rng = Math.random) {
  const nodeCount = pickWeighted(NODE_COUNT, rng)

  let mult = START_MULT
  const events = []

  for (let i = 0; i < nodeCount; i++) {
    if (rng() < ROCKET_CHANCE) {
      mult = mult / 2
      events.push({ kind: 'rocket', value: 2, multAfter: round2(mult) })
      continue
    }
    if (rng() < MULT_NODE_SHARE) {
      const value = pickWeighted(MULT_NODES, rng)
      mult = Math.min(MAX_MULT, mult * value)
      events.push({ kind: 'mult', value, multAfter: round2(mult) })
    } else {
      const value = pickWeighted(ADD_NODES, rng)
      mult = Math.min(MAX_MULT, mult + value)
      events.push({ kind: 'add', value, multAfter: round2(mult) })
    }
  }

  const finalMult = round2(Math.min(MAX_MULT, mult))
  const outcome = rng() < P_LAND ? 'land' : 'splash'
  return { events, finalMult, outcome }
}

function round2(n) {
  return Math.round(n * 100) / 100
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/pages/casino/aviamastersEngine.test.js`
Expected: PASS — 5 tests passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add src/pages/casino/aviamastersEngine.js src/pages/casino/aviamastersEngine.test.js
git commit -m "Add Aviamasters engine: round generation + unit tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Simulation script + RTP tuning

**Files:**
- Create: `scripts/aviamasters-sim.mjs`
- Modify: `src/pages/casino/aviamastersEngine.js` (set the tuned `P_LAND` constant)

Because `P_LAND` is independent of the multiplier, `RTP = P_LAND × E[min(finalMult, 250)]`. The sim measures `E[min(finalMult, 250)]` directly, so the correct landing probability is exactly `P_LAND = 0.97 / E`. The script prints that recommendation; we then bake it into the constant and re-run to confirm RTP is within ±1% of 97%.

- [ ] **Step 1: Write the simulation script**

Create `scripts/aviamasters-sim.mjs`:

```js
// Monte-Carlo RTP harness for the Aviamasters engine.
// Run: node scripts/aviamasters-sim.mjs [rounds]
//
// RTP = P_LAND × E[min(finalMult, 250)]. We measure E directly (it does not
// depend on P_LAND), so the landing probability for a target RTP is simply
// P_LAND = TARGET_RTP / E. The script prints that recommendation plus the RTP
// implied by the current P_LAND constant.

import { generateRound, P_LAND, MAX_MULT } from '../src/pages/casino/aviamastersEngine.js'

const TARGET_RTP = 0.97
const rounds = Number(process.argv[2] ?? 1_000_000)

let sumMult = 0
let maxMult = 0
let landCount = 0
let payoutSum = 0   // realized payout multiple (only winning rounds pay)

for (let i = 0; i < rounds; i++) {
  const r = generateRound(Math.random)
  const capped = Math.min(r.finalMult, MAX_MULT)
  sumMult += capped
  if (capped > maxMult) maxMult = capped
  if (r.outcome === 'land') {
    landCount++
    payoutSum += capped
  }
}

const eMult = sumMult / rounds
const measuredRtp = payoutSum / rounds
const recommendedPLand = TARGET_RTP / eMult

console.log(`rounds:                 ${rounds.toLocaleString()}`)
console.log(`E[min(mult,250)]:       ${eMult.toFixed(4)}`)
console.log(`max mult observed:      ${maxMult.toFixed(2)}`)
console.log(`current P_LAND:         ${P_LAND.toFixed(4)}`)
console.log(`win rate (this run):    ${(landCount / rounds * 100).toFixed(2)}%`)
console.log(`measured RTP:           ${(measuredRtp * 100).toFixed(2)}%`)
console.log(`recommended P_LAND:     ${recommendedPLand.toFixed(4)}  (for ${(TARGET_RTP * 100)}% RTP)`)
```

- [ ] **Step 2: Run the sim to get the recommended P_LAND**

Run: `node scripts/aviamasters-sim.mjs`
Expected: prints `E[min(mult,250)]`, a `recommended P_LAND`, and `max mult observed` ≤ 250. Note the `recommended P_LAND` value (e.g. something near `0.97 / E`).

- [ ] **Step 3: Bake the tuned P_LAND into the engine**

In `src/pages/casino/aviamastersEngine.js`, replace the placeholder `P_LAND` line with the recommended value from Step 2 (round to 4 decimals). For example, if the sim recommended `0.6431`:

```js
export const P_LAND = 0.6431   // tuned via scripts/aviamasters-sim.mjs for ~97% RTP
```

- [ ] **Step 4: Re-run the sim to confirm RTP is on target**

Run: `node scripts/aviamasters-sim.mjs`
Expected: `measured RTP` within ±1% of `97.00%`, `max mult observed` ≤ 250.00.

- [ ] **Step 5: Re-run the engine unit tests (P_LAND change must not break them)**

Run: `node --test src/pages/casino/aviamastersEngine.test.js`
Expected: PASS — 5 tests passing (the outcome tests force the RNG, so they are independent of `P_LAND`'s value).

- [ ] **Step 6: Commit**

```bash
git add scripts/aviamasters-sim.mjs src/pages/casino/aviamastersEngine.js
git commit -m "Add Aviamasters RTP simulation and tune P_LAND to ~97%

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: The `AviamastersGame` React component

**Files:**
- Create: `src/pages/casino/AviamastersGame.jsx`

Mirrors `src/pages/casino/AviatorGame.jsx` structure: phase-driven flight loop in a `useEffect` (not in the click handler), refs to avoid stale closures, keyframes injected once, settle via `placeBet`. Differences: the round is **pre-rolled** by `generateRound`, the loop advances one event per tick at the selected speed, there is **no cash-out**, and the resolve is land (win) vs splash (lose). This is a UI task with no unit test; it is verified by `npm run build` (Task 6) and manual play.

- [ ] **Step 1: Write the component**

Create `src/pages/casino/AviamastersGame.jsx`:

```jsx
import { useState, useEffect, useRef } from 'react'
import { GameLayout, BetChips, ResultBanner, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'
import { generateRound, SPEEDS, MAX_MULT } from './aviamastersEngine'

// ── Multiplier color (matches Aviator conventions) ─────────────────────────────
function multColor(m, splashed) {
  if (splashed) return '#f87171'   // red-400
  if (m < 2)    return '#86efac'   // green-300
  if (m < 5)    return '#fde68a'   // amber-200
  return '#fdba74'                 // orange-300
}

// ── Plane position from progress (0→1 along the flight) ────────────────────────
function planePos(progress) {
  const x = 8 + Math.min(1, progress) * 72   // 8% → 80%
  const y = 78 - Math.min(1, progress) * 60  // 78% → 18%
  return { x, y }
}

const SPEED_OPTIONS = [
  { key: 'tortoise',  label: '🐢' },
  { key: 'walking',   label: '🚶' },
  { key: 'hare',      label: '🐇' },
  { key: 'lightning', label: '⚡' },
]

export default function AviamastersGame() {
  const { balance, placeBet } = useCasino()

  const [phase, setPhase]         = useState('betting') // 'betting'|'flying'|'landed'|'splashed'
  const [bet, setBet]             = useState(50)
  const [speed, setSpeed]         = useState('walking')
  const [multiplier, setMultiplier] = useState(1.00)
  const [eventIdx, setEventIdx]   = useState(-1)        // index of the last applied event
  const [flashKind, setFlashKind] = useState(null)      // 'mult'|'add'|'rocket' for the latest hit
  const [gameResult, setGameResult] = useState(null)    // 'win'|'loss'
  const [wonAmount, setWonAmount] = useState(0)

  const roundRef     = useRef(null)   // { events, finalMult, outcome }
  const idxRef       = useRef(-1)
  const betRef       = useRef(bet)
  const speedRef     = useRef(speed)
  const placeBetRef  = useRef(placeBet)
  const intervalRef  = useRef(null)

  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { placeBetRef.current = placeBet }, [placeBet])

  // ── Inject keyframes once ─────────────────────────────────────────────────
  useEffect(() => {
    const id = 'aviamasters-kf'
    if (!document.getElementById(id)) {
      const s = document.createElement('style')
      s.id = id
      s.textContent = `
        @keyframes amPlaneFly {
          0%, 100% { transform: translateY(0px) rotate(-12deg); }
          50%      { transform: translateY(-4px) rotate(-15deg); }
        }
        @keyframes amBump {
          0%   { transform: translate(-50%, -50%) scale(1); }
          40%  { transform: translate(-50%, -50%) scale(1.18); }
          100% { transform: translate(-50%, -50%) scale(1); }
        }
      `
      document.head.appendChild(s)
    }
  }, [])

  // ── Flight loop — advances one pre-rolled event per tick ───────────────────
  useEffect(() => {
    if (phase !== 'flying') return
    const round = roundRef.current
    const tick = SPEEDS[speedRef.current] ?? SPEEDS.walking

    intervalRef.current = setInterval(() => {
      const nextIdx = idxRef.current + 1

      if (nextIdx >= round.events.length) {
        clearInterval(intervalRef.current)
        resolveRound(round)
        return
      }

      const ev = round.events[nextIdx]
      idxRef.current = nextIdx
      setEventIdx(nextIdx)
      setMultiplier(ev.multAfter)
      setFlashKind(ev.kind)
    }, tick)

    return () => clearInterval(intervalRef.current)
  }, [phase])

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => clearInterval(intervalRef.current), [])

  function resolveRound(round) {
    if (round.outcome === 'land') {
      const win = Math.floor(betRef.current * Math.min(round.finalMult, MAX_MULT))
      const profit = win - betRef.current
      setGameResult('win')
      setWonAmount(profit)
      setPhase('landed')
      placeBetRef.current('aviamasters', betRef.current, profit)
    } else {
      setGameResult('loss')
      setWonAmount(betRef.current)
      setPhase('splashed')
      placeBetRef.current('aviamasters', betRef.current, -betRef.current)
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  function startFlight() {
    if ((balance ?? 0) < bet) return
    roundRef.current = generateRound()
    idxRef.current = -1
    setEventIdx(-1)
    setMultiplier(1.00)
    setFlashKind(null)
    setGameResult(null)
    setWonAmount(0)
    setPhase('flying')   // triggers the flight effect
  }

  function handlePlayAgain() {
    clearInterval(intervalRef.current)
    setPhase('betting')
    setMultiplier(1.00)
    idxRef.current = -1
    setEventIdx(-1)
    setFlashKind(null)
    setGameResult(null)
    setWonAmount(0)
  }

  // ── Loading guard ─────────────────────────────────────────────────────────
  if (balance === null) {
    return (
      <GameLayout title="Aviamasters">
        <div className="flex items-center justify-center h-48">
          <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        </div>
      </GameLayout>
    )
  }

  const isBetting  = phase === 'betting'
  const isFlying   = phase === 'flying'
  const isLanded   = phase === 'landed'
  const isSplashed = phase === 'splashed'
  const isResult   = isLanded || isSplashed

  const round = roundRef.current
  const totalEvents = round?.events.length ?? 1
  const progress = isFlying || isResult ? (eventIdx + 1) / totalEvents : 0
  const { x: planeX, y: planeY } = planePos(progress)
  const color = multColor(multiplier, isSplashed)
  const multText = multiplier.toFixed(2)

  // Upcoming + collected node badges along the path.
  const badges = (round?.events ?? []).map((ev, i) => {
    const p = (i + 1) / totalEvents
    const pos = planePos(p)
    const collected = i <= eventIdx
    return { ...ev, i, x: pos.x, y: pos.y, collected }
  })

  return (
    <GameLayout title="Aviamasters">
      <div className="flex flex-col items-center gap-6">

        {/* ── Game board ── */}
        <div
          className="w-full max-w-md rounded-2xl border border-cp-border overflow-hidden"
          style={{ background: '#030712', height: 300, position: 'relative' }}
        >
          {/* Grid lines */}
          <svg
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.08 }}
            preserveAspectRatio="none"
          >
            {[20, 40, 60, 80].map(pct => (
              <line key={`h${pct}`} x1="0" y1={`${pct}%`} x2="100%" y2={`${pct}%`} stroke="#6b7280" strokeWidth="1" />
            ))}
            {[20, 40, 60, 80].map(pct => (
              <line key={`v${pct}`} x1={`${pct}%`} y1="0" x2={`${pct}%`} y2="100%" stroke="#6b7280" strokeWidth="1" />
            ))}
          </svg>

          {/* Water band + carrier */}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '14%',
            background: 'linear-gradient(180deg, rgba(56,189,248,0.10), rgba(2,6,23,0))' }} />
          <div style={{ position: 'absolute', right: '6%', bottom: '12%', fontSize: 22, opacity: 0.85 }}>🚢</div>

          {/* Trajectory trail */}
          {(isFlying || isResult) && (
            <svg
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="amTrail" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={color} stopOpacity="0" />
                  <stop offset="100%" stopColor={color} stopOpacity="0.5" />
                </linearGradient>
              </defs>
              <line x1="8%" y1="78%" x2={`${planeX}%`} y2={`${planeY}%`}
                stroke="url(#amTrail)" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}

          {/* Node / rocket badges */}
          {(isFlying || isResult) && badges.map(b => (
            <div key={b.i}
              style={{
                position: 'absolute', left: `${b.x}%`, top: `${b.y}%`,
                transform: 'translate(-50%, -50%)',
                fontSize: 11, fontWeight: 800, lineHeight: 1,
                padding: b.kind === 'rocket' ? 0 : '3px 6px',
                borderRadius: 8,
                opacity: b.collected ? 0.25 : 1,
                transition: 'opacity 0.25s',
                color:  b.kind === 'rocket' ? undefined : (b.kind === 'mult' ? '#000' : '#052e16'),
                background: b.kind === 'rocket' ? 'transparent'
                          : (b.kind === 'mult' ? '#fbbf24' : '#86efac'),
                boxShadow: b.collected ? 'none'
                          : (b.kind === 'mult' ? '0 0 10px rgba(251,191,36,0.6)' : '0 0 10px rgba(134,239,172,0.5)'),
              }}
            >
              {b.kind === 'rocket' ? '🚀' : b.kind === 'mult' ? `×${b.value}` : `+${b.value}`}
            </div>
          ))}

          {/* Plane / resolve icon */}
          <div
            style={{
              position: 'absolute', left: `${planeX}%`, top: `${planeY}%`,
              transform: 'translate(-50%, -50%)',
              fontSize: 24,
              animation: isFlying ? 'amPlaneFly 0.8s ease-in-out infinite' : 'none',
              transition: isFlying ? 'left 0.2s linear, top 0.2s linear' : 'none',
              filter: isSplashed ? 'none' : `drop-shadow(0 0 8px ${color})`,
            }}
          >
            {isSplashed ? '🌊' : isLanded ? '🛬' : '🛩️'}
          </div>

          {/* Counter Balance readout */}
          <div
            key={eventIdx}
            style={{
              position: 'absolute', top: '42%', left: '50%',
              transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none',
              animation: flashKind && isFlying ? 'amBump 0.3s ease-out' : 'none',
            }}
          >
            <div style={{
              fontSize: 56, fontWeight: 900, color, lineHeight: 1,
              textShadow: `0 0 32px ${color}80`, letterSpacing: '-2px',
            }}>
              {multText}×
            </div>
            {isFlying && (
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                Bet: {formatCoins(bet)} coins
              </div>
            )}
            {isSplashed && (
              <div style={{ fontSize: 12, fontWeight: 700, color: '#f87171',
                textTransform: 'uppercase', letterSpacing: 3, marginTop: 4 }}>
                SPLASH
              </div>
            )}
          </div>
        </div>

        {/* ── Controls ── */}
        <div className="w-full max-w-md flex flex-col gap-4">

          {isBetting && (
            <div className="bg-cp-card border border-cp-border rounded-2xl p-4 flex flex-col gap-4">
              <BetChips bet={bet} onBet={setBet} balance={balance} disabled={false} />
              <div className="flex items-center justify-between">
                <span className="text-cp-muted text-sm font-semibold">Speed</span>
                <div className="flex gap-2">
                  {SPEED_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setSpeed(opt.key)}
                      className={`w-10 h-10 rounded-xl text-lg transition-all active:scale-95 border
                        ${speed === opt.key
                          ? 'bg-amber-400 border-amber-300'
                          : 'bg-cp-elevated border-cp-border hover:border-amber-400/40'}`}
                      title={opt.key}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {isBetting && (
            <button
              onClick={startFlight}
              disabled={balance < bet}
              className={`w-full py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
                ${balance < bet
                  ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                  : 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_24px_rgba(251,191,36,0.3)] hover:shadow-[0_0_32px_rgba(251,191,36,0.45)] active:scale-95'
                }`}
            >
              Spin! 🛩️
            </button>
          )}

          {isFlying && (
            <div className="w-full py-3.5 rounded-2xl font-bold text-center text-cp-muted bg-cp-elevated border border-cp-border">
              In flight… {multText}×
            </div>
          )}

          {isResult && (
            <div className="flex flex-col gap-3">
              <div className={`text-center rounded-xl border py-3 px-4
                ${isLanded ? 'border-emerald-400/30 bg-emerald-400/10' : 'border-red-400/30 bg-red-400/10'}`}>
                {isLanded ? (
                  <>
                    <p className="text-emerald-400 font-bold text-lg">
                      Landed at {round?.finalMult.toFixed(2)}× 🎉
                    </p>
                    <p className="text-emerald-300 text-sm font-semibold mt-0.5">
                      {wonAmount >= 0 ? '+' : ''}{formatCoins(wonAmount)} coins
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-red-400 font-bold text-lg">
                      Splashed 🌊 at {round?.finalMult.toFixed(2)}×
                    </p>
                    <p className="text-cp-muted text-sm mt-0.5">Lost {formatCoins(bet)} coins</p>
                  </>
                )}
              </div>
              <button
                onClick={handlePlayAgain}
                className="w-full py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95"
              >
                Play Again
              </button>
            </div>
          )}
        </div>

        {/* ── Result banner ── */}
        {isResult && (
          <div className="w-full max-w-md">
            <ResultBanner
              result={gameResult}
              amount={wonAmount}
              message={isLanded
                ? `Landed at ${round?.finalMult.toFixed(2)}×`
                : `Splashed at ${round?.finalMult.toFixed(2)}×`}
            />
          </div>
        )}

      </div>
    </GameLayout>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/casino/AviamastersGame.jsx
git commit -m "Add Aviamasters game component

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> Note: `ResultBanner`'s exact prop behaviour is shared with the other games; if the win amount renders oddly during manual testing (Task 6), confirm against `src/pages/casino/shared.jsx:206` and match how `AviatorGame.jsx` passes `amount`/`result`.

---

## Task 4: Register the route

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add the import**

In `src/App.jsx`, directly after the existing line `import AviatorGame from './pages/casino/AviatorGame'` (line 17), add:

```jsx
import AviamastersGame from './pages/casino/AviamastersGame'
```

- [ ] **Step 2: Add the route**

In `src/App.jsx`, immediately after the existing Aviator `<Route …/>` block (the one rendering `<AviatorGame />`, around lines 118-122), add:

```jsx
      <Route path="/casino/aviamasters" element={
        <ProtectedRoute>
          <WithNav><AviamastersGame /></WithNav>
        </ProtectedRoute>
      } />
```

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "Wire /casino/aviamasters route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Add the catalogue card

**Files:**
- Modify: `src/pages/CasinoPage.jsx`

- [ ] **Step 1: Add the GAMES entry**

In `src/pages/CasinoPage.jsx`, inside the `GAMES` array, immediately after the existing Aviator entry (the object with `route: '/casino/aviator'`), add:

```jsx
  {
    route:       '/casino/aviamasters',
    emoji:       '🛩️',
    name:        'Aviamasters',
    description: 'Fly, collect multipliers, dodge rockets',
  },
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/CasinoPage.jsx
git commit -m "Add Aviamasters to casino catalogue

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Build + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the engine tests**

Run: `node --test src/pages/casino/aviamastersEngine.test.js`
Expected: PASS — 5/5.

- [ ] **Step 2: Confirm RTP**

Run: `node scripts/aviamasters-sim.mjs`
Expected: `measured RTP` within ±1% of 97.00%, `max mult observed` ≤ 250.00.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build completes with no errors (Vite emits `dist/`). This is the only "compile" check — the project has no linter/test suite for JSX (`CLAUDE.md`).

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`, sign in, open `/casino`, click the **Aviamasters** card. Verify:
- Bet chips and the four speed buttons (🐢/🚶/🐇/⚡) render in the betting phase.
- **Spin** starts a flight; node badges (`×N` amber, `+N` green) and 🚀 rockets sit along the path and dim as the plane passes them; the Counter Balance bumps on each hit and the readout never exceeds `250×`.
- Switching speed visibly changes tick pace; it does not change outcomes.
- Both outcomes occur over several rounds: **Landed** credits `bet × finalMult` (net) to the wallet; **Splash** deducts the bet. The wallet balance in the navbar updates accordingly.
- **Play Again** returns to the betting phase cleanly.

- [ ] **Step 5: Final commit (if any manual-test tweaks were needed)**

```bash
git add -A
git commit -m "Aviamasters: manual-test fixes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

If no tweaks were needed, skip this step.

---

## Notes for the implementer

- **No DB/migration/RLS changes.** `placeBet('aviamasters', …)` reuses the existing wallet write path; the game id is a free-text label.
- **Client-authoritative is intentional** (`CLAUDE.md` §4) — do not try to move resolution server-side.
- **Stale-closure discipline:** the flight loop reads `roundRef`/`idxRef`/`betRef`/`speedRef`/`placeBetRef`, never the state values directly, exactly like `AviatorGame.jsx`. Keep it that way.
- **Tailwind only**, `cp` palette + `amber-*` for the gold accent, inline SVG/emoji for icons — consistent with the other casino screens.
```
