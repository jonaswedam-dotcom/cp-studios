import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveDice } from './diceEngine.js'

test('dice win pays +bet*4, roll equals guess', () => {
  const r = resolveDice({ bet: 100, guess: 6, rng: () => 0.99 }) // floor(0.99*6)+1 = 6
  assert.equal(r.roll, 6)
  assert.equal(r.win, true)
  assert.equal(r.delta, 400) // +bet*4
})

test('dice loss pays -bet', () => {
  const r = resolveDice({ bet: 100, guess: 1, rng: () => 0.99 }) // roll 6 != 1
  assert.equal(r.win, false)
  assert.equal(r.delta, -100)
})
