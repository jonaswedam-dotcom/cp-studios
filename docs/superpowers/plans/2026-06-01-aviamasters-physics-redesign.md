# Aviamasters Physics & Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current emoji/SVG/setInterval Aviamasters game board with a canvas-based renderer and rAF physics loop where the plane continuously climbs on boosts, dives on rockets, and lands safely or crashes into the ocean.

**Architecture:** A new pure-JS file `aviamastersCanvas.js` holds all canvas drawing helpers and a catmull-rom spline evaluator. The `GameBoard` component becomes a canvas element whose draw loop reads refs at 60fps (zero React re-renders). The `setInterval` flight loop is replaced by a `requestAnimationFrame` physics loop that advances a continuous `planeTRef` and fires badge events by position. All game logic (engine, boosters, Safe Landing, Autoplay) is unchanged.

**Tech Stack:** React 18 (hooks + refs), HTML5 Canvas 2D API, `requestAnimationFrame`, catmull-rom spline math, existing `aviamastersEngine.js`

---

## File Map

| File | Change |
|------|--------|
| `src/pages/casino/aviamastersEngine.js` | Add `assignBadgePositions` |
| `src/pages/casino/aviamastersEngine.test.js` | Add 4 tests for `assignBadgePositions` |
| `src/pages/casino/aviamastersCanvas.js` | **CREATE** — all canvas drawing helpers + spline math |
| `src/pages/casino/AviamastersGame.jsx` | Replace `GameBoard` with canvas; replace `setInterval` with rAF physics loop |

---

### Task 1: Engine — `assignBadgePositions` (TDD)

**Files:**
- Modify: `src/pages/casino/aviamastersEngine.js`
- Modify: `src/pages/casino/aviamastersEngine.test.js`

- [ ] **Step 1: Write 4 failing tests**

Append to `src/pages/casino/aviamastersEngine.test.js`:

```js
import { assignBadgePositions } from './aviamastersEngine.js'

test('assignBadgePositions: land outcome produces end altitude >= 0.75', () => {
  const events = makeEvents('add', 'mult')
  const { controlPts } = assignBadgePositions(events, 'land')
  const last = controlPts[controlPts.length - 1]
  assert.ok(last.altitude >= 0.75, `expected >= 0.75 got ${last.altitude}`)
})

test('assignBadgePositions: splash outcome produces end altitude <= 0.15', () => {
  const events = makeEvents('rocket', 'add')
  const { controlPts } = assignBadgePositions(events, 'splash')
  const last = controlPts[controlPts.length - 1]
  assert.ok(last.altitude <= 0.15, `expected <= 0.15 got ${last.altitude}`)
})

test('assignBadgePositions: intermediate control points clamped to [0.08, 0.92]', () => {
  // Worst case: five consecutive rockets
  const events = makeEvents('rocket', 'rocket', 'rocket', 'rocket', 'rocket')
  const { controlPts } = assignBadgePositions(events, 'splash')
  const mid = controlPts.slice(1, -1)
  for (const pt of mid) {
    assert.ok(pt.altitude >= 0.08, `altitude ${pt.altitude} below 0.08`)
    assert.ok(pt.altitude <= 0.92, `altitude ${pt.altitude} above 0.92`)
  }
})

test('assignBadgePositions: badges have evenly spaced t-values and applied: false', () => {
  const events = makeEvents('add', 'rocket', 'mult')
  const { badges } = assignBadgePositions(events, 'land')
  assert.equal(badges.length, 3)
  assert.ok(Math.abs(badges[0].t - 1/4) < 0.001)
  assert.ok(Math.abs(badges[1].t - 2/4) < 0.001)
  assert.ok(Math.abs(badges[2].t - 3/4) < 0.001)
  for (const b of badges) assert.equal(b.applied, false)
})
```

- [ ] **Step 2: Run tests — confirm 4 failures**

```bash
node --test src/pages/casino/aviamastersEngine.test.js
```

Expected: 9 pass, 4 fail with `assignBadgePositions is not a function`.

- [ ] **Step 3: Implement `assignBadgePositions`**

Append to `src/pages/casino/aviamastersEngine.js`:

```js
// Pre-computes the catmull-rom spline control points and badge t-positions for one round.
// The trajectory climbs on boost/mult events and dives on rockets.
// End altitude is forced to match the pre-rolled outcome.
export function assignBadgePositions(events, outcome) {
  const N = events.length
  let altitude = 0.30  // takeoff altitude

  const controlPts = [{ x: 0, altitude }]

  events.forEach((ev, i) => {
    if (!ev.skipped) {
      if (ev.kind === 'rocket') {
        altitude -= 0.22
      } else if (ev.kind === 'mult') {
        altitude += Math.min((ev.value - 1) * 0.12, 0.28)
      } else if (ev.kind === 'add') {
        altitude += Math.min(ev.value * 0.18, 0.25)
      }
      altitude = Math.max(0.08, Math.min(0.92, altitude))
    }
    controlPts.push({ x: (i + 1) / (N + 1), altitude })
  })

  controlPts.push({ x: 1.0, altitude: outcome === 'land' ? 0.82 : 0.06 })

  const badges = events.map((ev, i) => ({
    ...ev,
    t: (i + 1) / (N + 1),
    applied: false,
  }))

  return { controlPts, badges }
}
```

- [ ] **Step 4: Run tests — all 13 must pass**

```bash
node --test src/pages/casino/aviamastersEngine.test.js
```

Expected: 13 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/pages/casino/aviamastersEngine.js src/pages/casino/aviamastersEngine.test.js
git commit -m "feat(aviamasters): add assignBadgePositions to engine (TDD)"
```

---

### Task 2: Create `aviamastersCanvas.js` — drawing helpers + spline

**Files:**
- Create: `src/pages/casino/aviamastersCanvas.js`

- [ ] **Step 1: Create the file with spline math + coordinate helpers**

```js
// ── Canvas constants ──────────────────────────────────────────────────────────
export const CANVAS_W = 800
export const CANVAS_H = 440

// Canvas y-coordinates for altitude extremes
const RUNWAY_Y = CANVAS_H * 0.74   // altitude 1.0 → runway height
const WATER_Y  = CANVAS_H * 0.84   // altitude 0.0 → ocean crash level
const LEFT_X   = CANVAS_W * 0.08   // x=0 in spline → canvas left margin
const RIGHT_X  = CANVAS_W * 0.90   // x=1 in spline → canvas right margin

// ── Spline math ───────────────────────────────────────────────────────────────

// Evaluate a catmull-rom spline at t ∈ [0,1] through controlPts [{x, altitude}].
export function splinePoint(t, controlPts) {
  const n = controlPts.length
  if (n < 2) return controlPts[0] || { x: 0, altitude: 0.5 }

  const tc   = Math.max(0, Math.min(1, t))
  const segs = n - 1
  const raw  = tc * segs
  const seg  = Math.min(Math.floor(raw), segs - 1)
  const lt   = raw - seg

  const p0 = controlPts[Math.max(0, seg - 1)]
  const p1 = controlPts[seg]
  const p2 = controlPts[Math.min(n - 1, seg + 1)]
  const p3 = controlPts[Math.min(n - 1, seg + 2)]

  const lt2 = lt * lt
  const lt3 = lt2 * lt

  const interp = (a, b, c, d) =>
    0.5 * (2*b + (-a+c)*lt + (2*a-5*b+4*c-d)*lt2 + (-a+3*b-3*c+d)*lt3)

  return {
    x:        interp(p0.x,        p1.x,        p2.x,        p3.x),
    altitude: interp(p0.altitude, p1.altitude, p2.altitude, p3.altitude),
  }
}

// Convert spline {x, altitude} to canvas pixel {cx, cy}.
export function splineToCanvas(pt) {
  return {
    cx: LEFT_X + pt.x * (RIGHT_X - LEFT_X),
    cy: WATER_Y - pt.altitude * (WATER_Y - RUNWAY_Y),
  }
}
```

- [ ] **Step 2: Add static scene data (stars, cloud templates)**

Append to the file:

```js
// ── Static scene data ─────────────────────────────────────────────────────────

// Deterministic star positions (no Math.random — stable across renders)
export const STARS = Array.from({ length: 25 }, (_, i) => ({
  xFrac: ((i * 97 + 13) * 31 % 10000) / 10000,
  yFrac: ((i * 61 + 7)  * 17 % 4000)  / 10000,
  r:     i % 4 === 0 ? 1.5 : 0.8,
  op:    0.25 + (i % 5) * 0.08,
}))

// Cloud shape templates (fractions of W/H; drift horizontally with cloudOffset)
export const CLOUD_TEMPLATES = [
  { xFrac: 0.25, yFrac: 0.13, blobs: [{dx:0,dy:0,r:26},{dx:22,dy:-8,r:20},{dx:-18,dy:-5,r:18}] },
  { xFrac: 0.68, yFrac: 0.21, blobs: [{dx:0,dy:0,r:20},{dx:18,dy:-6,r:16},{dx:-14,dy:-4,r:14}] },
]
```

- [ ] **Step 3: Add `drawBackground`**

Append to the file:

```js
// ── Drawing helpers ───────────────────────────────────────────────────────────

function drawCloud(ctx, cx, cy, blobs) {
  ctx.save()
  ctx.globalAlpha = 0.18
  ctx.fillStyle = '#ffffff'
  for (const { dx, dy, r } of blobs) {
    ctx.beginPath()
    ctx.arc(cx + dx, cy + dy, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function drawBackground(ctx, cloudOffset, time) {
  const W = CANVAS_W, H = CANVAS_H

  // Sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.78)
  sky.addColorStop(0,   '#050d1a')
  sky.addColorStop(0.6, '#0a1828')
  sky.addColorStop(1,   '#0a2040')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H * 0.78)

  // Stars
  for (const s of STARS) {
    ctx.globalAlpha = s.op
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(s.xFrac * W, s.yFrac * H, s.r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // Drifting clouds
  for (const cloud of CLOUD_TEMPLATES) {
    let x = cloud.xFrac * W - cloudOffset % (W + 200)
    if (x < -100) x += W + 200
    drawCloud(ctx, x, cloud.yFrac * H, cloud.blobs)
  }

  // Horizon glow
  const hz = ctx.createLinearGradient(0, H * 0.72, 0, H * 0.78)
  hz.addColorStop(0, 'rgba(0,180,200,0.07)')
  hz.addColorStop(1, 'rgba(0,180,200,0)')
  ctx.fillStyle = hz
  ctx.fillRect(0, H * 0.72, W, H * 0.06)

  // Ocean
  const ocean = ctx.createLinearGradient(0, H * 0.78, 0, H)
  ocean.addColorStop(0, '#0a3050')
  ocean.addColorStop(1, '#051525')
  ctx.fillStyle = ocean
  ctx.fillRect(0, H * 0.78, W, H * 0.22)

  // Animated foam line
  ctx.strokeStyle = 'rgba(148,210,235,0.35)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let x = 0; x <= W; x += 4) {
    const y = H * 0.785 + Math.sin(x / W * Math.PI * 6 + time * 1.5) * 2
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.stroke()
}
```

- [ ] **Step 4: Add `drawIsland`**

Append to the file:

```js
function drawPalm(ctx, x, y) {
  ctx.strokeStyle = '#5c3d1e'
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.quadraticCurveTo(x + 4, y - 10, x + 2, y - 20)
  ctx.stroke()

  ctx.strokeStyle = '#4ade80'
  ctx.lineWidth = 1.5
  for (const [dx, dy] of [[-12,-6],[8,-8],[12,2],[-6,6],[0,-10]]) {
    ctx.beginPath()
    ctx.moveTo(x + 2, y - 20)
    ctx.lineTo(x + 2 + dx, y - 20 + dy)
    ctx.stroke()
  }
}

export function drawIsland(ctx, side, glowing) {
  const W = CANVAS_W, H = CANVAS_H
  const isLeft  = side === 'left'
  const centerX = isLeft ? W * 0.05 : W * 0.91
  const halfW   = isLeft ? W * 0.055 : W * 0.065
  const topY    = H * 0.79
  const baseY   = H * 0.88

  if (glowing) {
    ctx.shadowBlur = 22
    ctx.shadowColor = '#fbbf24'
  }

  // Island body
  ctx.fillStyle = '#2d4a1e'
  ctx.beginPath()
  ctx.moveTo(centerX - halfW * 0.6, topY)
  ctx.lineTo(centerX + halfW * 0.6, topY)
  ctx.lineTo(centerX + halfW, baseY)
  ctx.lineTo(centerX - halfW, baseY)
  ctx.closePath()
  ctx.fill()

  // Sandy top
  ctx.fillStyle = '#8b7355'
  ctx.beginPath()
  ctx.ellipse(centerX, topY, halfW * 0.55, H * 0.012, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.shadowBlur = 0

  // Runway stripe
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillRect(centerX - halfW * 0.45, topY - 2, halfW * 0.9, 4)

  // Palm trees
  const palmCount = isLeft ? 1 : 2
  for (let i = 0; i < palmCount; i++) {
    const px = centerX + (palmCount === 1 ? halfW * 0.25 : (i === 0 ? -halfW * 0.3 : halfW * 0.3))
    drawPalm(ctx, px, topY)
  }
}
```

- [ ] **Step 5: Add `drawPlane`**

Append to the file:

```js
export function drawPlane(ctx, cx, cy, angle, propAngle, flashKind) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)

  // Flash halo
  if (flashKind === 'boost') {
    ctx.shadowBlur = 18
    ctx.shadowColor = '#fbbf24'
    ctx.strokeStyle = '#fbbf2480'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(0, 0, 18, 0, Math.PI * 2)
    ctx.stroke()
    ctx.shadowBlur = 0
  } else if (flashKind === 'rocket') {
    ctx.strokeStyle = '#f8717180'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(0, 0, 18, 0, Math.PI * 2)
    ctx.stroke()
  }

  // Engine glow (tail exhaust)
  ctx.globalAlpha = 0.55
  ctx.fillStyle = '#fbbf24'
  ctx.beginPath()
  ctx.arc(-20, 0, 3.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  // Swept wings (amber)
  ctx.fillStyle = '#d97706'
  // Upper wing
  ctx.beginPath()
  ctx.moveTo(4, -3); ctx.lineTo(-6, -3); ctx.lineTo(-12, -19); ctx.lineTo(0, -17)
  ctx.closePath(); ctx.fill()
  // Lower wing
  ctx.beginPath()
  ctx.moveTo(4, 3); ctx.lineTo(-6, 3); ctx.lineTo(-12, 19); ctx.lineTo(0, 17)
  ctx.closePath(); ctx.fill()

  // Tail fin
  ctx.fillStyle = '#b91c1c'
  ctx.beginPath()
  ctx.moveTo(-14, 0); ctx.lineTo(-21, -10); ctx.lineTo(-20, 0)
  ctx.closePath(); ctx.fill()

  // Fuselage (red ellipse)
  ctx.fillStyle = '#dc2626'
  ctx.beginPath()
  ctx.ellipse(0, 0, 18, 7, 0, 0, Math.PI * 2)
  ctx.fill()

  // Cockpit window
  ctx.fillStyle = '#60a5fa'
  ctx.beginPath()
  ctx.ellipse(7, -2, 4.5, 3.5, -0.3, 0, Math.PI * 2)
  ctx.fill()

  // Propeller (two blades, spinning)
  ctx.save()
  ctx.translate(18, 0)
  ctx.rotate(propAngle)
  ctx.fillStyle = '#374151'
  ctx.beginPath(); ctx.ellipse(0, 0, 9, 2.5, 0, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.ellipse(0, 0, 9, 2.5, Math.PI / 2, 0, Math.PI * 2); ctx.fill()
  ctx.restore()

  ctx.restore()
}
```

- [ ] **Step 6: Add `drawTrail`, `drawBadge`, `drawRocket`, `drawCounterBalance`**

Append to the file:

```js
// trailBuffer: [{cx, cy}], index 0 = oldest, index N-1 = newest
export function drawTrail(ctx, trailBuffer) {
  const n = trailBuffer.length
  if (n < 2) return
  for (let i = 0; i < n; i++) {
    const { cx, cy } = trailBuffer[i]
    const frac  = i / (n - 1)
    const alpha = frac * 0.5
    const r     = 1.5 + frac * 2.5
    const gray  = Math.round(120 + frac * 80)
    ctx.globalAlpha = alpha
    ctx.fillStyle = `rgb(${gray},${gray},${gray})`
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

export function drawBadge(ctx, cx, cy, kind, value, opacity, scale) {
  if (opacity < 0.01) return
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)

  const BW = 44, BH = 22, BR = 6
  const fill = kind === 'mult' ? '#fbbf24' : '#4ade80'
  const glow = kind === 'mult' ? 'rgba(251,191,36,0.6)' : 'rgba(74,222,128,0.5)'
  const label = kind === 'mult' ? `×${value}` : `+${value}`

  ctx.shadowBlur = 12
  ctx.shadowColor = glow
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.roundRect(-BW / 2, -BH / 2, BW, BH, BR)
  ctx.fill()

  ctx.shadowBlur = 0
  ctx.fillStyle = '#000'
  ctx.font = 'bold 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, 0, 0)

  ctx.restore()
}

export function drawRocket(ctx, cx, cy, opacity, showFlame) {
  if (opacity < 0.01) return
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.translate(cx, cy)
  // Rockets fly left-to-right (same direction as plane); nose points right
  const BL = 24, BH = 8

  // Exhaust flame (left of body)
  if (showFlame) {
    const flameGrad = ctx.createLinearGradient(-BL / 2, 0, -BL / 2 - 14, 0)
    flameGrad.addColorStop(0, 'rgba(251,146,60,0.9)')
    flameGrad.addColorStop(1, 'rgba(251,146,60,0)')
    ctx.fillStyle = flameGrad
    ctx.beginPath()
    ctx.ellipse(-BL / 2 - 7, 0, 10, 4, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // Body
  ctx.fillStyle = '#ef4444'
  ctx.beginPath()
  ctx.roundRect(-BL / 2, -BH / 2, BL, BH, 2)
  ctx.fill()

  // Nose cone (right)
  ctx.fillStyle = '#dc2626'
  ctx.beginPath()
  ctx.moveTo(BL / 2, -BH / 2)
  ctx.lineTo(BL / 2 + 9, 0)
  ctx.lineTo(BL / 2, BH / 2)
  ctx.closePath()
  ctx.fill()

  // Tail fins
  ctx.fillStyle = '#b91c1c'
  ctx.beginPath()
  ctx.moveTo(-BL / 2 + 4, -BH / 2)
  ctx.lineTo(-BL / 2 - 4, -BH / 2 - 7)
  ctx.lineTo(-BL / 2 + 8, -BH / 2)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-BL / 2 + 4, BH / 2)
  ctx.lineTo(-BL / 2 - 4, BH / 2 + 7)
  ctx.lineTo(-BL / 2 + 8, BH / 2)
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

export function drawCounterBalance(ctx, multiplier, splashed, flashScale, bet) {
  const W = CANVAS_W, H = CANVAS_H
  const color = splashed     ? '#f87171'
    : multiplier < 2         ? '#86efac'
    : multiplier < 5         ? '#fde68a'
    :                          '#fdba74'

  ctx.save()
  ctx.translate(W / 2, H * 0.30)
  ctx.scale(flashScale, flashScale)

  ctx.shadowBlur = 24
  ctx.shadowColor = color + '80'
  ctx.fillStyle = color
  ctx.font = '900 52px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${multiplier.toFixed(2)}×`, 0, 0)

  ctx.shadowBlur = 0
  ctx.font = '400 11px system-ui, sans-serif'
  ctx.fillStyle = splashed ? '#f87171' : '#6b7280'

  if (splashed) {
    ctx.fillText('SPLASH', 0, 38)
  } else if (bet != null) {
    ctx.fillText(`Bet: ${bet.toLocaleString()} coins`, 0, 38)
  }

  ctx.restore()
}
```

- [ ] **Step 7: Build check**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors (the file is not yet imported so no lint errors either).

- [ ] **Step 8: Commit**

```bash
git add src/pages/casino/aviamastersCanvas.js
git commit -m "feat(aviamasters): add canvas drawing helpers + catmull-rom spline (aviamastersCanvas.js)"
```

---

### Task 3: Rewrite `GameBoard` as a canvas component

This task replaces only the `GameBoard` function in `AviamastersGame.jsx`. Everything else in the file (BettingPanel, BoosterBar, WinPopup, ResultPanel, main component) is left exactly as-is for now.

**Files:**
- Modify: `src/pages/casino/AviamastersGame.jsx`

- [ ] **Step 1: Add imports at the top of `AviamastersGame.jsx`**

Replace the current import block at the top of the file with:

```jsx
import { useState, useEffect, useRef } from 'react'
import { GameLayout, BetChips, ResultBanner, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'
import {
  generateRound, SPEEDS, MAX_MULT, WIN_TIERS, applyBooster, assignBadgePositions,
} from './aviamastersEngine'
import {
  CANVAS_W, CANVAS_H,
  splinePoint, splineToCanvas,
  drawBackground, drawIsland, drawPlane, drawTrail,
  drawBadge, drawRocket, drawCounterBalance,
} from './aviamastersCanvas'
```

Remove these module-level constants that were previously in the file (they are now in `aviamastersCanvas.js` or replaced):
- `const P0`, `const P1`, `const P2` — delete
- `function bezierPoint(...)` — delete
- `function bezierTrailPoints(...)` — delete
- `const STARS = ...` — delete
- `function multColor(...)` — delete

- [ ] **Step 2: Add `T_SPEEDS` constant at module level** (after the imports)

```js
const T_SPEEDS = { tortoise: 0.12, walking: 0.20, hare: 0.35, lightning: 0.65 }
```

- [ ] **Step 3: Replace the `GameBoard` function entirely**

Find the existing `GameBoard` function (starts with `// ── GameBoard ──` comment) and replace it completely with:

```jsx
// ── GameBoard (canvas) ────────────────────────────────────────────────────────
function GameBoard({ phase, planeTRef, controlPtsRef, badgesRef, multRef, bet }) {
  const canvasRef    = useRef(null)
  const drawRafRef   = useRef(null)

  // Local animation state — all refs so the draw loop needs no React re-renders
  const propAngleRef  = useRef(0)
  const trailRef      = useRef([])       // [{cx, cy}], oldest first
  const cloudOffRef   = useRef(0)
  const timeRef       = useRef(0)
  const lastDrawRef   = useRef(null)
  const phaseRef      = useRef(phase)
  const flashRef      = useRef({ kind: null, timer: 0 })
  const flashScaleRef = useRef(1)
  const prevMultRef   = useRef(1)
  const fadeMapRef    = useRef({})       // { badgeIndex: opacity }

  // Sync phase into a ref (draw loop reads it without re-subscribing)
  useEffect(() => {
    if (phase === 'betting') {
      trailRef.current  = []
      fadeMapRef.current = {}
      prevMultRef.current = 1
    }
    phaseRef.current = phase
  }, [phase])

  // Apply HiDPI scaling once on mount
  useEffect(() => {
    const canvas = canvasRef.current
    const dpr    = window.devicePixelRatio || 1
    canvas.width  = CANVAS_W * dpr
    canvas.height = CANVAS_H * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
  }, [])

  // Draw loop — reads all game state from refs, never triggers React renders
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')

    function draw(ts) {
      if (!lastDrawRef.current) lastDrawRef.current = ts
      const dt = Math.min((ts - lastDrawRef.current) / 1000, 0.05)
      lastDrawRef.current = ts

      // Advance local animation timers
      propAngleRef.current  += 0.25
      cloudOffRef.current   += 8 * dt
      timeRef.current       += dt
      if (flashRef.current.timer > 0) {
        flashRef.current.timer = Math.max(0, flashRef.current.timer - dt)
      }

      const currentPhase = phaseRef.current
      const t            = planeTRef.current
      const controlPts   = controlPtsRef.current ?? []
      const badges       = badgesRef.current ?? []
      const mult         = multRef.current

      // Detect multiplier change → trigger flash
      if (mult !== prevMultRef.current) {
        flashRef.current = {
          kind:  mult > prevMultRef.current ? 'boost' : 'rocket',
          timer: 0.28,
        }
        prevMultRef.current = mult
      }

      // Update badge fade-out map
      badges.forEach((b, i) => {
        if (b.applied) {
          fadeMapRef.current[i] = Math.max(0.12, (fadeMapRef.current[i] ?? 1) - dt * 3)
        } else {
          if (fadeMapRef.current[i] === undefined) fadeMapRef.current[i] = 1
        }
      })

      // Update smoke trail during active flight
      if ((currentPhase === 'flying' || currentPhase === 'landed' || currentPhase === 'splashed')
          && controlPts.length >= 2) {
        const pt = splinePoint(Math.min(1, t), controlPts)
        const { cx, cy } = splineToCanvas(pt)
        trailRef.current.push({ cx, cy })
        if (trailRef.current.length > 45) trailRef.current.shift()
      }

      // ── DRAW ────────────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
      drawBackground(ctx, cloudOffRef.current, timeRef.current)
      drawIsland(ctx, 'left',  false)
      drawIsland(ctx, 'right', currentPhase === 'landed')

      if (currentPhase !== 'betting' && controlPts.length >= 2) {
        drawTrail(ctx, trailRef.current)

        // Badges
        badges.forEach((b, i) => {
          const pt         = splinePoint(b.t, controlPts)
          const { cx, cy } = splineToCanvas(pt)
          const opacity    = fadeMapRef.current[i] ?? 1
          const pulse      = b.applied ? 1 : 1 + 0.04 * Math.sin(timeRef.current * 4.2 + i)

          if (b.kind === 'rocket') {
            drawRocket(ctx, cx, cy, opacity, !b.skipped && !b.applied)
          } else {
            drawBadge(ctx, cx, cy, b.kind, b.value, opacity, pulse)
          }
        })

        // Plane
        const pt1 = splinePoint(Math.min(1, t), controlPts)
        const pt2 = splinePoint(Math.min(1, t + 0.008), controlPts)
        const { cx: x1, cy: y1 } = splineToCanvas(pt1)
        const { cx: x2, cy: y2 } = splineToCanvas(pt2)
        let angle = Math.atan2(y2 - y1, x2 - x1)

        // Nose-down on splash
        if (currentPhase === 'splashed') angle = Math.max(angle, 0.6)

        const flashKind = flashRef.current.timer > 0 ? flashRef.current.kind : null
        drawPlane(ctx, x1, y1, angle, propAngleRef.current, flashKind)
      }

      // Flash scale animation for counter balance
      if (flashRef.current.timer > 0) {
        flashScaleRef.current = 1 + 0.18 * (flashRef.current.timer / 0.28)
      } else {
        flashScaleRef.current = 1
      }
      drawCounterBalance(ctx, mult, currentPhase === 'splashed', flashScaleRef.current, bet)

      drawRafRef.current = requestAnimationFrame(draw)
    }

    drawRafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(drawRafRef.current)
  }, []) // empty — reads everything from refs

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        maxWidth: CANVAS_W,
        height: 'auto',
        borderRadius: 16,
        border: '1px solid #1f2937',
        display: 'block',
      }}
    />
  )
}
```

- [ ] **Step 4: Build check**

```bash
npm run build 2>&1 | tail -8
```

Expected: build succeeds. There may be a warning about `SPEEDS` being unused (it was used by the old setInterval loop) — that is fine for now; it will be cleaned up in Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/pages/casino/AviamastersGame.jsx
git commit -m "feat(aviamasters): replace GameBoard with canvas component (rAF draw loop)"
```

---

### Task 4: Replace `setInterval` flight loop with rAF physics loop

This task rewrites the flight mechanics inside `AviamastersGame` (the default export). `GameBoard`, `BettingPanel`, `BoosterBar`, `WinPopup`, and `ResultPanel` are not touched.

**Files:**
- Modify: `src/pages/casino/AviamastersGame.jsx`

- [ ] **Step 1: Replace the ref declarations block in `AviamastersGame`**

Find the block of `useRef` declarations (starting around `const roundRef = useRef(null)`) and replace it entirely with:

```jsx
  const roundRef        = useRef(null)
  // Physics refs (replace old idxRef / totalEvtsRef / intervalRef)
  const planeTRef       = useRef(0)
  const controlPtsRef   = useRef([])
  const badgesRef       = useRef([])
  const multRef         = useRef(1.0)
  const physicsRafRef   = useRef(null)
  const lastPhysicsRef  = useRef(null)
  // Stable refs for stale-closure safety
  const betRef          = useRef(bet)
  const balanceRef      = useRef(balance)
  const speedRef        = useRef(speed)
  const safeLandingRef  = useRef(false)
  const placeBetRef     = useRef(placeBet)
  const nitroActiveRef  = useRef(false)
  const autoRoundsRef   = useRef(0)
```

- [ ] **Step 2: Replace the sync `useEffect` block**

Find all the individual sync effects (e.g. `useEffect(() => { betRef.current = bet }, [bet])`) and replace with:

```jsx
  useEffect(() => { betRef.current      = bet      }, [bet])
  useEffect(() => { balanceRef.current  = balance  }, [balance])
  useEffect(() => { speedRef.current    = speed    }, [speed])
  useEffect(() => { safeLandingRef.current = safeLanding }, [safeLanding])
  useEffect(() => { placeBetRef.current = placeBet }, [placeBet])
  useEffect(() => { nitroActiveRef.current = nitroActive }, [nitroActive])
  useEffect(() => { autoRoundsRef.current  = autoRounds  }, [autoRounds])
```

- [ ] **Step 3: Add `applyBadgeEvent` helper function** (add before `resolveRound`)

```jsx
  function applyBadgeEvent(badge) {
    if (badge.skipped) return
    let m = multRef.current
    if      (badge.kind === 'rocket') m = m / 2
    else if (badge.kind === 'mult')   m = Math.min(MAX_MULT, m * badge.value)
    else if (badge.kind === 'add')    m = Math.min(MAX_MULT, m + badge.value)
    m = Math.round(m * 100) / 100
    multRef.current = m
    setMultiplier(m)
    setFlashKind(badge.kind)
  }
```

- [ ] **Step 4: Replace `resolveRound`**

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

      if      (finalMult >= WIN_TIERS.SUPER_MEGA) { setWinTier('SUPER_MEGA'); setAutoRounds(0) }
      else if (finalMult >= WIN_TIERS.MEGA)         setWinTier('MEGA')
      else if (finalMult >= WIN_TIERS.BIG)          setWinTier('BIG')
    } else {
      setGameResult('loss')
      setWonAmount(totalBet)
      setPhase('splashed')
      placeBetRef.current('aviamasters', totalBet, -totalBet)
    }

    const isSuperMega = effectiveOutcome === 'land' && finalMult >= WIN_TIERS.SUPER_MEGA
    if (!isSuperMega && autoRoundsRef.current > 1) {
      setTimeout(() => { setAutoRounds(prev => prev - 1); setAutoStartPending(true) }, 900)
    } else if (!isSuperMega) {
      setAutoRounds(0)
    }
  }
```

- [ ] **Step 5: Replace `startFlight`**

```jsx
  function startFlight() {
    const totalBet = betRef.current + (safeLandingRef.current ? betRef.current * 50 : 0)
    if ((balanceRef.current ?? 0) < totalBet) return

    const round = generateRound()
    const { controlPts, badges } = assignBadgePositions(round.events, round.outcome)

    roundRef.current       = round
    controlPtsRef.current  = controlPts
    badgesRef.current      = badges
    planeTRef.current      = 0
    multRef.current        = 1.0
    lastPhysicsRef.current = null

    setMultiplier(1.00)
    setFlashKind(null)
    setGameResult(null)
    setWonAmount(0)
    setUsedBoosters(INITIAL_BOOSTERS)
    setNitroActive(false)
    nitroActiveRef.current = false
    setWinTier(null)
    setPhase('flying')
  }
```

- [ ] **Step 6: Replace `handlePlayAgain`**

```jsx
  function handlePlayAgain() {
    cancelAnimationFrame(physicsRafRef.current)
    physicsRafRef.current  = null
    planeTRef.current      = 0
    multRef.current        = 1.0
    controlPtsRef.current  = []
    badgesRef.current      = []
    setPhase('betting')
    setMultiplier(1.00)
    setFlashKind(null)
    setGameResult(null)
    setWonAmount(0)
    setUsedBoosters(INITIAL_BOOSTERS)
    setNitroActive(false)
    nitroActiveRef.current = false
    setWinTier(null)
    setAutoRounds(0)
    setAutoStartPending(false)
  }
```

- [ ] **Step 7: Replace `handleBoosterActivate`**

```jsx
  function handleBoosterActivate(kind) {
    if (!roundRef.current || usedBoosters[kind]) return
    const currentIdx = badgesRef.current.reduce((max, b, i) => b.applied ? i : max, -1)
    const { events: newBadges, outcome: newOutcome } =
      applyBooster(badgesRef.current, currentIdx, kind, roundRef.current.outcome)
    badgesRef.current = newBadges
    roundRef.current  = { ...roundRef.current, outcome: newOutcome }
    setUsedBoosters(prev => ({ ...prev, [kind]: true }))
    if (kind === 'nitro') {
      nitroActiveRef.current = true
      setNitroActive(true)
    }
  }
```

- [ ] **Step 8: Replace the flight loop `useEffect` (was setInterval, now rAF)**

Find the old flight loop `useEffect` that depends on `[phase, nitroActive]` and replace with:

```jsx
  // Physics loop — replaces setInterval; reads nitroActiveRef so restart is not needed
  useEffect(() => {
    if (phase !== 'flying') return
    lastPhysicsRef.current = null

    function physicsFrame(ts) {
      if (!lastPhysicsRef.current) lastPhysicsRef.current = ts
      const dt = Math.min((ts - lastPhysicsRef.current) / 1000, 0.05)
      lastPhysicsRef.current = ts

      const speed   = T_SPEEDS[speedRef.current] ?? T_SPEEDS.walking
      const effSpeed = nitroActiveRef.current ? speed * 2 : speed
      planeTRef.current = Math.min(1, planeTRef.current + effSpeed * dt)

      // Trigger badge events
      for (const badge of badgesRef.current) {
        if (!badge.applied && planeTRef.current >= badge.t) {
          badge.applied = true
          applyBadgeEvent(badge)
        }
      }

      if (planeTRef.current >= 1) {
        resolveRound(roundRef.current)
        return
      }

      physicsRafRef.current = requestAnimationFrame(physicsFrame)
    }

    physicsRafRef.current = requestAnimationFrame(physicsFrame)
    return () => {
      cancelAnimationFrame(physicsRafRef.current)
      physicsRafRef.current = null
    }
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => () => cancelAnimationFrame(physicsRafRef.current), [])
```

- [ ] **Step 9: Remove the old keyframe inject `useEffect`**

Find and delete the `useEffect` that creates the `'aviamasters-kf2'` `<style>` tag containing `amPlaneFly`, `amBump`, and `amWave`. These are no longer needed (the plane is canvas-drawn; `amWave` is now drawn on canvas too).

- [ ] **Step 10: Remove unused state**

Remove `const [eventIdx, setEventIdx] = useState(-1)` from the `useState` block — it is no longer used.

- [ ] **Step 11: Update `GameBoard` usage in the JSX**

Find `<GameBoard ... />` in the render and replace with:

```jsx
        <GameBoard
          phase={phase}
          planeTRef={planeTRef}
          controlPtsRef={controlPtsRef}
          badgesRef={badgesRef}
          multRef={multRef}
          bet={bet}
        />
```

- [ ] **Step 12: Remove the old `planeT` / `badges` derivation lines**

Find and delete these lines near the bottom of the component (above the return):
```js
const total  = totalEvtsRef.current || 1
const planeT = isResult ? 1 : isFlying ? Math.min(1, (eventIdx + 1) / total) : 0
const round  = roundRef.current
const badges = (round?.events ?? []).map(...)
```

- [ ] **Step 13: Build check**

```bash
npm run build 2>&1 | tail -8
```

Expected: clean build, no errors.

- [ ] **Step 14: Run engine tests**

```bash
node --test src/pages/casino/aviamastersEngine.test.js
```

Expected: 13 tests pass.

- [ ] **Step 15: Commit**

```bash
git add src/pages/casino/AviamastersGame.jsx
git commit -m "feat(aviamasters): replace setInterval with rAF physics loop + trajectory-driven flight"
```

---

### Task 5: Final cleanup, in-flight status bar, and smoke test

**Files:**
- Modify: `src/pages/casino/AviamastersGame.jsx`

- [ ] **Step 1: Remove now-unused imports from `AviamastersGame.jsx`**

At the top of the file, in the `aviamastersEngine` import line, remove `SPEEDS` (it was only used by the old `setInterval` tick calculation):

```jsx
import {
  generateRound, MAX_MULT, WIN_TIERS, applyBooster, assignBadgePositions,
} from './aviamastersEngine'
```

- [ ] **Step 2: Update the in-flight status bar to match new state**

The old status bar referenced `multiplier.toFixed(2)×` and `autoRounds`. Find `{isFlying && (...)}` and verify it still reads from `multiplier` state (not refs — this is fine since `setMultiplier` is still called on badge triggers). It should look like:

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

If the JSX already looks like this, no change needed. If `multiplier` is undefined after the state removal, verify it is still declared: `const [multiplier, setMultiplier] = useState(1.00)`.

- [ ] **Step 3: Final build check**

```bash
npm run build 2>&1 | tail -8
```

Expected: clean build.

- [ ] **Step 4: Run all engine tests one more time**

```bash
node --test src/pages/casino/aviamastersEngine.test.js
```

Expected: 13 pass, 0 fail.

- [ ] **Step 5: Start dev server and smoke test**

```bash
npm run dev
```

Navigate to `/casino/aviamasters`. Work through this checklist:

- [ ] Canvas renders (no blank/black box); sky gradient and stars visible
- [ ] Ocean strip at bottom with animated foam line
- [ ] Left island (takeoff) and right island (landing target) visible with palm trees
- [ ] Betting panel shows chip selector, speed, Safe Landing, Autoplay
- [ ] Click Spin — plane appears on left island and smoothly flies right along a curved path
- [ ] Plane rotates to match its direction of travel at every frame
- [ ] Smoke trail follows behind the plane
- [ ] Green/amber badges appear along the flight path
- [ ] When plane passes a boost badge: plane banks upward, counter balance bumps up
- [ ] When plane passes a rocket: plane nose-dips, counter balance drops
- [ ] On a win: plane descends to right island runway; carrier glows amber
- [ ] On a loss: plane tips nose-down into the ocean
- [ ] Laser Gun booster: next rocket has no effect (skipped badge greys out)
- [ ] Magnet booster: next rocket converts to a green add badge
- [ ] Nitro booster: flight visibly speeds up; remaining rockets skipped
- [ ] Life Buoy: a splash becomes a landing
- [ ] Safe Landing: enable toggle, observe cost display, verify splash resolves as win
- [ ] Autoplay 5× runs 5 rounds; Stop Auto halts it
- [ ] Big/Mega/Super Mega Win popups appear at correct thresholds

- [ ] **Step 6: Commit if any minor fixes were needed**

```bash
git add src/pages/casino/AviamastersGame.jsx
git commit -m "fix(aviamasters): cleanup + smoke test fixes"
```
