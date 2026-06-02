import { test } from 'node:test'
import assert from 'node:assert/strict'
import { landNeighbors, distanceKm, airReachable, centroidOf, seaReachable, landReachable } from './geo.js'

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

// landReachable: a land army marches over connected land (same landmass) within range, and to
// any direct border neighbour regardless of distance — but never across open sea.
const LAND = {
  regions: {
    H: { centroid: [0, 0],  coastal: false, neighbors: ['L'] },
    L: { centroid: [1, 0],  coastal: false, neighbors: ['H', 'F'] }, // bridges H and F over land
    F: { centroid: [2, 0],  coastal: false, neighbors: ['L'] },      // ~222km, same landmass, NOT adjacent to H
    X: { centroid: [40, 0], coastal: false, neighbors: ['L'] },      // ~4450km via L: same landmass but far
    I: { centroid: [3, 0],  coastal: false, neighbors: [] },         // island: no land link to H
  },
}

test('landReachable includes same-landmass provinces within range, not just direct neighbours', () => {
  const reach = landReachable('H', LAND, 2000)
  assert.ok(reach.includes('L'), 'direct neighbour')
  assert.ok(reach.includes('F'), 'same landmass, in range, two hops away')
  assert.ok(!reach.includes('X'), 'same landmass but beyond range')
  assert.ok(!reach.includes('I'), 'different landmass (open sea between) — warship territory')
  assert.ok(!reach.includes('H'), 'excludes self')
})

test('landReachable always includes a direct border neighbour even past the range cap', () => {
  // A and B border each other but their centroids are ~4450km apart (huge adjacent countries).
  const g = { regions: {
    A: { centroid: [0, 0],  coastal: false, neighbors: ['B'] },
    B: { centroid: [40, 0], coastal: false, neighbors: ['A'] },
  } }
  assert.ok(landReachable('A', g, 2000).includes('B'))
})
