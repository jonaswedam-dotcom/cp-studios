import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveCoinFlip } from './coinflipEngine.js'

test('coinflip win pays +floor(bet*0.95)', () => {
  const r = resolveCoinFlip({ bet: 100, choice: 'heads', rng: () => 0.9 }) // >0.5 => heads
  assert.equal(r.result, 'heads'); assert.equal(r.win, true); assert.equal(r.delta, 95)
})
test('coinflip loss pays -bet', () => {
  const r = resolveCoinFlip({ bet: 100, choice: 'tails', rng: () => 0.9 })
  assert.equal(r.win, false); assert.equal(r.delta, -100)
})
