import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  pickWeighted,
  generateRound,
  MAX_MULT,
  START_MULT,
} from './aviamastersEngine.js'

// Deterministic RNG that replays a fixed queue of values, then 0.
function seq(values) {
  let i = 0
  return () => (i < values.length ? values[i++] : 0)
}

test('pickWeighted returns first value when rng is 0', () => {
  const table = [{ value: 'a', weight: 1 }, { value: 'b', weight: 3 }]
  assert.equal(pickWeighted(table, () => 0), 'a')
})

test('pickWeighted lands in the correct weight bucket', () => {
  const table = [{ value: 'a', weight: 1 }, { value: 'b', weight: 3 }]
  // total weight 4; rng 0.5 -> 2.0 into the line -> past 'a' (1), into 'b'
  assert.equal(pickWeighted(table, () => 0.5), 'b')
})

test('generateRound returns a well-formed round', () => {
  const r = generateRound(Math.random)
  assert.ok(Array.isArray(r.events))
  assert.ok(r.events.length >= 1)
  assert.ok(['land', 'splash'].includes(r.outcome))
  assert.ok(typeof r.finalMult === 'number')
  assert.ok(r.finalMult <= MAX_MULT)
  for (const e of r.events) {
    assert.ok(['mult', 'add', 'rocket'].includes(e.kind))
    assert.ok(typeof e.value === 'number')
    assert.ok(typeof e.multAfter === 'number')
  }
})

test('finalMult never exceeds MAX_MULT even on a huge run', () => {
  // Force: max node count, every slot a value node (no rocket), every node the
  // richest multiplicative value, and a land outcome.
  // Slot loop per node calls rng() in this order:
  //   1) rocket roll (want > ROCKET_CHANCE -> 0.99 = no rocket)
  //   2) mult-vs-add roll (want < MULT_NODE_SHARE -> 0 = multiplicative)
  //   3) pickWeighted over MULT_NODES (want last/richest -> 0.999)
  // nodeCount roll first (want richest count -> 0.999), outcome last (0 -> land)
  const rng = seq([
    0.999,                                  // node count -> max
    ...Array(40).fill(0).flatMap(() => [0.99, 0, 0.999]), // 10 slots * 3 rolls (extra ok)
    0,                                      // outcome -> land
  ])
  const r = generateRound(rng)
  assert.ok(r.finalMult <= MAX_MULT, `finalMult ${r.finalMult} > ${MAX_MULT}`)
})

test('a rocket halves the running multiplier', () => {
  // 1 node, force it to be a rocket: nodeCount roll -> small (1 node),
  // slot rocket roll -> 0 (< ROCKET_CHANCE = rocket), outcome -> land.
  const rng = seq([
    0,    // node count -> minimum (1)
    0,    // slot 1 rocket roll -> rocket
    0,    // outcome -> land
  ])
  const r = generateRound(rng)
  assert.equal(r.events.length, 1)
  assert.equal(r.events[0].kind, 'rocket')
  assert.equal(r.events[0].multAfter, START_MULT / 2)
  assert.equal(r.finalMult, START_MULT / 2)
})
