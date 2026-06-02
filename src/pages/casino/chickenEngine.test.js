import test from 'node:test'
import assert from 'node:assert/strict'
import { preRollLanes, chickenPayout, LANE_MULTIPLIERS, SAFE_PROBS } from './chickenEngine.js'

test('constants match ChickenRoadGame.jsx', () => {
  assert.deepEqual(LANE_MULTIPLIERS, [1.3, 2.0, 3.2, 4.8, 7.2, 11.0, 18.0])
  assert.deepEqual(SAFE_PROBS, [0.72, 0.64, 0.56, 0.48, 0.40, 0.32, 0.25])
})

test('preRollLanes returns 7 booleans', () => {
  const lanes = preRollLanes(() => 0.5)
  assert.equal(lanes.length, 7)
  assert.ok(lanes.every((l) => typeof l === 'boolean'))
})

test('preRollLanes: lane i safe iff rng() < SAFE_PROBS[i]', () => {
  // rng() = 0 → always below every SAFE_PROB → all safe
  assert.deepEqual(preRollLanes(() => 0), [true, true, true, true, true, true, true])
  // rng() = 0.99 → above every SAFE_PROB → all unsafe
  assert.deepEqual(preRollLanes(() => 0.99), [false, false, false, false, false, false, false])
})

test('preRollLanes: boundary — equal to prob is NOT safe (strict <)', () => {
  // rng returns exactly SAFE_PROBS[i] for each lane → none safe
  let i = 0
  const lanes = preRollLanes(() => SAFE_PROBS[i++])
  assert.deepEqual(lanes, [false, false, false, false, false, false, false])
})

test('preRollLanes: per-lane threshold using a value between two probs', () => {
  // 0.50 is < 0.72,0.64,0.56 (lanes 0-2) but >= 0.48,0.40,0.32,0.25 (lanes 3-6)
  assert.deepEqual(preRollLanes(() => 0.50), [true, true, true, false, false, false, false])
})

test('chickenPayout lane 1: bet + floor(bet*(1.3-1))', () => {
  assert.equal(chickenPayout(100, 1), 100 + Math.floor(100 * 0.3)) // 130
  assert.equal(chickenPayout(50, 1), 50 + Math.floor(50 * 0.3))    // 50 + 15 = 65
})

test('chickenPayout lane 7: bet + floor(bet*(18.0-1))', () => {
  assert.equal(chickenPayout(50, 7), 50 + Math.floor(50 * 17.0)) // 50 + 850 = 900
})

test('chickenPayout floors the multiplier portion (33*0.3 = 9.9 → 9)', () => {
  assert.equal(chickenPayout(33, 1), 33 + 9) // floor(9.9) = 9
})
