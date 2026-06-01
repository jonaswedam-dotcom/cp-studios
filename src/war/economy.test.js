import { test } from 'node:test'
import assert from 'node:assert/strict'
import { troopCost, maxAffordable, armySizeMultiplier } from './economy.js'

test('troopCost multiplies unit cost by count', () => {
  assert.equal(troopCost('soldier', 3), 300)
  assert.equal(troopCost('tank', 2), 800)  // tank cost changed 500→400
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

test('maxAffordable accounts for a cost multiplier (factory discount)', () => {
  assert.equal(maxAffordable('soldier', 950, 0.8), 11) // 80/ea -> 11
  assert.equal(maxAffordable('soldier', 950), 9)       // default 1
})

test('army multiplier steps every 1000 units, caps at 3x', () => {
  assert.equal(armySizeMultiplier(0), 1)
  assert.equal(armySizeMultiplier(999), 1)
  assert.equal(armySizeMultiplier(1000), 1.25)
  assert.equal(armySizeMultiplier(4000), 2)
  assert.equal(armySizeMultiplier(100000), 3)
})
test('troopCost folds in factory + army multipliers', () => {
  // soldier 100, factory ×0.8, army ×1.25 → 100*10*0.8*1.25 = 1000
  assert.equal(troopCost('soldier', 10, 0.8, 1.25), 1000)
})
