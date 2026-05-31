import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lootFraction, lootCoins } from './spoils.js'

test('lootFraction scales with how much of the defender you destroyed, capped 0.8', () => {
  assert.equal(lootFraction(0, 100), 0)
  assert.equal(lootFraction(50, 100), 0.4) // 0.8 * 0.5
  assert.equal(lootFraction(100, 100), 0.8)
  assert.equal(lootFraction(100, 0), 0)    // no defenders -> no loot
})

test('lootCoins multiplies fraction by defender strength and a coin rate', () => {
  // defenderStrength 200, fraction 0.4, rate 5 -> 400
  assert.equal(lootCoins(0.4, 200), 400)
})
