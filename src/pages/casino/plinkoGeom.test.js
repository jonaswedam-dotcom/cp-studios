import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CW, makeGeom, buildPath, segPos, MULTIPLIERS, decisionsToSlot, resolvePlinko } from './plinkoGeom.js'

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

test('each struck waypoint rides just above a real peg top (never on its center)', () => {
  for (const rows of ROWS) {
    const g = makeGeom(rows)
    const off = g.PEG_R + g.BALL_R + g.S * 0.04        // must match buildPath
    const pegSet = new Set(g.pegs.map(p => `${p.x.toFixed(3)}_${p.y.toFixed(3)}`))
    const rng = lcg(99 + rows)
    for (let trial = 0; trial < 200; trial++) {
      const dec = Array.from({ length: rows }, () => (rng() < 0.5 ? 1 : 0))
      const { pts } = buildPath(rows, dec, g)
      for (let s = 1; s <= rows; s++) {
        const center = `${pts[s].x.toFixed(3)}_${(pts[s].y + off).toFixed(3)}`
        assert.ok(pegSet.has(center), `row ${s - 1}: waypoint not above a real peg`)
        // ball bottom sits just above the peg top — close, but never overlapping
        const gap = ((pts[s].y + off) - g.PEG_R) - (pts[s].y + g.BALL_R)
        assert.ok(gap > 0, 'ball must ride above the peg top (no overlap)')
        assert.ok(gap < g.S * 0.1, 'ball must ride close to the peg top')
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
        const bounce = s === 0 ? 0 : g.ROW_H * 0.6
        for (let step = 0; step <= 40; step++) {
          const pos = segPos(pts[s], pts[s + 1], step / 40, bounce)
          for (const peg of g.pegs) {
            const d = Math.hypot(pos.x - peg.x, pos.y - peg.y)
            assert.ok(d >= minClear, `overlap seg ${s} t=${step / 40}: d=${d.toFixed(2)} < ${minClear.toFixed(2)}`)
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
    const mid = segPos(pts[s], pts[s + 1], 0.5, g.ROW_H * 0.6)
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

test('segPos: exact endpoints; bounce=0 is gravity (t^2) with cubic ease-out x', () => {
  const a = { x: 100, y: 50 }, b = { x: 140, y: 90 }
  assert.deepEqual(segPos(a, b, 0, 0), { x: 100, y: 50 })
  assert.deepEqual(segPos(a, b, 1, 0), { x: 140, y: 90 })
  // at t=0.5: ex = 1-(0.5)^3 = 0.875 -> x = 100 + 40*0.875 = 135; y = 50 + 40*0.5^2 = 60
  assert.deepEqual(segPos(a, b, 0.5, 0), { x: 135, y: 60 })
})

test('MULTIPLIERS table has rows+1 entries for every rows/risk combo', () => {
  for (const rows of ROWS) {
    for (const risk of ['low', 'medium', 'high']) {
      assert.equal(MULTIPLIERS[rows][risk].length, rows + 1, `${rows}/${risk}`)
    }
  }
})

test('decisionsToSlot is the count of right deflections and matches buildPath', () => {
  for (const rows of ROWS) {
    const g = makeGeom(rows)
    const rng = lcg(555 + rows)
    for (let t = 0; t < 300; t++) {
      const dec = Array.from({ length: rows }, () => (rng() < 0.5 ? 1 : 0))
      const slot = decisionsToSlot(dec)
      assert.equal(slot, dec.reduce((s, d) => s + d, 0))
      assert.equal(slot, buildPath(rows, dec, g).slot)
    }
  }
})

test('resolvePlinko: all-left and all-right hit the edge slots', () => {
  // rng()=0 -> floor(0*2)=0 (left) every row -> slot 0; the edge multiplier.
  const left = resolvePlinko({ bet: 100, rows: 8, risk: 'high', rng: () => 0 })
  assert.deepEqual(left.decisions, Array(8).fill(0))
  assert.equal(left.slot, 0)
  assert.equal(left.mult, MULTIPLIERS[8].high[0])         // 29
  assert.equal(left.delta, Math.floor(100 * 29) - 100)    // 2800
  // rng()=0.99 -> floor(0.99*2)=1 (right) every row -> slot = rows.
  const right = resolvePlinko({ bet: 100, rows: 8, risk: 'high', rng: () => 0.99 })
  assert.deepEqual(right.decisions, Array(8).fill(1))
  assert.equal(right.slot, 8)
  assert.equal(right.mult, MULTIPLIERS[8].high[8])        // 29
})

test('resolvePlinko: delta = floor(bet*mult) - bet (loss when mult < 1)', () => {
  // a center-ish slot with a sub-1 multiplier produces a negative delta.
  // 12-row medium center slot (index 6) = 0.3.
  const dec = [1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0] // 6 rights -> slot 6
  let i = 0
  const r = resolvePlinko({ bet: 100, rows: 12, risk: 'medium', rng: () => (dec[i++] ? 0.99 : 0) })
  assert.equal(r.slot, 6)
  assert.equal(r.mult, MULTIPLIERS[12].medium[6])         // 0.3
  assert.equal(r.delta, Math.floor(100 * 0.3) - 100)      // -70
})
