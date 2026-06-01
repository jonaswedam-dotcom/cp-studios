# Aviamasters Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `AviamastersGame.jsx` + `aviamastersEngine.js` to replicate BGaming Aviamasters 2 mechanics — 4 boosters, Safe Landing, Autoplay, Big/Mega/Super Mega win popups — with a layered sky/ocean visual reskinned to CP Studios dark theme.

**Architecture:** Pre-rolled engine stays unchanged; new `applyBooster` pure function mutates event `kind`/`skipped` fields on the live round object mid-flight. Game loop switches from reading baked-in `multAfter` values to maintaining a running `multRef`, so booster-mutated events compute correctly. All sub-components (`GameBoard`, `BettingPanel`, `BoosterBar`, `WinPopup`, `ResultPanel`) live in the same `AviamastersGame.jsx` file.

**Tech Stack:** React 18 (hooks + refs), inline SVG + CSS keyframes, `aviamastersEngine.js` (pure JS, no DOM), `useCasino().placeBet`

---

## File Map

| File | Change |
|---|---|
| `src/pages/casino/aviamastersEngine.js` | Add `WIN_TIERS` constant + `applyBooster` export |
| `src/pages/casino/aviamastersEngine.test.js` | Add 4 tests for `applyBooster` |
| `src/pages/casino/AviamastersGame.jsx` | Full rewrite across Tasks 2–7 |

---

### Task 1: Engine — add `WIN_TIERS` and `applyBooster` (TDD)

**Files:**
- Modify: `src/pages/casino/aviamastersEngine.js`
- Modify: `src/pages/casino/aviamastersEngine.test.js`

- [ ] **Step 1: Add `WIN_TIERS` constant to the engine**

In `src/pages/casino/aviamastersEngine.js`, append after the existing constants (before `pickWeighted`):

```js
export const WIN_TIERS = { BIG: 20, MEGA: 40, SUPER_MEGA: 80 }
```

- [ ] **Step 2: Write 4 failing tests for `applyBooster`**

Append to `src/pages/casino/aviamastersEngine.test.js`:

```js
import { applyBooster } from './aviamastersEngine.js'

// Build a minimal events array where each entry has kind, value, multAfter.
function makeEvents(...kinds) {
  let mult = 1
  return kinds.map(kind => {
    if (kind === 'rocket') mult = mult / 2
    else if (kind === 'add')  mult = mult + 0.5
    else if (kind === 'mult') mult = mult * 2
    return { kind, value: kind === 'rocket' ? 2 : kind === 'mult' ? 2 : 0.5, multAfter: mult }
  })
}

test('applyBooster laser_gun marks the next rocket as skipped', () => {
  // events: [add, rocket, add] — currentIdx=0 → remaining starts at index 1
  const events = makeEvents('add', 'rocket', 'add')
  const { events: out, outcome } = applyBooster(events, 0, 'laser_gun', 'splash')
  assert.equal(out[1].skipped, true)
  assert.equal(out.length, 3)
  assert.equal(outcome, 'splash') // laser_gun does not change outcome
})

test('applyBooster magnet converts next rocket to add +0.5 and flips splash→land', () => {
  const events = makeEvents('add', 'rocket', 'add')
  const { events: out, outcome } = applyBooster(events, 0, 'magnet', 'splash')
  assert.equal(out[1].kind, 'add')
  assert.equal(out[1].value, 0.5)
  assert.equal(outcome, 'land')
})

test('applyBooster nitro marks all remaining rockets as skipped, non-rockets untouched', () => {
  // currentIdx=-1 → all events are remaining
  const events = makeEvents('rocket', 'add', 'rocket')
  const { events: out } = applyBooster(events, -1, 'nitro', 'land')
  assert.equal(out[0].skipped, true)
  assert.equal(out[1].skipped, undefined)
  assert.equal(out[2].skipped, true)
})

test('applyBooster life_buoy flips splash to land without changing events', () => {
  const events = makeEvents('add', 'rocket')
  const { events: out, outcome } = applyBooster(events, 0, 'life_buoy', 'splash')
  assert.equal(outcome, 'land')
  assert.deepEqual(out, events)
})
```

- [ ] **Step 3: Run tests — expect 4 failures**

```bash
node --test src/pages/casino/aviamastersEngine.test.js
```

Expected: existing tests pass, 4 new tests fail with `applyBooster is not a function`.

- [ ] **Step 4: Implement `applyBooster`**

Append to `src/pages/casino/aviamastersEngine.js` (before the last line):

```js
// Applies a one-shot booster to the remaining unprocessed events.
// currentIdx: index of the last event already applied (-1 if none yet).
// Returns { events: newEventArray, outcome: possiblyFlippedOutcome }.
export function applyBooster(events, currentIdx, boosterKind, outcome) {
  const before    = events.slice(0, currentIdx + 1)
  const remaining = events.slice(currentIdx + 1)

  switch (boosterKind) {
    case 'laser_gun': {
      const ri = remaining.findIndex(e => e.kind === 'rocket' && !e.skipped)
      if (ri === -1) return { events, outcome }
      const newRemaining = remaining.map((e, i) => i === ri ? { ...e, skipped: true } : e)
      return { events: [...before, ...newRemaining], outcome }
    }
    case 'magnet': {
      const ri = remaining.findIndex(e => e.kind === 'rocket' && !e.skipped)
      const newRemaining = ri === -1 ? remaining
        : remaining.map((e, i) => i === ri ? { ...e, kind: 'add', value: 0.5 } : e)
      return {
        events: [...before, ...newRemaining],
        outcome: outcome === 'splash' ? 'land' : outcome,
      }
    }
    case 'nitro': {
      const newRemaining = remaining.map(e =>
        e.kind === 'rocket' ? { ...e, skipped: true } : e
      )
      return { events: [...before, ...newRemaining], outcome }
    }
    case 'life_buoy':
      return { events, outcome: outcome === 'splash' ? 'land' : outcome }
    default:
      return { events, outcome }
  }
}
```

- [ ] **Step 5: Run tests — all must pass**

```bash
node --test src/pages/casino/aviamastersEngine.test.js
```

Expected: all tests pass (previously passing tests still pass, 4 new ones now pass).

- [ ] **Step 6: Commit**

```bash
git add src/pages/casino/aviamastersEngine.js src/pages/casino/aviamastersEngine.test.js
git commit -m "feat(aviamasters): add WIN_TIERS + applyBooster to engine (TDD)"
```

---

### Task 2: Rewrite `AviamastersGame.jsx` — skeleton with redesigned `GameBoard` and running-multiplier loop

This task replaces the entire file with a clean playable skeleton: bezier curve, layered visual, running-`multRef` game loop. No boosters, Safe Landing, or Autoplay yet — those are added incrementally in Tasks 3–6.

**Files:**
- Modify: `src/pages/casino/AviamastersGame.jsx`

- [ ] **Step 1: Replace the entire file contents**

```jsx
import { useState, useEffect, useRef } from 'react'
import { GameLayout, BetChips, ResultBanner, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'
import {
  generateRound, SPEEDS, MAX_MULT, WIN_TIERS, applyBooster,
} from './aviamastersEngine'

// ── Bezier helpers ─────────────────────────────────────────────────────────────
// All coordinates are in a 0-100 viewBox space.
const P0 = { x: 8,  y: 82 }  // start (bottom-left)
const P1 = { x: 55, y: 30 }  // control point
const P2 = { x: 92, y: 18 }  // end (top-right, near carrier)

function bezierPoint(t) {
  const mt = 1 - t
  return {
    x: mt * mt * P0.x + 2 * mt * t * P1.x + t * t * P2.x,
    y: mt * mt * P0.y + 2 * mt * t * P1.y + t * t * P2.y,
  }
}

function bezierTrailPoints(tEnd) {
  if (tEnd <= 0) return ''
  return Array.from({ length: 41 }, (_, i) => {
    const { x, y } = bezierPoint((i / 40) * tEnd)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

// ── Static star field (deterministic, no Math.random) ─────────────────────────
const STARS = Array.from({ length: 22 }, (_, i) => ({
  x:  ((i * 97 + 13) * 31) % 100,
  y:  ((i * 61 + 7)  * 17) % 50,
  r:  i % 4 === 0 ? 1 : 0.5,
  op: 0.2 + (i % 6) * 0.07,
}))

// ── Multiplier colour ──────────────────────────────────────────────────────────
function multColor(m, splashed) {
  if (splashed) return '#f87171'
  if (m < 2)    return '#86efac'
  if (m < 5)    return '#fde68a'
  return '#fdba74'
}

// ── GameBoard ──────────────────────────────────────────────────────────────────
// Pure display component — no state, no side-effects.
function GameBoard({ phase, planeT, badges, multiplier, flashKind, bet }) {
  const isSplashed = phase === 'splashed'
  const isLanded   = phase === 'landed'
  const isFlying   = phase === 'flying'
  const isActive   = isFlying || isLanded || isSplashed

  const { x: planeX, y: planeY } = bezierPoint(Math.min(1, planeT))
  const color = multColor(multiplier, isSplashed)

  return (
    <div style={{
      width: '100%', maxWidth: 448, height: 360,
      borderRadius: 16, overflow: 'hidden', position: 'relative',
      border: '1px solid #1f2937',
      background: 'linear-gradient(180deg, #030712 0%, #0f172a 78%, #0c1425 100%)',
    }}>

      {/* Stars */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        viewBox="0 0 100 100" preserveAspectRatio="none">
        {STARS.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="white" opacity={s.op} />
        ))}
      </svg>

      {/* Bezier track (dashed guide line) */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        viewBox="0 0 100 100" preserveAspectRatio="none">
        <path
          d={`M ${P0.x},${P0.y} Q ${P1.x},${P1.y} ${P2.x},${P2.y}`}
          stroke="#ffffff10" strokeWidth="0.7" strokeDasharray="2,2.5" fill="none"
        />
      </svg>

      {/* Trail (coloured polyline up to current planeT) */}
      {isActive && (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="amTrail3" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor={color} stopOpacity="0"   />
              <stop offset="100%" stopColor={color} stopOpacity="0.6" />
            </linearGradient>
          </defs>
          <polyline
            points={bezierTrailPoints(Math.min(1, planeT))}
            stroke="url(#amTrail3)" strokeWidth="1.4" fill="none" strokeLinecap="round"
          />
        </svg>
      )}

      {/* Collectible badges (SVG rect+text for add/mult; absolute div for rockets) */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        viewBox="0 0 100 100" preserveAspectRatio="none">
        {isActive && badges.filter(b => b.kind !== 'rocket').map((b, i) => {
          const { x, y } = bezierPoint(b.t)
          const fill  = b.kind === 'mult' ? '#fbbf24' : '#86efac'
          const label = b.kind === 'mult' ? `×${b.value}` : `+${b.value}`
          return (
            <g key={i} opacity={b.collected ? 0.2 : 1} style={{ transition: 'opacity 0.3s' }}>
              <rect x={x - 5.5} y={y - 3.2} width={11} height={6.4} rx={1.5} fill={fill} />
              <text x={x} y={y + 1.3} textAnchor="middle"
                fontSize="3.2" fontWeight="800" fill="#000">{label}</text>
            </g>
          )
        })}
      </svg>

      {/* Rocket emoji badges (absolute-positioned divs — SVG can't render emoji reliably) */}
      {isActive && badges.filter(b => b.kind === 'rocket').map((b, i) => {
        const { x, y } = bezierPoint(b.t)
        return (
          <div key={`r${i}`} style={{
            position: 'absolute', left: `${x}%`, top: `${y}%`,
            transform: 'translate(-50%, -50%)',
            fontSize: 13, lineHeight: 1,
            opacity: b.collected ? 0.15 : b.skipped ? 0.35 : 1,
            filter: b.skipped ? 'grayscale(1)' : undefined,
            transition: 'opacity 0.3s',
          }}>
            🚀
          </div>
        )
      })}

      {/* Ocean strip */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: '18%',
        background: 'linear-gradient(180deg, rgba(14,165,233,0.18) 0%, rgba(2,6,23,0.9) 100%)',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 4,
          background: 'repeating-linear-gradient(90deg, transparent 0px, transparent 18px, rgba(56,189,248,0.22) 18px, rgba(56,189,248,0.22) 36px)',
          animation: 'amWave 3s ease-in-out infinite',
        }} />
      </div>

      {/* Aircraft carrier */}
      <div style={{
        position: 'absolute', right: '3%', bottom: '17%',
        fontSize: 22, lineHeight: 1,
        filter: isLanded ? 'drop-shadow(0 0 10px #fbbf24)' : undefined,
        transition: 'filter 0.4s',
      }}>
        🚢
      </div>

      {/* Plane */}
      <div style={{
        position: 'absolute', left: `${planeX}%`, top: `${planeY}%`,
        transform: 'translate(-50%, -50%)',
        fontSize: 24, lineHeight: 1,
        animation:  isFlying   ? 'amPlaneFly 0.8s ease-in-out infinite' : 'none',
        filter:     isSplashed ? undefined : `drop-shadow(0 0 8px ${color})`,
        transition: isFlying   ? 'left 0.18s linear, top 0.18s linear' : 'none',
      }}>
        {isSplashed ? '🌊' : isLanded ? '🛬' : '🛩️'}
      </div>

      {/* Counter Balance readout */}
      <div style={{
        position: 'absolute', top: '38%', left: '50%',
        transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none',
      }}>
        <div
          key={`${multiplier}-${flashKind}`}
          style={{
            fontSize: 54, fontWeight: 900, color, lineHeight: 1,
            textShadow: `0 0 28px ${color}80`, letterSpacing: '-2px',
            animation: flashKind && isFlying ? 'amBump 0.28s ease-out' : 'none',
          }}>
          {multiplier.toFixed(2)}×
        </div>
        {isFlying && bet != null && (
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
            Bet: {bet.toLocaleString()} coins
          </div>
        )}
        {isSplashed && (
          <div style={{ fontSize: 11, fontWeight: 700, color: '#f87171', letterSpacing: 3, marginTop: 4, textTransform: 'uppercase' }}>
            SPLASH
          </div>
        )}
      </div>
    </div>
  )
}

// ── Speed options ──────────────────────────────────────────────────────────────
const SPEED_OPTIONS = [
  { key: 'tortoise',  label: '🐢' },
  { key: 'walking',   label: '🚶' },
  { key: 'hare',      label: '🐇' },
  { key: 'lightning', label: '⚡' },
]

// ── BettingPanel ───────────────────────────────────────────────────────────────
function BettingPanel({ bet, onBet, balance, speed, onSpeed }) {
  return (
    <div className="bg-cp-card border border-cp-border rounded-2xl p-4 flex flex-col gap-4">
      <BetChips bet={bet} onBet={onBet} balance={balance} disabled={false} />
      <div className="flex items-center justify-between">
        <span className="text-cp-muted text-sm font-semibold">Speed</span>
        <div className="flex gap-2">
          {SPEED_OPTIONS.map(opt => (
            <button key={opt.key} onClick={() => onSpeed(opt.key)}
              className={`w-10 h-10 rounded-xl text-lg transition-all active:scale-95 border
                ${speed === opt.key
                  ? 'bg-amber-400 border-amber-300'
                  : 'bg-cp-elevated border-cp-border hover:border-amber-400/40'}`}
              title={opt.key}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── ResultPanel ────────────────────────────────────────────────────────────────
function ResultPanel({ phase, multiplier, bet, wonAmount, onPlayAgain }) {
  const isLanded = phase === 'landed'
  return (
    <div className="flex flex-col gap-3">
      <div className={`text-center rounded-xl border py-3 px-4
        ${isLanded ? 'border-emerald-400/30 bg-emerald-400/10' : 'border-red-400/30 bg-red-400/10'}`}>
        {isLanded ? (
          <>
            <p className="text-emerald-400 font-bold text-lg">Landed at {multiplier.toFixed(2)}× 🎉</p>
            <p className="text-emerald-300 text-sm font-semibold mt-0.5">
              {wonAmount >= 0 ? '+' : ''}{formatCoins(wonAmount)} coins
            </p>
          </>
        ) : (
          <>
            <p className="text-red-400 font-bold text-lg">Splashed 🌊 at {multiplier.toFixed(2)}×</p>
            <p className="text-cp-muted text-sm mt-0.5">Lost {formatCoins(bet)} coins</p>
          </>
        )}
      </div>
      <button onClick={onPlayAgain}
        className="w-full py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95">
        Play Again
      </button>
    </div>
  )
}

// ── AviamastersGame ────────────────────────────────────────────────────────────
export default function AviamastersGame() {
  const { balance, placeBet } = useCasino()

  const [phase,      setPhase]      = useState('betting')
  const [bet,        setBet]        = useState(50)
  const [speed,      setSpeed]      = useState('walking')
  const [multiplier, setMultiplier] = useState(1.00)
  const [eventIdx,   setEventIdx]   = useState(-1)
  const [flashKind,  setFlashKind]  = useState(null)
  const [gameResult, setGameResult] = useState(null)
  const [wonAmount,  setWonAmount]  = useState(0)

  const roundRef       = useRef(null)
  const idxRef         = useRef(-1)
  const multRef        = useRef(1.0)      // running multiplier — avoids stale closure in setInterval
  const totalEvtsRef   = useRef(0)
  const betRef         = useRef(bet)
  const balanceRef     = useRef(balance)
  const speedRef       = useRef(speed)
  const placeBetRef    = useRef(placeBet)
  const intervalRef    = useRef(null)

  useEffect(() => { betRef.current     = bet     }, [bet])
  useEffect(() => { balanceRef.current = balance }, [balance])
  useEffect(() => { speedRef.current   = speed   }, [speed])
  useEffect(() => { placeBetRef.current = placeBet }, [placeBet])

  // Inject keyframes once
  useEffect(() => {
    const id = 'aviamasters-kf2'
    if (document.getElementById(id)) return
    const s = document.createElement('style')
    s.id = id
    s.textContent = `
      @keyframes amPlaneFly {
        0%,100% { transform: translate(-50%,-50%) translateY(0) rotate(-8deg); }
        50%     { transform: translate(-50%,-50%) translateY(-4px) rotate(-13deg); }
      }
      @keyframes amBump {
        0%   { transform: translate(-50%,-50%) scale(1); }
        40%  { transform: translate(-50%,-50%) scale(1.18); }
        100% { transform: translate(-50%,-50%) scale(1); }
      }
      @keyframes amWave {
        0%,100% { transform: translateX(0); }
        50%     { transform: translateX(-18px); }
      }
    `
    document.head.appendChild(s)
  }, [])

  // Flight loop — reads from roundRef so it stays current after booster mutations
  useEffect(() => {
    if (phase !== 'flying') return
    const round    = roundRef.current
    const baseTick = SPEEDS[speedRef.current] ?? SPEEDS.walking

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

      if (!ev.skipped) {
        let m = multRef.current
        if      (ev.kind === 'rocket') m = m / 2
        else if (ev.kind === 'mult')   m = Math.min(MAX_MULT, m * ev.value)
        else if (ev.kind === 'add')    m = Math.min(MAX_MULT, m + ev.value)
        m = Math.round(m * 100) / 100
        multRef.current = m
        setMultiplier(m)
        setFlashKind(ev.kind)
      }
    }, baseTick)

    return () => clearInterval(intervalRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  useEffect(() => () => clearInterval(intervalRef.current), [])

  function resolveRound(round) {
    const finalMult = multRef.current
    if (round.outcome === 'land') {
      const win    = Math.floor(betRef.current * Math.min(finalMult, MAX_MULT))
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

  function startFlight() {
    if ((balanceRef.current ?? 0) < betRef.current) return
    const round = generateRound()
    roundRef.current     = round
    idxRef.current       = -1
    multRef.current      = 1.0
    totalEvtsRef.current = round.events.length
    setEventIdx(-1)
    setMultiplier(1.00)
    setFlashKind(null)
    setGameResult(null)
    setWonAmount(0)
    setPhase('flying')
  }

  function handlePlayAgain() {
    clearInterval(intervalRef.current)
    idxRef.current  = -1
    multRef.current = 1.0
    setPhase('betting')
    setMultiplier(1.00)
    setEventIdx(-1)
    setFlashKind(null)
    setGameResult(null)
    setWonAmount(0)
  }

  if (balance === null) {
    return (
      <GameLayout title="Aviamasters">
        <div className="flex items-center justify-center h-48">
          <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        </div>
      </GameLayout>
    )
  }

  const isBetting = phase === 'betting'
  const isFlying  = phase === 'flying'
  const isResult  = phase === 'landed' || phase === 'splashed'

  const total  = totalEvtsRef.current || 1
  const planeT = isResult ? 1 : isFlying ? Math.min(1, (eventIdx + 1) / total) : 0

  const round  = roundRef.current
  const badges = (round?.events ?? []).map((ev, i) => ({
    ...ev,
    t:         (i + 1) / (round.events.length || 1),
    collected: i <= eventIdx,
  }))

  return (
    <GameLayout title="Aviamasters">
      <div className="flex flex-col items-center gap-5">

        <GameBoard
          phase={phase}
          planeT={planeT}
          badges={badges}
          multiplier={multiplier}
          flashKind={flashKind}
          bet={bet}
        />

        <div className="w-full max-w-md flex flex-col gap-4">
          {isBetting && (
            <BettingPanel
              bet={bet} onBet={setBet}
              balance={balance}
              speed={speed} onSpeed={setSpeed}
            />
          )}

          {isBetting && (
            <button
              onClick={startFlight}
              disabled={(balance ?? 0) < bet}
              className={`w-full py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
                ${(balance ?? 0) < bet
                  ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                  : 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_24px_rgba(251,191,36,0.3)] hover:shadow-[0_0_32px_rgba(251,191,36,0.45)] active:scale-95'}`}
            >
              Spin! 🛩️
            </button>
          )}

          {isFlying && (
            <div className="w-full py-3.5 rounded-2xl font-bold text-center bg-cp-elevated border border-cp-border flex items-center justify-center gap-2">
              <span className="text-cp-muted">In flight…</span>
              <span className="text-amber-400">{multiplier.toFixed(2)}×</span>
            </div>
          )}

          {isResult && (
            <ResultPanel
              phase={phase}
              multiplier={multiplier}
              bet={bet}
              wonAmount={wonAmount}
              onPlayAgain={handlePlayAgain}
            />
          )}
        </div>

        {isResult && (
          <div className="w-full max-w-md">
            <ResultBanner
              result={gameResult}
              amount={wonAmount}
              message={phase === 'landed'
                ? `Landed at ${multiplier.toFixed(2)}×`
                : `Splashed at ${multiplier.toFixed(2)}×`}
            />
          </div>
        )}
      </div>
    </GameLayout>
  )
}
```

- [ ] **Step 2: Start the dev server and verify the game loads and plays**

```bash
npm run dev
```

Navigate to `/casino/aviamasters`. Check:
- Sky + stars + dashed bezier track visible
- Ocean strip at the bottom with wave animation
- Aircraft carrier (🚢) on the right
- Spin button works; plane follows the curved path
- Counter Balance updates in flight with colour changes
- Win/loss result renders; Play Again resets correctly

- [ ] **Step 3: Stop dev server, commit**

```bash
git add src/pages/casino/AviamastersGame.jsx
git commit -m "feat(aviamasters): redesigned GameBoard with bezier curve + layered sky/ocean visual"
```

---

### Task 3: Add `BoosterBar` and wire `applyBooster` mid-flight

**Files:**
- Modify: `src/pages/casino/AviamastersGame.jsx`

- [ ] **Step 1: Add `BOOSTER_DEFS` constant and `BoosterBar` component** (insert before `AviamastersGame`)

```jsx
const BOOSTER_DEFS = [
  { key: 'laser_gun', icon: '🔫', label: 'Laser' },
  { key: 'magnet',    icon: '🧲', label: 'Magnet' },
  { key: 'nitro',     icon: '⚡',  label: 'Nitro' },
  { key: 'life_buoy', icon: '🛟',  label: 'Life Buoy' },
]

function BoosterBar({ usedBoosters, onActivate, isFlying }) {
  return (
    <div className="w-full max-w-md flex gap-2">
      {BOOSTER_DEFS.map(b => {
        const used = usedBoosters[b.key]
        return (
          <button
            key={b.key}
            onClick={() => isFlying && !used && onActivate(b.key)}
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl border
              text-center transition-all select-none
              ${used
                ? 'bg-cp-elevated border-cp-border opacity-40 cursor-default'
                : isFlying
                  ? 'bg-cp-elevated border-amber-400/40 hover:border-amber-400 hover:bg-amber-400/10 active:scale-95 cursor-pointer'
                  : 'bg-cp-elevated border-cp-border opacity-50 cursor-default'
              }`}
          >
            <span className="text-xl leading-none">{used ? '✓' : b.icon}</span>
            <span className="text-xs text-cp-muted font-semibold">{b.label}</span>
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Add booster + nitro state to `AviamastersGame`** (after existing `useState` declarations)

```jsx
const INITIAL_BOOSTERS = { laser_gun: false, magnet: false, nitro: false, life_buoy: false }

const [usedBoosters, setUsedBoosters] = useState(INITIAL_BOOSTERS)
const [nitroActive,  setNitroActive]  = useState(false)
const nitroActiveRef = useRef(false)
useEffect(() => { nitroActiveRef.current = nitroActive }, [nitroActive])
```

- [ ] **Step 3: Add `handleBoosterActivate` function** (add after `handlePlayAgain`)

```jsx
function handleBoosterActivate(kind) {
  if (!roundRef.current || usedBoosters[kind]) return
  const { events, outcome } = roundRef.current
  const result = applyBooster(events, idxRef.current, kind, outcome)
  roundRef.current = { ...roundRef.current, events: result.events, outcome: result.outcome }
  setUsedBoosters(prev => ({ ...prev, [kind]: true }))
  if (kind === 'nitro') setNitroActive(true)
}
```

- [ ] **Step 4: Make the flight loop use halved tick when nitro is active**

Change the flight loop `useEffect` dependency array and tick calculation:

```jsx
useEffect(() => {
  if (phase !== 'flying') return
  const round    = roundRef.current
  const baseTick = SPEEDS[speedRef.current] ?? SPEEDS.walking
  const tick     = nitroActive ? Math.floor(baseTick / 2) : baseTick  // halve on nitro

  intervalRef.current = setInterval(() => {
    // ... same body as Task 2 ...
  }, tick)

  return () => clearInterval(intervalRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [phase, nitroActive])   // add nitroActive
```

- [ ] **Step 5: Reset boosters in `startFlight` and `handlePlayAgain`**

In `startFlight`, add after `setPhase('flying')`:
```jsx
setUsedBoosters(INITIAL_BOOSTERS)
setNitroActive(false)
```

In `handlePlayAgain`, add:
```jsx
setUsedBoosters(INITIAL_BOOSTERS)
setNitroActive(false)
```

- [ ] **Step 6: Render `<BoosterBar>` in the JSX** (add after `<GameBoard>`, before the controls div)

```jsx
<BoosterBar
  usedBoosters={usedBoosters}
  onActivate={handleBoosterActivate}
  isFlying={isFlying}
/>
```

- [ ] **Step 7: Verify in browser**

```bash
npm run dev
```

- Booster bar is visible in all phases (greyed when not flying)
- During flight, tap Laser Gun — next 🚀 does nothing to the counter, badge greys out
- Tap Magnet — next 🚀 becomes a green `+0.5` badge
- Tap Nitro — remaining rockets greyed/skipped, animation noticeably faster
- Tap Life Buoy — if the round would have splashed, it lands instead

- [ ] **Step 8: Commit**

```bash
git add src/pages/casino/AviamastersGame.jsx
git commit -m "feat(aviamasters): add BoosterBar with all 4 boosters wired mid-flight"
```

---

### Task 4: Safe Landing toggle

**Files:**
- Modify: `src/pages/casino/AviamastersGame.jsx`

- [ ] **Step 1: Add `safeLanding` state and ref** (after existing `useState` declarations)

```jsx
const [safeLanding, setSafeLanding] = useState(false)
const safeLandingRef = useRef(false)
useEffect(() => { safeLandingRef.current = safeLanding }, [safeLanding])
```

- [ ] **Step 2: Replace the `BettingPanel` component definition with a version that includes the Safe Landing toggle**

```jsx
function BettingPanel({ bet, onBet, balance, speed, onSpeed, safeLanding, onSafeLanding }) {
  const safeCost  = bet * 50
  const canAfford = balance >= bet + safeCost
  return (
    <div className="bg-cp-card border border-cp-border rounded-2xl p-4 flex flex-col gap-4">
      <BetChips bet={bet} onBet={onBet} balance={balance} disabled={false} />

      <div className="flex items-center justify-between">
        <span className="text-cp-muted text-sm font-semibold">Speed</span>
        <div className="flex gap-2">
          {SPEED_OPTIONS.map(opt => (
            <button key={opt.key} onClick={() => onSpeed(opt.key)}
              className={`w-10 h-10 rounded-xl text-lg transition-all active:scale-95 border
                ${speed === opt.key
                  ? 'bg-amber-400 border-amber-300'
                  : 'bg-cp-elevated border-cp-border hover:border-amber-400/40'}`}
              title={opt.key}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Safe Landing toggle */}
      <label className={`flex items-center justify-between gap-3 cursor-pointer select-none
        rounded-xl px-3 py-2.5 border transition-all
        ${safeLanding ? 'border-sky-400/40 bg-sky-400/5' : 'border-cp-border bg-cp-elevated'}
        ${!canAfford ? 'opacity-40 cursor-not-allowed' : ''}`}>
        <div>
          <p className="text-sm font-semibold text-cp-text">🛡️ Safe Landing</p>
          <p className="text-xs text-cp-muted mt-0.5">
            +{safeCost.toLocaleString()} coins · win guaranteed even on splash
          </p>
        </div>
        <input
          type="checkbox"
          checked={safeLanding}
          disabled={!canAfford}
          onChange={e => onSafeLanding(e.target.checked)}
          className="w-4 h-4 accent-sky-400 cursor-pointer"
        />
      </label>
    </div>
  )
}
```

- [ ] **Step 3: Update `startFlight` to use `totalBet`**

Replace the `startFlight` function:

```jsx
function startFlight() {
  const totalBet = betRef.current + (safeLandingRef.current ? betRef.current * 50 : 0)
  if ((balanceRef.current ?? 0) < totalBet) return
  const round = generateRound()
  roundRef.current     = round
  idxRef.current       = -1
  multRef.current      = 1.0
  totalEvtsRef.current = round.events.length
  setEventIdx(-1)
  setMultiplier(1.00)
  setFlashKind(null)
  setGameResult(null)
  setWonAmount(0)
  setUsedBoosters(INITIAL_BOOSTERS)
  setNitroActive(false)
  setPhase('flying')
}
```

- [ ] **Step 4: Update `resolveRound` to handle Safe Landing and `totalBet`**

Replace the `resolveRound` function:

```jsx
function resolveRound(round) {
  const finalMult        = multRef.current
  const totalBet         = betRef.current + (safeLandingRef.current ? betRef.current * 50 : 0)
  const effectiveOutcome = (round.outcome === 'splash' && safeLandingRef.current) ? 'land' : round.outcome

  if (effectiveOutcome === 'land') {
    const win    = Math.floor(betRef.current * Math.min(finalMult, MAX_MULT))
    const profit = win - totalBet
    setGameResult('win')
    setWonAmount(profit)
    setPhase('landed')
    placeBetRef.current('aviamasters', totalBet, profit)
  } else {
    setGameResult('loss')
    setWonAmount(totalBet)
    setPhase('splashed')
    placeBetRef.current('aviamasters', totalBet, -totalBet)
  }
}
```

- [ ] **Step 5: Update the `BettingPanel` usage in the JSX to pass new props**

```jsx
<BettingPanel
  bet={bet} onBet={setBet}
  balance={balance}
  speed={speed} onSpeed={setSpeed}
  safeLanding={safeLanding} onSafeLanding={setSafeLanding}
/>
```

Also update the Spin button's `disabled` check:
```jsx
disabled={(balance ?? 0) < bet + (safeLanding ? bet * 50 : 0)}
```

- [ ] **Step 6: Verify in browser**

- Toggle Safe Landing on; cost shows correctly (bet=50 → cost=2,500)
- Toggle greyed out when balance < bet * 51
- With Safe Landing enabled, a splash round resolves as a landing (win)

- [ ] **Step 7: Commit**

```bash
git add src/pages/casino/AviamastersGame.jsx
git commit -m "feat(aviamasters): add Safe Landing toggle with 50× bet insurance cost"
```

---

### Task 5: `WinPopup` — Big / Mega / Super Mega Win overlay

**Files:**
- Modify: `src/pages/casino/AviamastersGame.jsx`

- [ ] **Step 1: Add `WIN_TIER_META` and `WinPopup` component** (insert before `AviamastersGame`)

```jsx
const WIN_TIER_META = {
  BIG:        { label: 'BIG WIN',        color: '#fbbf24', glow: 'rgba(251,191,36,0.55)',  bg: 'rgba(251,191,36,0.10)' },
  MEGA:       { label: 'MEGA WIN',       color: '#f97316', glow: 'rgba(249,115,22,0.55)',  bg: 'rgba(249,115,22,0.10)' },
  SUPER_MEGA: { label: 'SUPER MEGA WIN', color: '#ef4444', glow: 'rgba(239,68,68,0.55)',   bg: 'rgba(239,68,68,0.10)'  },
}

function WinPopup({ tier, multiplier, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 2500)
    return () => clearTimeout(t)
  }, [onDismiss])

  const meta = WIN_TIER_META[tier]
  if (!meta) return null

  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'amWinIn 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards',
        cursor: 'pointer',
      }}
    >
      <div style={{
        textAlign: 'center', padding: '48px 56px',
        borderRadius: 24, border: `2px solid ${meta.color}40`,
        background: meta.bg,
        boxShadow: `0 0 80px ${meta.glow}`,
        animation: tier === 'SUPER_MEGA' ? 'amShimmer 1.2s ease-in-out infinite' : 'none',
      }}>
        <div style={{ fontSize: 52, marginBottom: 12 }}>🏆</div>
        <div style={{
          fontSize: 34, fontWeight: 900, color: meta.color,
          letterSpacing: 3, textTransform: 'uppercase',
        }}>
          {meta.label}
        </div>
        <div style={{
          fontSize: 52, fontWeight: 900, color: '#fff',
          marginTop: 10, letterSpacing: -1,
        }}>
          {multiplier.toFixed(2)}×
        </div>
        <p style={{ marginTop: 18, fontSize: 11, color: '#6b7280' }}>tap to dismiss</p>
      </div>
      <style>{`
        @keyframes amWinIn {
          from { opacity:0; transform:scale(0.72); }
          to   { opacity:1; transform:scale(1);    }
        }
        @keyframes amShimmer {
          0%,100% { box-shadow: 0 0 80px ${meta.glow}; }
          50%     { box-shadow: 0 0 130px ${meta.glow}, 0 0 180px ${meta.glow}; }
        }
      `}</style>
    </div>
  )
}
```

- [ ] **Step 2: Add `winTier` state** (after existing `useState` declarations in `AviamastersGame`)

```jsx
const [winTier, setWinTier] = useState(null)
```

- [ ] **Step 3: Set `winTier` in `resolveRound`** (inside the `effectiveOutcome === 'land'` branch, after `setPhase('landed')`)

```jsx
// Show win tier popup
if      (finalMult >= WIN_TIERS.SUPER_MEGA) setWinTier('SUPER_MEGA')
else if (finalMult >= WIN_TIERS.MEGA)       setWinTier('MEGA')
else if (finalMult >= WIN_TIERS.BIG)        setWinTier('BIG')
```

- [ ] **Step 4: Reset `winTier` in `handlePlayAgain`**

```jsx
setWinTier(null)
```

- [ ] **Step 5: Render `<WinPopup>` in the JSX** (add at the very bottom, outside all other containers)

```jsx
{winTier && (
  <WinPopup
    tier={winTier}
    multiplier={multiplier}
    onDismiss={() => setWinTier(null)}
  />
)}
```

- [ ] **Step 6: Verify in browser**

To test easily without waiting for a lucky roll: temporarily change `WIN_TIERS.BIG` to `1.05` in `aviamastersEngine.js`, run a round, verify the popup appears with correct styling, auto-dismisses after 2.5s, and dismisses on click. Revert the temporary change.

- [ ] **Step 7: Commit**

```bash
git add src/pages/casino/AviamastersGame.jsx
git commit -m "feat(aviamasters): add Big / Mega / Super Mega Win popup overlay"
```

---

### Task 6: Autoplay

**Files:**
- Modify: `src/pages/casino/AviamastersGame.jsx`

- [ ] **Step 1: Add autoplay state** (after existing `useState` declarations)

```jsx
const [autoRounds,      setAutoRounds]      = useState(0)   // >0 = running
const [autoStartPending, setAutoStartPending] = useState(false)
const autoRoundsRef = useRef(0)
useEffect(() => { autoRoundsRef.current = autoRounds }, [autoRounds])
```

- [ ] **Step 2: Add `useEffect` that triggers the next autoplay round**

Add this effect (it must come after `startFlight` is defined — place it just before the loading guard):

```jsx
useEffect(() => {
  if (!autoStartPending) return
  setAutoStartPending(false)
  startFlight()
  // startFlight reads balanceRef/betRef/safeLandingRef — always current
}, [autoStartPending]) // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: Trigger next round from `resolveRound`** (add at the very end of `resolveRound`, after all existing code)

```jsx
// Autoplay: queue next round or stop
if (autoRoundsRef.current > 1) {
  setTimeout(() => {
    setAutoRounds(prev => prev - 1)
    setAutoStartPending(true)
  }, 900)
} else {
  setAutoRounds(0)
}
```

- [ ] **Step 4: Stop autoplay on Super Mega Win** (in the `WIN_TIERS.SUPER_MEGA` branch of `resolveRound`)

```jsx
if (finalMult >= WIN_TIERS.SUPER_MEGA) {
  setWinTier('SUPER_MEGA')
  setAutoRounds(0)  // pause autoplay for Super Mega — player must manually continue
}
```

- [ ] **Step 5: Replace the `BettingPanel` definition to add the Autoplay row**

Add `onAutoRounds` to the prop signature and add the row after the Safe Landing toggle:

```jsx
function BettingPanel({ bet, onBet, balance, speed, onSpeed, safeLanding, onSafeLanding, onAutoRounds }) {
  const safeCost  = bet * 50
  const canAfford = balance >= bet + safeCost
  return (
    <div className="bg-cp-card border border-cp-border rounded-2xl p-4 flex flex-col gap-4">
      <BetChips bet={bet} onBet={onBet} balance={balance} disabled={false} />

      <div className="flex items-center justify-between">
        <span className="text-cp-muted text-sm font-semibold">Speed</span>
        <div className="flex gap-2">
          {SPEED_OPTIONS.map(opt => (
            <button key={opt.key} onClick={() => onSpeed(opt.key)}
              className={`w-10 h-10 rounded-xl text-lg transition-all active:scale-95 border
                ${speed === opt.key
                  ? 'bg-amber-400 border-amber-300'
                  : 'bg-cp-elevated border-cp-border hover:border-amber-400/40'}`}
              title={opt.key}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Safe Landing toggle */}
      <label className={`flex items-center justify-between gap-3 cursor-pointer select-none
        rounded-xl px-3 py-2.5 border transition-all
        ${safeLanding ? 'border-sky-400/40 bg-sky-400/5' : 'border-cp-border bg-cp-elevated'}
        ${!canAfford ? 'opacity-40 cursor-not-allowed' : ''}`}>
        <div>
          <p className="text-sm font-semibold text-cp-text">🛡️ Safe Landing</p>
          <p className="text-xs text-cp-muted mt-0.5">
            +{safeCost.toLocaleString()} coins · win guaranteed even on splash
          </p>
        </div>
        <input
          type="checkbox"
          checked={safeLanding}
          disabled={!canAfford}
          onChange={e => onSafeLanding(e.target.checked)}
          className="w-4 h-4 accent-sky-400 cursor-pointer"
        />
      </label>

      {/* Autoplay presets */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-cp-muted">Autoplay</span>
        <div className="flex gap-1.5">
          {[5, 10, 25, 50].map(n => (
            <button key={n} onClick={() => onAutoRounds(n)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold border border-cp-border bg-cp-elevated
                hover:border-amber-400/40 hover:bg-amber-400/8 text-cp-muted hover:text-amber-400 transition-all">
              {n}×
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Update `BettingPanel` usage in JSX** — add `onAutoRounds` prop

```jsx
<BettingPanel
  bet={bet} onBet={setBet}
  balance={balance}
  speed={speed} onSpeed={setSpeed}
  safeLanding={safeLanding} onSafeLanding={setSafeLanding}
  onAutoRounds={count => { setAutoRounds(count); startFlight() }}
/>
```

- [ ] **Step 7: Replace the Spin button block with one that shows "Stop Auto" during autoplay**

```jsx
{isBetting && (
  autoRounds > 0 ? (
    <button
      onClick={() => setAutoRounds(0)}
      className="w-full py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
        bg-red-400/20 border border-red-400/40 text-red-400 hover:bg-red-400/30 active:scale-95"
    >
      Stop Auto ({autoRounds} left)
    </button>
  ) : (
    <button
      onClick={startFlight}
      disabled={(balance ?? 0) < bet + (safeLanding ? bet * 50 : 0)}
      className={`w-full py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
        ${(balance ?? 0) < bet + (safeLanding ? bet * 50 : 0)
          ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
          : 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_24px_rgba(251,191,36,0.3)] hover:shadow-[0_0_32px_rgba(251,191,36,0.45)] active:scale-95'}`}
    >
      Spin! 🛩️
    </button>
  )
)}
```

- [ ] **Step 8: Update the in-flight status bar to show autoplay count**

```jsx
{isFlying && (
  <div className="w-full py-3.5 rounded-2xl font-bold text-center bg-cp-elevated border border-cp-border flex items-center justify-center gap-2">
    <span className="text-cp-muted">In flight…</span>
    <span className="text-amber-400">{multiplier.toFixed(2)}×</span>
    {autoRounds > 0 && (
      <span className="text-xs text-cp-muted font-normal">· Auto {autoRounds}</span>
    )}
  </div>
)}
```

- [ ] **Step 9: Reset autoplay in `handlePlayAgain`**

```jsx
setAutoRounds(0)
setAutoStartPending(false)
```

- [ ] **Step 10: Verify in browser**

- Click "5×" autoplay — 5 rounds run automatically with ~0.9s between each
- "Stop Auto (N left)" button halts it immediately
- Autoplay stops when balance drops below the bet
- Super Mega Win stops autoplay and shows the popup

- [ ] **Step 11: Commit**

```bash
git add src/pages/casino/AviamastersGame.jsx
git commit -m "feat(aviamasters): add Autoplay with 5/10/25/50 round presets"
```

---

### Task 7: Final verification pass

**Files:**
- None (read-only verification task)

- [ ] **Step 1: Run the full test suite**

```bash
node --test src/pages/casino/aviamastersEngine.test.js
```

Expected: all tests pass (original 4 + new 4 = 8 total).

- [ ] **Step 2: Build check**

```bash
npm run build
```

Expected: build completes with no errors.

- [ ] **Step 3: Manual smoke test in browser**

```bash
npm run dev
```

Work through this checklist:
- [ ] Sky gradient + stars render in the upper portion
- [ ] Dashed bezier track visible from bottom-left to top-right
- [ ] Ocean strip at the bottom with wave animation
- [ ] Aircraft carrier (🚢) glows amber when plane lands
- [ ] Plane follows the curved path smoothly
- [ ] Counter Balance colour: green (<2×), amber (2–5×), orange (5×+), red on splash
- [ ] `amBump` animation fires on each event
- [ ] `add` badges render green, `mult` badges render amber, rockets render 🚀
- [ ] Badges fade after the plane passes them
- [ ] Laser Gun: next rocket has no counter effect; its badge greys out
- [ ] Magnet: next rocket badge becomes green `+0.5`; outcome flipped if splash
- [ ] Nitro: remaining rocket badges go grey/skipped; animation noticeably faster
- [ ] Life Buoy: splash becomes a win (test across several rounds)
- [ ] Safe Landing toggle shows correct cost; greyed when too poor
- [ ] Safe Landing: a splash resolves as a landing when enabled
- [ ] Big Win popup appears at ≥20×; auto-dismisses; click-dismisses
- [ ] Mega Win popup at ≥40×; Super Mega at ≥80× (stops autoplay)
- [ ] Autoplay 5× runs 5 rounds uninterrupted; "Stop Auto" halts it

- [ ] **Step 4: Commit if any minor fixes were made during testing**

```bash
git add src/pages/casino/AviamastersGame.jsx
git commit -m "fix(aviamasters): final polish from smoke test"
```
