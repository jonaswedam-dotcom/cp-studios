# Aviator UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Aviator crash game's emoji-and-bobbing UI with a polished gold board where a vector jet banks along a gold trail it draws beneath itself, plus a history bar, live cash-out button, "flew away" crash, ember trail, and big-win celebration.

**Architecture:** Extract pure curve/crash math into a tested `aviatorTrajectory.js` module. A presentational `FlightBoard.jsx` renders the SVG stage purely from props. `AviatorGame.jsx` becomes a thin orchestrator: a `requestAnimationFrame` loop advances the multiplier, the trajectory is rebuilt each frame (so the trail always ends exactly at the jet), and wallet/history side effects fire on round end.

**Tech Stack:** React 18 (function components + hooks), Vite, Tailwind (`cp-*` + `amber-*` palette), inline SVG, `node --test` for the pure module. No new dependencies.

**Working directory:** the worktree at `~/.config/superpowers/worktrees/cp-studios/aviator-ui-redesign` (branch `aviator-ui-redesign`).

**Conventions:** This repo has no React test harness; only pure `.js` modules get `node --test` tests (see `src/pages/casino/aviamastersEngine.test.js`, `src/war/*.test.js`). React components are verified by `npm run build` (catches import/JSX errors) plus manual QA — that is the project's real practice, not a placeholder.

---

### Task 1: `aviatorTrajectory.js` — pure curve + crash math (TDD)

**Files:**
- Create: `src/pages/casino/aviatorTrajectory.js`
- Test: `src/pages/casino/aviatorTrajectory.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/pages/casino/aviatorTrajectory.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  progress, multiplierForElapsed, pointAt, tangentDeg, buildTrajectory, generateCrash, DIMS,
} from './aviatorTrajectory.js'

test('progress is 0 at m=1 and rises monotonically toward (but never reaching) 1', () => {
  assert.equal(progress(1), 0)
  assert.ok(progress(2) > progress(1))
  assert.ok(progress(10) > progress(2))
  assert.ok(progress(1e6) < 1)
  assert.ok(progress(1e6) > 0.99)
})

test('multiplierForElapsed starts at 1 and grows with time', () => {
  assert.equal(multiplierForElapsed(0), 1)
  assert.ok(multiplierForElapsed(1) > 1)
  assert.ok(multiplierForElapsed(5) > multiplierForElapsed(1))
})

test('pointAt(0) is the bottom-left origin; pointAt(1) is the top-right target', () => {
  const a = pointAt(0)
  assert.equal(a.x, 24)
  assert.equal(a.y, DIMS.h - 18)
  const b = pointAt(1)
  assert.equal(b.x, DIMS.w - 24)
  assert.equal(b.y, 40)
})

test('pointAt: x increases and y rises (decreases) as p grows', () => {
  const lo = pointAt(0.2)
  const hi = pointAt(0.8)
  assert.ok(hi.x > lo.x)
  assert.ok(hi.y < lo.y)
})

test('tangent is flat at the start and tilts nose-up as it climbs', () => {
  assert.ok(Math.abs(tangentDeg(0)) < 1e-9)
  assert.ok(tangentDeg(0.8) < 0) // negative angle = nose up in SVG y-down coords
})

test('buildTrajectory: line ends exactly at the plane and area is closed', () => {
  const p = progress(2.5)
  const { line, area, plane } = buildTrajectory(p)
  const target = pointAt(p)
  assert.ok(Math.abs(plane.x - target.x) < 1e-6)
  assert.ok(Math.abs(plane.y - target.y) < 1e-6)
  assert.ok(line.startsWith('M'))
  assert.ok(line.includes(`L${target.x.toFixed(2)},${target.y.toFixed(2)}`))
  assert.ok(area.endsWith('Z'))
})

test('generateCrash respects bounds and the ~5% instant-bust rate', () => {
  assert.equal(generateCrash(() => 0.01), 1.0) // forced bust
  assert.ok(generateCrash(makeRng([0.5, 0.0])) >= 1.01) // forced low payout clamps to 1.01
  let busts = 0, seed = 12345
  const lcg = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  for (let i = 0; i < 20000; i++) if (generateCrash(lcg) === 1.0) busts++
  const rate = busts / 20000
  assert.ok(rate > 0.03 && rate < 0.07, `bust rate was ${rate}`)
})

function makeRng(values) {
  let i = 0
  return () => (i < values.length ? values[i++] : 0)
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/pages/casino/aviatorTrajectory.test.js`
Expected: FAIL — cannot find module `./aviatorTrajectory.js` (file not created yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/pages/casino/aviatorTrajectory.js`:

```js
// Pure geometry + crash math for the Aviator crash game. No React, no DOM.

export const DIMS = { w: 360, h: 286 }

// Curve anchor padding inside the board viewBox.
const PAD_LEFT = 24
const PAD_RIGHT = 24
const PAD_TOP = 40
const PAD_BOTTOM = 18

const PROGRESS_C = 4 // larger => slower asymptotic approach to the top
const RISE_EXP = 1.7 // > 1 => concave-up curve (shallow, then steep)
export const GROWTH_RATE = 0.15 // multiplier growth per second: m = e^(rate * t)

// Live multiplier (>= 1) -> normalized progress p in [0, 1). Asymptotic so any
// multiplier stays on-screen (this is the "Y-axis rescales" effect).
export function progress(m) {
  const x = Math.max(0, m - 1)
  return x / (x + PROGRESS_C)
}

// Multiplier as a function of elapsed seconds since takeoff.
export function multiplierForElapsed(seconds) {
  return Math.exp(GROWTH_RATE * Math.max(0, seconds))
}

function anchors(dims) {
  return { x0: PAD_LEFT, y0: dims.h - PAD_BOTTOM, x1: dims.w - PAD_RIGHT, y1: PAD_TOP }
}

// Point on the curve at progress p (0..1).
export function pointAt(p, dims = DIMS) {
  const { x0, y0, x1, y1 } = anchors(dims)
  const cp = Math.min(1, Math.max(0, p))
  return {
    x: x0 + (x1 - x0) * cp,
    y: y0 - (y0 - y1) * Math.pow(cp, RISE_EXP),
  }
}

// Tangent angle (degrees) at progress p for a right-pointing sprite.
export function tangentDeg(p, dims = DIMS) {
  const { x0, y0, x1, y1 } = anchors(dims)
  const cp = Math.min(1, Math.max(0, p))
  const dxdp = x1 - x0
  const dydp = -(y0 - y1) * RISE_EXP * Math.pow(cp, RISE_EXP - 1)
  return (Math.atan2(dydp, dxdp) * 180) / Math.PI
}

// SVG path strings + plane placement for progress p.
export function buildTrajectory(p, dims = DIMS, steps = 24) {
  const cp = Math.min(1, Math.max(0, p))
  const pts = []
  for (let i = 0; i <= steps; i++) pts.push(pointAt((cp * i) / steps, dims))
  const line = pts
    .map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`)
    .join(' ')
  const last = pts[pts.length - 1]
  const area = `${line} L${last.x.toFixed(2)},${dims.h} L${pts[0].x.toFixed(2)},${dims.h} Z`
  return { line, area, plane: { x: last.x, y: last.y, angleDeg: tangentDeg(cp, dims) } }
}

// Predetermined crash multiplier. Same distribution as the original game:
// ~5% instant bust at 1.00, otherwise a heavy-tailed value clamped to >= 1.01.
export function generateCrash(rng = Math.random) {
  if (rng() < 0.05) return 1.0
  const u = rng()
  return Math.max(1.01, +(1 / (1 - u * 0.95)).toFixed(2))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/pages/casino/aviatorTrajectory.test.js`
Expected: PASS — all 7 tests pass.

Also run the whole suite to confirm nothing else broke: `node --test`
Expected: PASS — 70 tests (63 existing + 7 new), 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/pages/casino/aviatorTrajectory.js src/pages/casino/aviatorTrajectory.test.js
git commit -m "feat(aviator): pure trajectory + crash math module with tests"
```

---

### Task 2: `FlightBoard.jsx` — presentational SVG stage

**Files:**
- Create: `src/pages/casino/FlightBoard.jsx`

- [ ] **Step 1: Create the component**

Create `src/pages/casino/FlightBoard.jsx`:

```jsx
import { progress, buildTrajectory, pointAt, DIMS } from './aviatorTrajectory'

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Right-pointing jet (Material "flight" glyph rotated to face +x), drawn at (x, y),
// banked to angleDeg. On crash, an inner wrapper animates it forward off-screen.
function Jet({ x, y, angleDeg, color, flyoff }) {
  return (
    <g transform={`translate(${x},${y}) rotate(${angleDeg})`} filter="url(#fb-glow)">
      <g style={flyoff ? { animation: 'fbFlyoff 0.6s ease-in forwards' } : undefined}>
        <g transform="scale(1.25) translate(-12,-12) rotate(90 12 12)">
          <path
            d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"
            fill={color}
          />
        </g>
      </g>
    </g>
  )
}

export default function FlightBoard({ phase, multiplier, crashPoint, cashedOutAt, bet }) {
  const betting = phase === 'betting'
  const flying = phase === 'flying'
  const crashed = phase === 'crashed'
  const cashedOut = phase === 'cashedout'

  const p = progress(multiplier)
  const { line, area, plane } = buildTrajectory(p, DIMS)
  const origin = pointAt(0, DIMS)

  const strokeColor = crashed ? '#ef4444' : 'url(#fb-stroke)'
  const fillRef = crashed ? 'url(#fb-fill-red)' : 'url(#fb-fill)'
  const multColor = betting ? '#7a7570' : crashed ? '#f87171' : '#fde68a'
  const multShadow = crashed
    ? '0 0 26px rgba(239,68,68,0.5)'
    : betting
      ? 'none'
      : '0 0 30px rgba(251,191,36,0.5)'

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${DIMS.w} / ${DIMS.h}`,
        borderRadius: 16,
        overflow: 'hidden',
        background: 'radial-gradient(130% 120% at 16% 96%, #1c160b 0%, #0c0a09 66%)',
        border: '1px solid #252525',
        boxShadow: crashed ? 'inset 0 0 70px rgba(239,68,68,0.35)' : 'none',
        animation: crashed && !REDUCED_MOTION ? 'fbShake 0.4s ease' : 'none',
      }}
    >
      <svg
        viewBox={`0 0 ${DIMS.w} ${DIMS.h}`}
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        <defs>
          <linearGradient id="fb-fill" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.26" />
          </linearGradient>
          <linearGradient id="fb-fill-red" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0" />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0.22" />
          </linearGradient>
          <linearGradient id="fb-stroke" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#b45309" />
            <stop offset="58%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#fde68a" />
          </linearGradient>
          <linearGradient id="fb-jet" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#fffbeb" />
          </linearGradient>
          <filter id="fb-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <g stroke="#fcd34d" strokeWidth="0.6" opacity="0.1">
          <line x1="0" y1="200" x2={DIMS.w} y2="200" />
          <line x1="0" y1="140" x2={DIMS.w} y2="140" />
          <line x1="0" y1="80" x2={DIMS.w} y2="80" />
        </g>

        {betting ? (
          <line
            x1="20" y1={DIMS.h - 22} x2="150" y2={DIMS.h - 22}
            stroke="#3f3f46" strokeWidth="2" strokeDasharray="6 6"
          />
        ) : (
          <>
            <path d={area} fill={fillRef} />
            <path
              d={line} fill="none" stroke={strokeColor} strokeWidth="4"
              strokeLinecap="round" filter="url(#fb-glow)" opacity={crashed ? 0.85 : 1}
            />
            {flying && !REDUCED_MOTION && [0.95, 0.9, 0.85].map((f, i) => {
              const e = pointAt(p * f, DIMS)
              return <circle key={i} cx={e.x} cy={e.y} r={2.6 - i * 0.5} fill="#fde68a" opacity={0.5 - i * 0.12} />
            })}
          </>
        )}

        <Jet
          x={betting ? origin.x : plane.x}
          y={betting ? origin.y : plane.y}
          angleDeg={betting ? 0 : plane.angleDeg}
          color={crashed ? '#f87171' : 'url(#fb-jet)'}
          flyoff={crashed && !REDUCED_MOTION}
        />
      </svg>

      <div style={{ position: 'absolute', left: '7%', top: '11%', pointerEvents: 'none' }}>
        <div
          style={{
            fontFamily: '"Playfair Display", Georgia, serif',
            fontWeight: 800,
            fontSize: 'clamp(34px, 12vw, 52px)',
            color: multColor,
            textShadow: multShadow,
            lineHeight: 1,
          }}
        >
          {multiplier.toFixed(2)}×
        </div>
        {betting && <div style={{ fontSize: 11, color: '#78716c', marginTop: 4 }}>Ready for takeoff</div>}
        {flying && (
          <div style={{ fontSize: 12, color: '#a8a29e', marginTop: 4 }}>
            Bet {bet} · cash out for <b style={{ color: '#fcd34d' }}>{Math.floor(bet * (multiplier - 1))}</b>
          </div>
        )}
      </div>

      {crashed && (
        <div style={{ position: 'absolute', left: '7%', top: '40%', fontWeight: 800, letterSpacing: 2, color: '#f87171', fontSize: 14 }}>
          FLEW AWAY ✈ {crashPoint != null ? crashPoint.toFixed(2) : '—'}×
        </div>
      )}

      {cashedOut && (
        <div style={{ position: 'absolute', top: 10, right: 10, fontSize: 11, fontWeight: 700, color: '#34d399', background: 'rgba(16,185,129,0.14)', border: '1px solid rgba(52,211,153,0.4)', borderRadius: 9, padding: '4px 9px' }}>
          Cashed out {cashedOutAt != null ? cashedOutAt.toFixed(2) : '—'}×
        </div>
      )}

      <style>{`
        @keyframes fbFlyoff { to { transform: translate(160px, 0px); opacity: 0; } }
        @keyframes fbShake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)} }
      `}</style>
    </div>
  )
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: `✓ built in …` with no errors (the pre-existing chunk-size warning is fine).

- [ ] **Step 3: Commit**

```bash
git add src/pages/casino/FlightBoard.jsx
git commit -m "feat(aviator): presentational FlightBoard SVG stage"
```

---

### Task 3: Rewrite `AviatorGame.jsx` — orchestrator

**Files:**
- Modify (full rewrite): `src/pages/casino/AviatorGame.jsx`

- [ ] **Step 1: Replace the file contents**

Overwrite `src/pages/casino/AviatorGame.jsx` with:

```jsx
import { useState, useEffect, useRef } from 'react'
import { GameLayout, BetChips, ResultBanner, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'
import FlightBoard from './FlightBoard'
import { generateCrash, multiplierForElapsed } from './aviatorTrajectory'

const HISTORY_KEY = 'cp-studios:aviator-history'
const HISTORY_MAX = 15
const BIG_WIN_MULT = 5

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.slice(0, HISTORY_MAX) : []
  } catch {
    return []
  }
}

function pillStyle(m) {
  if (m < 2) return { color: '#f87171', borderColor: '#7f1d1d', background: '#2a1112' }
  if (m <= 5) return { color: '#fcd34d', borderColor: '#854d0e', background: '#2a210f' }
  return { color: '#86efac', borderColor: '#14532d', background: '#0f2a18' }
}

function HistoryBar({ items }) {
  if (!items.length) return null
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        overflow: 'hidden',
        marginBottom: 12,
        WebkitMaskImage: 'linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)',
      }}
    >
      {items.map((m, i) => {
        const s = pillStyle(m)
        return (
          <span
            key={i}
            style={{ flex: 'none', fontSize: 12, fontWeight: 700, padding: '4px 9px', borderRadius: 999, border: `1px solid ${s.borderColor}`, color: s.color, background: s.background }}
          >
            {m.toFixed(2)}×
          </span>
        )
      })}
    </div>
  )
}

function BigWinBurst({ multiplier, amount }) {
  const coins = Array.from({ length: 14 })
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(60% 50% at 50% 45%, rgba(251,191,36,0.22), rgba(251,191,36,0) 70%)' }} />
      {!REDUCED_MOTION &&
        coins.map((_, i) => {
          const angle = (i / coins.length) * Math.PI * 2
          return (
            <span
              key={i}
              style={{ position: 'absolute', fontSize: 18, animation: 'bwBurst 0.9s ease-out forwards', '--dx': `${Math.cos(angle) * 120}px`, '--dy': `${Math.sin(angle) * 90}px` }}
            >
              🪙
            </span>
          )
        })}
      <div style={{ position: 'relative', fontFamily: '"Playfair Display", Georgia, serif', fontWeight: 800, fontSize: 30, color: '#fde68a', textShadow: '0 0 26px rgba(251,191,36,0.6)' }}>
        +{formatCoins(amount)} coins
      </div>
      <div style={{ position: 'relative', fontSize: 12, color: '#a8a29e', marginTop: 4 }}>Huge win at {multiplier.toFixed(2)}× 🎉</div>
      <style>{`@keyframes bwBurst { from { transform: translate(0,0) scale(0.4); opacity: 1 } to { transform: translate(var(--dx), var(--dy)) scale(1); opacity: 0 } }`}</style>
    </div>
  )
}

export default function AviatorGame() {
  const { balance, placeBet } = useCasino()

  const [phase, setPhase] = useState('betting') // betting | flying | crashed | cashedout
  const [multiplier, setMultiplier] = useState(1.0)
  const [bet, setBet] = useState(50)
  const [cashedOutAt, setCashedOutAt] = useState(null)
  const [gameResult, setGameResult] = useState(null)
  const [wonAmount, setWonAmount] = useState(0)
  const [history, setHistory] = useState(loadHistory)
  const [bigWin, setBigWin] = useState(null) // { multiplier, amount } | null

  const crashPointRef = useRef(null)
  const startTimeRef = useRef(0)
  const rafRef = useRef(null)
  const multiplierRef = useRef(1.0)
  const betRef = useRef(bet)
  const placeBetRef = useRef(placeBet)

  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => { placeBetRef.current = placeBet }, [placeBet])

  function recordRound(crashMult) {
    setHistory((prev) => {
      const next = [crashMult, ...prev].slice(0, HISTORY_MAX)
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  // Flight loop — driven by phase so the RAF never captures stale state.
  useEffect(() => {
    if (phase !== 'flying') return
    let active = true
    const tick = () => {
      if (!active) return
      const elapsed = (performance.now() - startTimeRef.current) / 1000
      const m = multiplierForElapsed(elapsed)
      if (m >= crashPointRef.current) {
        const cp = crashPointRef.current
        multiplierRef.current = cp
        setMultiplier(cp)
        setPhase('crashed')
        setGameResult('loss')
        setWonAmount(betRef.current)
        placeBetRef.current('aviator', betRef.current, -betRef.current)
        recordRound(cp)
        return
      }
      multiplierRef.current = m
      setMultiplier(+m.toFixed(2))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { active = false; cancelAnimationFrame(rafRef.current) }
  }, [phase])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  function startFlight() {
    if ((balance ?? 0) < bet) return
    crashPointRef.current = generateCrash()
    multiplierRef.current = 1.0
    startTimeRef.current = performance.now()
    setMultiplier(1.0)
    setCashedOutAt(null)
    setGameResult(null)
    setWonAmount(0)
    setBigWin(null)
    setPhase('flying')
  }

  function handleCashOut() {
    if (phase !== 'flying') return
    cancelAnimationFrame(rafRef.current)
    const m = multiplierRef.current
    const win = Math.floor(betRef.current * (m - 1))
    setCashedOutAt(m)
    setPhase('cashedout')
    setGameResult('win')
    setWonAmount(win)
    placeBetRef.current('aviator', betRef.current, win)
    recordRound(crashPointRef.current)
    if (m >= BIG_WIN_MULT) setBigWin({ multiplier: m, amount: win })
  }

  function handlePlayAgain() {
    cancelAnimationFrame(rafRef.current)
    setPhase('betting')
    setMultiplier(1.0)
    multiplierRef.current = 1.0
    setCashedOutAt(null)
    setGameResult(null)
    setWonAmount(0)
    setBigWin(null)
  }

  if (balance === null) {
    return (
      <GameLayout title="Aviator">
        <div className="flex items-center justify-center h-48">
          <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        </div>
      </GameLayout>
    )
  }

  const isBetting = phase === 'betting'
  const isFlying = phase === 'flying'
  const isCrashed = phase === 'crashed'
  const isCashedOut = phase === 'cashedout'
  const isResult = isCrashed || isCashedOut
  const liveWin = Math.floor(bet * (multiplier - 1))

  return (
    <GameLayout title="Aviator">
      <div className="flex flex-col items-center gap-6">
        <div className="w-full max-w-md">
          <HistoryBar items={history} />
          <div style={{ position: 'relative' }}>
            <FlightBoard
              phase={phase}
              multiplier={multiplier}
              crashPoint={crashPointRef.current}
              cashedOutAt={cashedOutAt}
              bet={bet}
            />
            {bigWin && <BigWinBurst multiplier={bigWin.multiplier} amount={bigWin.amount} />}
          </div>
        </div>

        <div className="w-full max-w-md flex flex-col gap-4">
          {isBetting && (
            <div className="bg-cp-card border border-cp-border rounded-2xl p-4">
              <BetChips bet={bet} onBet={setBet} balance={balance} disabled={false} />
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
              Fly! ✈
            </button>
          )}

          {isFlying && (
            <button
              onClick={handleCashOut}
              className="w-full py-3.5 rounded-2xl font-bold text-black transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', boxShadow: '0 0 28px rgba(251,191,36,0.4)', animation: REDUCED_MOTION ? 'none' : 'aviatorPulse 1.1s ease-out infinite', fontSize: 17 }}
            >
              CASH OUT&nbsp; +{formatCoins(liveWin)} &nbsp;·&nbsp; {multiplier.toFixed(2)}×
            </button>
          )}

          {isCrashed && (
            <div className="flex flex-col gap-3">
              <div className="text-center rounded-xl border border-red-400/30 bg-red-400/10 py-3 px-4">
                <p className="text-red-400 font-bold text-lg">FLEW AWAY ✈ {crashPointRef.current?.toFixed(2)}×</p>
                <p className="text-cp-muted text-sm mt-0.5">Lost {formatCoins(bet)} coins</p>
              </div>
              <button onClick={handlePlayAgain} className="w-full py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95">Play Again</button>
            </div>
          )}

          {isCashedOut && (
            <div className="flex flex-col gap-3">
              <div className="text-center rounded-xl border border-emerald-400/30 bg-emerald-400/10 py-3 px-4">
                <p className="text-emerald-400 font-bold text-lg">Cashed out at {cashedOutAt?.toFixed(2)}× 🎉</p>
                <p className="text-emerald-300 text-sm font-semibold mt-0.5">+{formatCoins(wonAmount)} coins</p>
              </div>
              <button onClick={handlePlayAgain} className="w-full py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95">Play Again</button>
            </div>
          )}
        </div>

        {isResult && (
          <div className="w-full max-w-md">
            <ResultBanner
              result={gameResult}
              amount={wonAmount}
              message={isCrashed ? `Flew away at ${crashPointRef.current?.toFixed(2)}×` : `Cashed out at ${cashedOutAt?.toFixed(2)}×`}
            />
          </div>
        )}

        <style>{`@keyframes aviatorPulse { 0%{box-shadow:0 0 0 0 rgba(251,191,36,0.55)} 70%{box-shadow:0 0 0 14px rgba(251,191,36,0)} 100%{box-shadow:0 0 0 0 rgba(251,191,36,0)} }`}</style>
      </div>
    </GameLayout>
  )
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: `✓ built in …` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/casino/AviatorGame.jsx
git commit -m "feat(aviator): rewrite game as RAF-driven board with engagement features"
```

---

### Task 4: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `node --test`
Expected: 70 tests pass, 0 failures.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 3: Confirm no stale references**

Run: `grep -rn "planeFly\|planePos\|multColor" src/`
Expected: no matches (all removed by the rewrite).

Run: `grep -rn "AviatorGame" src/App.jsx`
Expected: the existing default import + route still resolve (unchanged).

- [ ] **Step 4: Manual QA checklist (`npm run dev`, open the Aviator game)**

  - Betting: jet idles on the dashed runway, `1.00×` muted, chips + `Fly! ✈`.
  - Flying: jet banks up its own gold trail; the trail/fill end exactly at the nose (never ahead); multiplier climbs; ember trail visible; cash-out button shows live `+win · m×`.
  - Cash out: green banner + `+win coins`; ≥5× triggers the coin-burst celebration.
  - Crash: jet darts off, red vignette + shake, `FLEW AWAY ✈ m×`, balance decremented.
  - History bar fills with color-coded crash points and survives a page reload.
  - Mobile width (~375px): layout holds, jet undistorted.

---

## Self-Review

**Spec coverage:** vector jet (Task 2 `Jet`) ✓ · banks along tangent (`tangentDeg` Task 1, used in `buildTrajectory`) ✓ · trail ends at jet (`buildTrajectory` samples 0→p; test asserts it) ✓ · gold direction (Task 2 gradients) ✓ · history bar (Task 3 `HistoryBar` + `recordRound`) ✓ · live cash-out button (Task 3) ✓ · flew-away crash (Task 2 overlay + flyoff, Task 3 phase) ✓ · ember trail (Task 2) ✓ · big-win celebration (Task 3 `BigWinBurst`, ≥5×) ✓ · manual pacing (Fly/Play Again) ✓ · unchanged odds/`placeBet`/loading guard/`shared.jsx` ✓ · reduced-motion (`REDUCED_MOTION` in both components) ✓.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; commands have expected output. The "no React unit test" note reflects the repo's actual practice and is justified, not a gap.

**Type/name consistency:** `progress`, `multiplierForElapsed`, `pointAt`, `tangentDeg`, `buildTrajectory`, `generateCrash`, `DIMS` are defined in Task 1 and imported with those exact names in Tasks 2–3. `FlightBoard` props `{ phase, multiplier, crashPoint, cashedOutAt, bet }` match between definition (Task 2) and usage (Task 3). SVG gradient/filter ids (`fb-fill`, `fb-fill-red`, `fb-stroke`, `fb-jet`, `fb-glow`) are defined and referenced within the same file.
