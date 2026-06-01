# Plinko Bounce + Peg-Placement Redesign — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Plinko ball visibly bounce *off* and *between* the pegs (instead of gliding through their centers and covering them), and align the pegs/slots into a proper lattice.

**Architecture:** Extract the pure board geometry + path math out of `PlinkoGame.jsx` into a testable `plinkoGeom.js` module (mirrors the `src/war/*.js` + `node --test` convention). Replace the fan-of-points geometry with a standard offset peg lattice where the ball rides on peg *tops* and arcs (projectile parabola + small hop) through the gaps between pegs. Add a peg "strike pop" so contacts read as real bounces. Payout mapping (`slot = number of right deflections`) is preserved exactly, so no economic behavior changes.

**Tech Stack:** React + Canvas 2D (Vite), Node's built-in test runner for the pure module.

---

## Root cause (verified)

`buildPath` pushes waypoints at `{ x: pegX(r,col), y: pegY(r) }` — i.e. **peg centers**. The ball (radius `1.75×` the peg) is therefore drawn directly on top of every peg it visits, fully covering it. The ball never travels through the gaps and never strikes a peg edge → no bounce, pegs look "misplaced/covered." Confirmed empirically: 8/8 waypoints land exactly on peg centers.

## File structure

- **Create** `src/pages/casino/plinkoGeom.js` — pure constants + `makeGeom`, `buildPath`, `segPos`. No DOM/canvas.
- **Create** `src/pages/casino/plinkoGeom.test.js` — `node --test` coverage of the geometry & path invariants.
- **Modify** `src/pages/casino/PlinkoGame.jsx` — import from the module; rewrite `drawScene` (centered slots + peg strike-pop), the RAF frame (use `segPos` + hop, register strikes), and `drop()` (new ball shape). Remove the now-orphaned local `CW`, `makeGeom`, `buildPath`, `qBez`.

---

## Task 1: Pure geometry/path module

**Files:**
- Create: `src/pages/casino/plinkoGeom.js`

- [ ] **Step 1: Write the module**

```js
// Pure, DOM-free geometry + path math for the Plinko board, so it can be
// unit-tested with `node --test` (see plinkoGeom.test.js). The canvas drawing
// itself stays in PlinkoGame.jsx.

export const CW = 480              // logical board width (px)

// ─── Board geometry: proper offset peg lattice ────────────────────────────────
// Row i (0-indexed) has (i + 3) pegs, so the bottom row has (rows + 2) pegs that
// form (rows + 1) gaps — one per payout slot. Pegs live on a half-spacing unit
// grid: the ball always sits above a peg and deflects by one unit (= half a peg
// spacing) left/right each row, so it weaves through the gaps.
export function makeGeom(rows) {
  const N      = rows
  const MARGIN = 18
  const S      = (CW - 2 * MARGIN) / (N + 1)        // horizontal peg spacing
  const PEG_R  = Math.max(3, S * 0.14)
  const BALL_R = S * 0.27                            // < S/2 so it clears the gaps
  const TOP    = 46                                  // y of the first peg row
  const ROW_H  = Math.min(S * 0.92, 40)              // vertical spacing
  const SLOTS  = N + 1
  const SLOT_W = S
  const SLOT_H = 40
  const SLOT_Y = TOP + (N - 1) * ROW_H + PEG_R + BALL_R + 22
  const CH     = SLOT_Y + SLOT_H + 16

  const cx     = CW / 2
  const unitX  = (u) => cx + u * (S / 2)             // unit grid -> px
  const pegY   = (i) => TOP + i * ROW_H
  const slotCX = (k) => unitX(-N + 2 * k)            // bin/slot center, k = 0..N

  const pegs = []
  for (let i = 0; i < N; i++)
    for (let j = 0; j <= i + 2; j++)
      pegs.push({ x: unitX(-(i + 2) + 2 * j), y: pegY(i) })

  return { N, S, PEG_R, BALL_R, TOP, ROW_H, SLOTS, SLOT_W, SLOT_H, SLOT_Y, CH, cx, unitX, pegY, slotCX, pegs }
}

// ─── Path: the contact points (peg TOPS) the ball bounces across ──────────────
// decisions[i] = 1 -> deflect right, 0 -> left. Waypoints sit on the TOP of each
// struck peg (one ball-radius + peg-radius above its center, i.e. tangent), plus
// an entry drop and the final slot. slot = number of right deflections (0..rows),
// identical to the previous payout mapping.
export function buildPath(rows, decisions, geom) {
  const { unitX, pegY, slotCX, PEG_R, BALL_R, SLOT_Y, SLOT_H, ROW_H } = geom
  const off = PEG_R + BALL_R                         // ball center rides this far above a peg center
  const pts = [{ x: unitX(0), y: Math.max(BALL_R + 2, pegY(0) - off - ROW_H) }]  // entry
  let col = 0
  for (let i = 0; i < rows; i++) {
    pts.push({ x: unitX(2 * col - i), y: pegY(i) - off })   // top of struck peg
    if (decisions[i]) col++
  }
  pts.push({ x: slotCX(col), y: SLOT_Y + SLOT_H / 2 })       // settle into slot
  return { pts, slot: col }
}

// ─── Ball position along one bounce segment ───────────────────────────────────
// Projectile arc between two contact points: linear x, parabolic y with a small
// upward hop so it reads as bouncing down the lattice. The caller passes hop = 0
// for the entry drop (clean fall).
export function segPos(a, b, t, hop) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t - hop * 4 * t * (1 - t),
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/casino/plinkoGeom.js
git commit -m "feat(plinko): pure geometry/path module (offset lattice, peg-top contacts)"
```

---

## Task 2: Tests for the geometry/path invariants

**Files:**
- Create: `src/pages/casino/plinkoGeom.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CW, makeGeom, buildPath, segPos } from './plinkoGeom.js'

const ROWS = [8, 12, 16]

// deterministic PRNG so the random paths are reproducible
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 }

test('peg lattice: row i has i+3 pegs; rows+1 slots', () => {
  for (const rows of ROWS) {
    const g = makeGeom(rows)
    const byRow = new Map()
    for (const p of g.pegs) {
      const k = Math.round(p.y)
      byRow.set(k, (byRow.get(k) || 0) + 1)
    }
    const counts = [...byRow.keys()].sort((a, b) => a - b).map(k => byRow.get(k))
    assert.deepEqual(counts, Array.from({ length: rows }, (_, i) => i + 3))
    assert.equal(g.SLOTS, rows + 1)
  }
})

test('slot index equals the number of right deflections (payout mapping preserved)', () => {
  for (const rows of ROWS) {
    const g = makeGeom(rows)
    const rng = lcg(1234 + rows)
    for (let trial = 0; trial < 500; trial++) {
      const dec = Array.from({ length: rows }, () => (rng() < 0.5 ? 1 : 0))
      const rights = dec.reduce((s, d) => s + d, 0)
      assert.equal(buildPath(rows, dec, g).slot, rights)
    }
  }
})

test('each struck waypoint is tangent to a real peg top (never on its center)', () => {
  for (const rows of ROWS) {
    const g = makeGeom(rows)
    const off = g.PEG_R + g.BALL_R
    const pegSet = new Set(g.pegs.map(p => `${p.x.toFixed(3)}_${p.y.toFixed(3)}`))
    const rng = lcg(99 + rows)
    for (let trial = 0; trial < 200; trial++) {
      const dec = Array.from({ length: rows }, () => (rng() < 0.5 ? 1 : 0))
      const { pts } = buildPath(rows, dec, g)
      for (let s = 1; s <= rows; s++) {
        const center = `${pts[s].x.toFixed(3)}_${(pts[s].y + off).toFixed(3)}`
        assert.ok(pegSet.has(center), `row ${s - 1}: waypoint not above a real peg`)
        // ball bottom touches peg top exactly (tangent, no overlap-through)
        const ballBottom = pts[s].y + g.BALL_R
        const pegTop     = (pts[s].y + off) - g.PEG_R
        assert.ok(Math.abs(ballBottom - pegTop) < 1e-9, 'ball must ride tangent on peg top')
      }
    }
  }
})

test('the ball never overlaps any peg body along the full flight', () => {
  for (const rows of ROWS) {
    const g = makeGeom(rows)
    const minClear = g.PEG_R + g.BALL_R
    const rng = lcg(7 + rows)
    for (let trial = 0; trial < 60; trial++) {
      const dec = Array.from({ length: rows }, () => (rng() < 0.5 ? 1 : 0))
      const { pts } = buildPath(rows, dec, g)
      for (let s = 0; s < pts.length - 1; s++) {
        const hop = s === 0 ? 0 : g.ROW_H * 0.3
        for (let step = 0; step <= 20; step++) {
          const pos = segPos(pts[s], pts[s + 1], step / 20, hop)
          for (const peg of g.pegs) {
            const d = Math.hypot(pos.x - peg.x, pos.y - peg.y)
            assert.ok(d >= minClear - 0.5, `overlap seg ${s} t=${step / 20}: d=${d.toFixed(2)} < ${minClear.toFixed(2)}`)
          }
        }
      }
    }
  }
})

test('bounce segments rise above the contact line and shift by half a spacing', () => {
  const rows = 12
  const g = makeGeom(rows)
  const { pts } = buildPath(rows, Array.from({ length: rows }, (_, i) => i % 2), g)
  for (let s = 1; s < rows; s++) {
    const dx = Math.abs(pts[s + 1].x - pts[s].x)
    assert.ok(Math.abs(dx - g.S / 2) < 1e-6, 'bounce shifts by half a peg spacing')
    const mid = segPos(pts[s], pts[s + 1], 0.5, g.ROW_H * 0.3)
    assert.ok(mid.y < (pts[s].y + pts[s + 1].y) / 2, 'mid-arc rises above the straight line')
  }
})

test('all geometry + extreme paths stay inside the canvas', () => {
  for (const rows of ROWS) {
    const g = makeGeom(rows)
    for (const p of g.pegs) {
      assert.ok(p.x - g.PEG_R >= 0 && p.x + g.PEG_R <= CW, 'peg within width')
      assert.ok(p.y >= 0 && p.y <= g.CH, 'peg within height')
    }
    for (let k = 0; k <= rows; k++) {
      const x = g.slotCX(k)
      assert.ok(x - g.SLOT_W / 2 >= -0.001 && x + g.SLOT_W / 2 <= CW + 0.001, 'slot within width')
    }
    for (const side of [0, 1]) {
      const { pts } = buildPath(rows, Array(rows).fill(side), g)
      for (const p of pts) assert.ok(p.x - g.BALL_R >= -0.5 && p.x + g.BALL_R <= CW + 0.5, 'ball within width')
    }
  }
})

test('segPos: exact endpoints; hop=0 is linear', () => {
  const a = { x: 100, y: 50 }, b = { x: 140, y: 90 }
  assert.deepEqual(segPos(a, b, 0, 0), { x: 100, y: 50 })
  assert.deepEqual(segPos(a, b, 1, 0), { x: 140, y: 90 })
  assert.deepEqual(segPos(a, b, 0.5, 0), { x: 120, y: 70 })
})
```

- [ ] **Step 2: Run tests**

Run: `node --test src/pages/casino/plinkoGeom.test.js`
Expected: all tests PASS. If "ball never overlaps" fails, tune `BALL_R`/`PEG_R`/hop in `plinkoGeom.js` until clear, then re-run.

- [ ] **Step 3: Commit**

```bash
git add src/pages/casino/plinkoGeom.test.js
git commit -m "test(plinko): geometry/path invariants (no peg overlap, payout mapping)"
```

---

## Task 3: Wire the module into the component (draw + animate the bounce)

**Files:**
- Modify: `src/pages/casino/PlinkoGame.jsx`

- [ ] **Step 1: Replace the imports + delete orphaned local math**

Change the top imports to add the module, and **delete** the local `const CW = 480`, `makeGeom`, `buildPath`, and `qBez` (now provided by / unused after the module):

```jsx
import { useState, useRef, useEffect, useCallback } from 'react'
import { GameLayout, BetChips } from './shared'
import { useCasino } from '../../context/CasinoContext'
import { CW, makeGeom, buildPath, segPos } from './plinkoGeom'
```

Keep `MULT_TABLE`, `BALL_COLORS`, `FLASH_MS`, `slotTint`, `rrect`.

- [ ] **Step 2: Rewrite `drawScene` — centered slots + peg strike-pop**

Replace the whole `drawScene` function with:

```jsx
// balls: [{ x, y, trail, color }] — x/y null when not visible
// litSlots: { slotIdx: landingTs }   pegHits: { "x_y": strikeTs }
function drawScene(canvas, mults, geom, balls, litSlots, pegHits, now) {
  const dpr = window.devicePixelRatio || 1
  const ctx = canvas.getContext('2d')
  const { CH, pegs, SLOT_W, SLOT_Y, SLOT_H, PEG_R, BALL_R, slotCX } = geom

  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, CW, CH)

  // ── Background ──
  ctx.fillStyle = '#151515'
  rrect(ctx, 0, 0, CW, CH, 16)
  ctx.fill()

  // ── Drop indicator ──
  ctx.fillStyle = 'rgba(251,191,36,0.18)'
  ctx.beginPath()
  ctx.moveTo(CW / 2 - 9, 10)
  ctx.lineTo(CW / 2 + 9, 10)
  ctx.lineTo(CW / 2,     24)
  ctx.closePath()
  ctx.fill()

  // ── Slots (centered under the bottom-row gaps) ──
  mults.forEach((m, i) => {
    const [tR, tG, tB] = slotTint(m)
    const w        = SLOT_W - 3
    const x        = slotCX(i) - w / 2
    const y        = SLOT_Y
    const h        = SLOT_H
    const flashTs  = litSlots[i]
    const flashAge = flashTs != null ? (now - flashTs) : Infinity
    const lit      = flashAge < FLASH_MS
    const ff       = lit ? Math.max(0, 1 - flashAge / FLASH_MS) : 0

    ctx.save()
    ctx.fillStyle = '#1f1f1f'
    rrect(ctx, x, y, w, h, 6)
    ctx.fill()

    if (ff > 0) {
      ctx.save()
      ctx.shadowBlur  = 20 * ff
      ctx.shadowColor = `rgba(${tR},${tG},${tB},${0.85 * ff})`
      ctx.globalAlpha = ff * 0.38
      ctx.fillStyle   = `rgb(${tR},${tG},${tB})`
      rrect(ctx, x, y, w, h, 6)
      ctx.fill()
      ctx.restore()
    }

    ctx.strokeStyle = ff > 0
      ? `rgba(${tR},${tG},${tB},${Math.min(0.9, 0.2 + 0.7 * ff)})`
      : `rgba(${tR},${tG},${tB},0.18)`
    ctx.lineWidth = 1
    rrect(ctx, x, y, w, h, 6)
    ctx.stroke()

    const label    = m >= 1000 ? `${Math.round(m / 1000)}K×` : `${m}×`
    const fontSize = m >= 100 ? 9 : m >= 10 ? 10 : 11
    ctx.fillStyle    = '#ffffff'
    ctx.font         = `bold ${fontSize}px system-ui, -apple-system, sans-serif`
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + w / 2, y + h / 2)
    ctx.restore()
  })

  // ── Ball trails ──
  balls.forEach(ball => {
    if (!ball.trail || ball.trail.length < 2) return
    ball.trail.forEach(({ x: tx, y: ty }, i) => {
      ctx.save()
      ctx.globalAlpha = ((i + 1) / ball.trail.length) * 0.25
      ctx.beginPath()
      ctx.arc(tx, ty, BALL_R * 0.62, 0, Math.PI * 2)
      ctx.fillStyle = ball.color
      ctx.fill()
      ctx.restore()
    })
  })

  // ── Pegs (proximity glow + strike-pop ring) ──
  const POP_MS = 260
  pegs.forEach(({ x, y }) => {
    let minDist = Infinity
    balls.forEach(b => {
      if (b.x != null) {
        const d = Math.hypot(x - b.x, y - b.y)
        if (d < minDist) minDist = d
      }
    })
    const gf    = minDist < 50 ? Math.max(0, 1 - minDist / 28) : 0
    const hitTs = pegHits[`${Math.round(x)}_${Math.round(y)}`]
    const pop   = hitTs != null ? Math.max(0, 1 - (now - hitTs) / POP_MS) : 0
    const glow  = Math.max(gf, pop)
    const r     = PEG_R * (1 + 0.55 * pop)

    if (pop > 0.02) {
      ctx.save()
      ctx.globalAlpha = pop * 0.5
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth   = 1.5
      ctx.beginPath()
      ctx.arc(x, y, PEG_R + (1 - pop) * PEG_R * 3, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    ctx.save()
    ctx.shadowBlur  = glow > 0.05 ? 16 * glow : 3
    ctx.shadowColor = glow > 0.05 ? `rgba(255,255,255,${0.85 * glow})` : 'rgba(255,255,255,0.12)'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = glow > 0.3 ? '#ffffff' : 'rgba(255,255,255,0.82)'
    ctx.fill()
    ctx.restore()
  })

  // ── Balls ──
  balls.forEach(ball => {
    if (ball.x == null) return
    ctx.save()
    ctx.shadowBlur  = 20
    ctx.shadowColor = ball.color
    const gr = ctx.createRadialGradient(
      ball.x - BALL_R * 0.28, ball.y - BALL_R * 0.28, BALL_R * 0.05,
      ball.x, ball.y, BALL_R,
    )
    gr.addColorStop(0,    '#ffffff')
    gr.addColorStop(0.35, ball.color)
    gr.addColorStop(1,    ball.color + '80')
    ctx.beginPath()
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2)
    ctx.fillStyle = gr
    ctx.fill()
    ctx.restore()
  })

  ctx.restore()
}
```

- [ ] **Step 3: Add the peg-hits ref**

Next to the other refs (after `litSlotsRef`), add:

```jsx
  const pegHitsRef   = useRef({})        // { "x_y": strikeTimestamp } for strike pops
```

- [ ] **Step 4: Update the initial-draw effect's `drawScene` call**

In the `useEffect([rows, risk])`, change the final draw call to pass the new args:

```jsx
    drawScene(canvas, multsRef.current, g, [], litSlotsRef.current, {}, performance.now())
```

- [ ] **Step 5: Rewrite the per-ball physics in the RAF `frame`**

Replace the `balls.forEach(...)` block **and** the `drawScene(...)` call inside `frame` so the ball moves via `segPos` + hop and registers strikes. The `finished` handling block stays unchanged.

```jsx
      balls.forEach(ball => {
        if (ball.done) return
        if (ball.segStart === null) ball.segStart = ts

        const rawT = Math.min(1, (ts - ball.segStart) / ball.msPerSeg)
        const a    = ball.pts[ball.segIdx]
        const b    = ball.pts[ball.segIdx + 1]
        const hop  = ball.segIdx === 0 ? 0 : ball.hop
        const pos  = segPos(a, b, rawT, hop)
        ball.x = pos.x
        ball.y = pos.y

        ball.trail.push({ x: pos.x, y: pos.y })
        if (ball.trail.length > 6) ball.trail.shift()

        if (rawT >= 1) {
          ball.segIdx++
          ball.segStart = null
          // arriving at a peg contact (pts[1..rows]) → pop that peg
          if (ball.segIdx >= 1 && ball.segIdx <= ball.rows) {
            pegHitsRef.current[`${Math.round(b.x)}_${Math.round(b.y + ball.pegOffset)}`] = ts
          }
          if (ball.segIdx >= ball.pts.length - 1) {
            ball.done = true
            ball.x    = null
            litSlotsRef.current = { ...litSlotsRef.current, [ball.slot]: ts }
            finished.push(ball)
          }
        }
      })

      // prune expired strike pops
      const hits = pegHitsRef.current
      for (const k in hits) if (ts - hits[k] > 300) delete hits[k]
```

And change the draw call near the end of `frame` from the old 6-arg form to:

```jsx
      drawScene(canvas, mults, g, ballsRef.current, litSlotsRef.current, pegHitsRef.current, ts)
```

- [ ] **Step 6: Rewrite the ball construction in `drop()`**

Replace the `const segs = ...` mapping and the `ballsRef.current.push({...})` block with the new ball shape (no `segs`/`cp`; carries `pts`, `hop`, `pegOffset`, `rows`):

```jsx
    const msPerSeg = r <= 8 ? 240 : r <= 12 ? 215 : 190

    const id    = ballIdRef.current++
    const color = BALL_COLORS[id % BALL_COLORS.length]

    inFlightRef.current += b

    ballsRef.current.push({
      id, pts, slot, mult, winAmount, bet: b, color, msPerSeg,
      rows: r, hop: g.ROW_H * 0.3, pegOffset: g.PEG_R + g.BALL_R,
      segIdx: 0, segStart: null,
      x: null, y: null,
      trail: [], done: false,
    })
```

(The lines computing `g`, `mults`, `decisions`, `{ pts, slot }`, `mult`, `payout`, `winAmount` stay; only `msPerSeg` value and the `segs`/`push` change. The canvas-sizing `if (ballsRef.current.length === 1)` block stays as-is — it already uses `g.CH`.)

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: build succeeds with no errors (catches any stale reference to removed `qBez`/`makeGeom`/`CW`).

- [ ] **Step 8: Commit**

```bash
git add src/pages/casino/PlinkoGame.jsx
git commit -m "feat(plinko): real bounce — ball arcs through gaps, pegs pop on strike"
```

---

## Task 4: Final verification

- [ ] **Step 1: Re-run module tests** — `node --test src/pages/casino/plinkoGeom.test.js` → all pass.
- [ ] **Step 2: Production build** — `npm run build` → succeeds.
- [ ] **Step 3: ASCII frame dump** — throwaway node script that renders one mid-flight frame (pegs `.`, ball `O`) for rows 8/12/16 to eyeball that the ball sits in a gap above/between pegs (not on a peg). Sanity check only; not committed.

---

## Self-review checklist
- **Spec coverage:** "no real bounce" → projectile arc + hop + peg strike-pop (Tasks 1, 3). "misplaced pegs" → offset lattice + tangent peg-top contacts + centered slots (Tasks 1, 3); proven by the no-overlap test (Task 2).
- **Payout safety:** `slot = right deflections` preserved + tested (Task 2). `placeBet`, auto-bet, in-flight guards untouched.
- **Type consistency:** ball carries `pts`, `slot`, `mult`, `winAmount`, `bet`, `color`, `msPerSeg`, `rows`, `hop`, `pegOffset`, `segIdx`, `segStart`, `x`, `y`, `trail`, `done`. `drawScene` signature `(canvas, mults, geom, balls, litSlots, pegHits, now)` updated at all three call sites (init effect, frame). `segPos(a,b,t,hop)` used in frame and tests with matching args.
- **No placeholders:** every step has concrete code/commands.
