import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stackStrength, stackTotal, resolveCombat, emptyStack } from './combat.js'

test('stackStrength weights tanks and jets', () => {
  assert.equal(stackStrength({ soldier: 10, tank: 0, jet: 0 }), 10)
  assert.equal(stackStrength({ soldier: 0, tank: 2, jet: 0 }), 10)
  assert.equal(stackStrength({ soldier: 1, tank: 1, jet: 1 }), 9)
})

test('attacker win leaves survivors proportional to remaining strength', () => {
  const r = resolveCombat({ soldier: 100 }, { soldier: 40 })
  assert.equal(r.winner, 'attacker')
  assert.equal(r.survivors.soldier, 60)
})

test('defender win keeps proportional survivors', () => {
  const r = resolveCombat({ soldier: 30 }, { soldier: 80 })
  assert.equal(r.winner, 'defender')
  assert.equal(r.survivors.soldier, 50)
})

test('exact tie -> defender holds with a token survivor', () => {
  const r = resolveCombat({ soldier: 50 }, { soldier: 50 })
  assert.equal(r.winner, 'defender')
  assert.equal(stackTotal(r.survivors), 1)
})

test('emptyStack has all unit types at 0', () => {
  assert.deepEqual(emptyStack(), { soldier: 0, tank: 0, jet: 0, warship: 0 })
})

test('a razor-thin attacker win still keeps at least one unit (no ghost province)', () => {
  // 1 tank (str 5) vs 4 soldiers (str 4): attacker wins; floor would give 0 tanks.
  const r = resolveCombat({ tank: 1 }, { soldier: 4 })
  assert.equal(r.winner, 'attacker')
  assert.ok(stackTotal(r.survivors) >= 1)
})

test('bunker defenseMult lets a smaller defender win', () => {
  // 100 atk vs 60 def, but x2 bunker -> def 120 > 100
  const r = resolveCombat({ soldier: 100 }, { soldier: 60 }, { defenseMult: 2 })
  assert.equal(r.winner, 'defender')
})

test('antiAir removes incoming jet strength', () => {
  // 10 jets = 30 atk str; 0.5 anti-air removes 15 -> 15 atk vs 20 def -> defender
  const r = resolveCombat({ jet: 10 }, { soldier: 20 }, { antiAir: 0.5 })
  assert.equal(r.winner, 'defender')
})
