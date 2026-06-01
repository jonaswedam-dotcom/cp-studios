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
