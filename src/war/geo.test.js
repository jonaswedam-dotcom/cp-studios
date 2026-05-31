import { test } from 'node:test'
import assert from 'node:assert/strict'
import { landNeighbors, distanceKm, airReachable, centroidOf, seaReachable } from './geo.js'

// Tiny fixture graph: A-B land-adjacent; C is far (other side of an ocean).
const G = {
  regions: {
    A: { name: 'A', centroid: [0, 0],   neighbors: ['B'] },
    B: { name: 'B', centroid: [1, 0],   neighbors: ['A'] },
    C: { name: 'C', centroid: [100, 0], neighbors: [] },
  },
}

test('landNeighbors returns the adjacency list', () => {
  assert.deepEqual(landNeighbors('A', G), ['B'])
  assert.deepEqual(landNeighbors('C', G), [])
})

test('centroidOf returns the stored centroid', () => {
  assert.deepEqual(centroidOf('B', G), [1, 0])
})

test('distanceKm is ~0 for same point and large across the ocean', () => {
  assert.ok(distanceKm([0, 0], [0, 0]) < 1)
  assert.ok(distanceKm([0, 0], [100, 0]) > 5000)
})

test('airReachable finds nearby provinces within range, excluding self', () => {
  const reach = airReachable('A', G, 1000) // ~111km to B, far to C
  assert.deepEqual(reach, ['B'])
})

const SEA = {
  regions: {
    P: { centroid: [0, 0],   coastal: true,  neighbors: [] },
    Q: { centroid: [5, 0],   coastal: true,  neighbors: [] },   // ~555km
    R: { centroid: [0, 0.1], coastal: false, neighbors: [] },   // close but landlocked
  },
}

test('seaReachable links coastal provinces in range, skips landlocked', () => {
  assert.deepEqual(seaReachable('P', SEA, 1000), ['Q'])
})

test('seaReachable from a landlocked province is empty', () => {
  assert.deepEqual(seaReachable('R', SEA, 100000), [])
})
