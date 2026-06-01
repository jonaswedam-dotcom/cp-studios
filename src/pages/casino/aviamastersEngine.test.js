import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  pickWeighted,
  generateRound,
  MAX_MULT,
  START_MULT,
  applyBooster,
  assignBadgePositions,
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

// Build a minimal events array where each entry has kind, value, multAfter.
function makeEvents(...kinds) {
  let mult = 1
  return kinds.map(kind => {
    if (kind === 'rocket') mult = mult / 2
    else if (kind === 'add')  mult = mult + 0.5
    else if (kind === 'mult') mult = mult * 2
    return { kind, value: kind === 'rocket' ? 2 : kind === 'mult' ? 2 : 0.5, multAfter: mult }
  })
}

test('applyBooster laser_gun marks the next rocket as skipped', () => {
  // events: [add, rocket, add] — currentIdx=0 → remaining starts at index 1
  const events = makeEvents('add', 'rocket', 'add')
  const { events: out, outcome } = applyBooster(events, 0, 'laser_gun', 'splash')
  assert.equal(out[1].skipped, true)
  assert.equal(out.length, 3)
  assert.equal(outcome, 'splash') // laser_gun does not change outcome
})

test('applyBooster magnet converts next rocket to add +0.5 and flips splash→land', () => {
  const events = makeEvents('add', 'rocket', 'add')
  const { events: out, outcome } = applyBooster(events, 0, 'magnet', 'splash')
  assert.equal(out[1].kind, 'add')
  assert.equal(out[1].value, 0.5)
  assert.equal(outcome, 'land')
})

test('applyBooster nitro marks all remaining rockets as skipped, non-rockets untouched', () => {
  // currentIdx=-1 → all events are remaining
  const events = makeEvents('rocket', 'add', 'rocket')
  const { events: out } = applyBooster(events, -1, 'nitro', 'land')
  assert.equal(out[0].skipped, true)
  assert.equal(out[1].skipped, undefined)
  assert.equal(out[2].skipped, true)
})

test('applyBooster life_buoy flips splash to land without changing events', () => {
  const events = makeEvents('add', 'rocket')
  const { events: out, outcome } = applyBooster(events, 0, 'life_buoy', 'splash')
  assert.equal(outcome, 'land')
  assert.strictEqual(out, events)
})

test('assignBadgePositions: land outcome produces end altitude >= 0.75', () => {
  const events = makeEvents('add', 'mult')
  const { controlPts } = assignBadgePositions(events, 'land')
  const last = controlPts[controlPts.length - 1]
  assert.ok(last.altitude >= 0.75, `expected >= 0.75 got ${last.altitude}`)
})

test('assignBadgePositions: splash outcome produces end altitude <= 0.15', () => {
  const events = makeEvents('rocket', 'add')
  const { controlPts } = assignBadgePositions(events, 'splash')
  const last = controlPts[controlPts.length - 1]
  assert.ok(last.altitude <= 0.15, `expected <= 0.15 got ${last.altitude}`)
})

test('assignBadgePositions: intermediate control points clamped to [0.08, 0.92]', () => {
  const events = makeEvents('rocket', 'rocket', 'rocket', 'rocket', 'rocket')
  const { controlPts } = assignBadgePositions(events, 'splash')
  const mid = controlPts.slice(1, -1)
  for (const pt of mid) {
    assert.ok(pt.altitude >= 0.08, `altitude ${pt.altitude} below 0.08`)
    assert.ok(pt.altitude <= 0.92, `altitude ${pt.altitude} above 0.92`)
  }
})

test('assignBadgePositions: badges have evenly spaced t-values and applied: false', () => {
  const events = makeEvents('add', 'rocket', 'mult')
  const { badges } = assignBadgePositions(events, 'land')
  assert.equal(badges.length, 3)
  assert.ok(Math.abs(badges[0].t - 1/4) < 0.001)
  assert.ok(Math.abs(badges[1].t - 2/4) < 0.001)
  assert.ok(Math.abs(badges[2].t - 3/4) < 0.001)
  for (const b of badges) assert.equal(b.applied, false)
})
