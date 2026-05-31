import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickRandomSpawn } from './spawn.js'

const G = { regions: { A: {}, B: {}, C: {} } }

test('returns an unclaimed region', () => {
  const claimed = new Set(['A', 'B'])
  assert.equal(pickRandomSpawn(G, claimed, () => 0), 'C')
})

test('rng selects across the unclaimed list', () => {
  const claimed = new Set()
  assert.equal(pickRandomSpawn(G, claimed, () => 0), 'A')
  assert.equal(pickRandomSpawn(G, claimed, () => 0.99), 'C')
})

test('returns null when everything is claimed', () => {
  assert.equal(pickRandomSpawn(G, new Set(['A', 'B', 'C']), () => 0), null)
})
