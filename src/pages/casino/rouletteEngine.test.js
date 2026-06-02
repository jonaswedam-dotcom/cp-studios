import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRoulette, RED_NUMBERS } from './rouletteEngine.js'

test('number hit pays +bet*35', () => {
  const r = resolveRoulette({ bet: 10, kind: 'number', number: 17, rng: () => 17/37 })
  assert.equal(r.result, 17); assert.equal(r.delta, 350)
})
test('red hit pays +bet; zero loses color', () => {
  assert.equal(resolveRoulette({ bet: 10, kind: 'red', rng: () => 1/37 }).delta, 10)   // 1 is red
  assert.equal(resolveRoulette({ bet: 10, kind: 'red', rng: () => 0 }).delta, -10)     // 0 loses
})
test('RED_NUMBERS matches RouletteGame.jsx set', () => {
  assert.deepEqual([...RED_NUMBERS].sort((a, b) => a - b),
    [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36])
})
