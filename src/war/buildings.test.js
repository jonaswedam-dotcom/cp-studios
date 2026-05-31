import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildingCost, SLOTS_PER_REGION, BUILDING_TYPES,
  defenseMultiplier, antiAirFactor, costMultiplier, strengthMultiplier, incomePerTick,
} from './buildings.js'

test('there are five building types and three slots', () => {
  assert.equal(BUILDING_TYPES.length, 5)
  assert.equal(SLOTS_PER_REGION, 3)
})

test('buildingCost scales by level and is Infinity past max', () => {
  assert.equal(buildingCost('bunker', 0), 800)   // build (0 -> 1)
  assert.equal(buildingCost('bunker', 1), 1600)  // upgrade (1 -> 2)
  assert.equal(buildingCost('bunker', 2), 3200)  // upgrade (2 -> 3)
  assert.equal(buildingCost('bunker', 3), Infinity)
})

test('defenseMultiplier rises with bunker level', () => {
  assert.equal(defenseMultiplier([]), 1)
  assert.equal(defenseMultiplier([{ type: 'bunker', level: 2 }]), 2) // 1 + 0.5*2
})

test('antiAirFactor caps at 0.75', () => {
  assert.equal(antiAirFactor([]), 0)
  assert.equal(antiAirFactor([{ type: 'antiair', level: 3 }]), 0.75)
})

test('global economy multipliers sum building levels', () => {
  assert.equal(costMultiplier([{ type: 'factory', level: 2 }]), 0.8)   // -10%/lvl
  assert.equal(strengthMultiplier([{ type: 'lab', level: 3 }]), 1.3)   // +10%/lvl
})

test('incomePerTick scales with bank levels and tick length', () => {
  // 2 bank levels, 3600s tick, 50 coins/level/hour -> 100
  assert.equal(incomePerTick([{ type: 'bank', level: 2 }], 3600), 100)
})
