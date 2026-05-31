import { test } from 'node:test'
import assert from 'node:assert/strict'
import { troopCost, maxAffordable } from './economy.js'

test('troopCost multiplies unit cost by count', () => {
  assert.equal(troopCost('soldier', 3), 300)
  assert.equal(troopCost('tank', 2), 1000)
  assert.equal(troopCost('jet', 1), 800)
})

test('troopCost of 0 or unknown type is 0', () => {
  assert.equal(troopCost('soldier', 0), 0)
  assert.equal(troopCost('zzz', 5), 0)
})

test('maxAffordable returns how many you can buy with a balance', () => {
  assert.equal(maxAffordable('soldier', 950), 9)
  assert.equal(maxAffordable('tank', 1000), 2)
  assert.equal(maxAffordable('jet', 100), 0)
})

test('troopCost applies an optional cost multiplier', () => {
  assert.equal(troopCost('soldier', 10, 0.8), 800) // 1000 * 0.8
  assert.equal(troopCost('soldier', 10), 1000)     // default 1
})
