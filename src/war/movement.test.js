import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateMove, WARSHIP_CAPACITY } from './movement.js'

const graph = { regions: {
  A: { neighbors: ['B'], coastal: true,  centroid: [0, 0] },
  B: { neighbors: ['A'], coastal: true,  centroid: [0, 1] },
  C: { neighbors: [],    coastal: true,  centroid: [0, 2] },   // not land-adjacent to A
  X: { neighbors: [],    coastal: false, centroid: [20, 20] }, // ~3100km from A: in jet range, not land/sea reachable
}}

test('land move with soldiers+tanks arrives at the tank speed', () => {
  const r = validateMove('A', 'B', { soldier: 100, tank: 5 }, graph)
  assert.equal(r.mode, 'land')
  assert.equal(r.arrivesInSeconds, 240) // A→B ≈111km (< NEAR) → tank floor, the slowest in the stack
})

test('land move to a different landmass is rejected (open sea — warship only)', () => {
  // C has no land link to A (other side of an ocean), so soldiers cannot march there.
  assert.ok(validateMove('A', 'C', { soldier: 10 }, graph).error)
})

test('land move reaches a same-landmass province within range, not just direct neighbours', () => {
  // A→B→D are land-connected; D is ~222km from A but NOT a direct neighbour. Soldiers should
  // still be able to march there (previously this was rejected, forcing a jet strike).
  const g = { regions: {
    A: { neighbors: ['B'],      coastal: false, centroid: [0, 0] },
    B: { neighbors: ['A', 'D'], coastal: false, centroid: [1, 0] },
    D: { neighbors: ['B'],      coastal: false, centroid: [2, 0] },
  } }
  assert.equal(validateMove('A', 'D', { soldier: 10 }, g).mode, 'land')
})

test('land move beyond land range on the same landmass is rejected', () => {
  const g = { regions: {
    A: { neighbors: ['B'],      coastal: false, centroid: [0, 0] },
    B: { neighbors: ['A', 'F'], coastal: false, centroid: [1, 0] },
    F: { neighbors: ['B'],      coastal: false, centroid: [40, 0] }, // ~4450km from A, out of land range
  } }
  assert.ok(validateMove('A', 'F', { soldier: 10 }, g).error)
})

test('air move (jets only) reaches far provinces and scales with distance', () => {
  const r = validateMove('A', 'X', { jet: 10 }, graph)
  assert.equal(r.mode, 'air')
  assert.equal(r.arrivesInSeconds, 150) // A→X ≈3112km → jet band 60..180 at frac≈0.75
})

test('sea move ferries land units within warship capacity', () => {
  const r = validateMove('A', 'C', { warship: 5, soldier: WARSHIP_CAPACITY * 5 }, graph)
  assert.equal(r.mode, 'sea')
  assert.equal(r.arrivesInSeconds, 240) // A→C ≈222km (< NEAR) → warship floor
})

test('sea move over capacity is rejected', () => {
  assert.ok(validateMove('A', 'C', { warship: 1, soldier: WARSHIP_CAPACITY + 1 }, graph).error)
})

test('mixing jets with land units is rejected', () => {
  assert.ok(validateMove('A', 'B', { soldier: 10, jet: 1 }, graph).error)
})
