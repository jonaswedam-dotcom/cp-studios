import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeEvent } from './events.js'

const graph = { regions: { FR1: { city: 'Lyon' }, EG1: { city: 'Cairo' } } }

test('captured event shows city + coins', () => {
  const { icon, text } = describeEvent(
    { kind: 'captured', region_id: 'FR1', detail: { coins: 2400, opponent: 'Alex' } }, graph)
  assert.equal(icon, '⚔')
  assert.match(text, /Lyon/)
  assert.match(text, /2,400/)
})

test('lost event names the attacker', () => {
  const { text } = describeEvent(
    { kind: 'lost', region_id: 'EG1', detail: { opponent: 'Alex' } }, graph)
  assert.match(text, /Cairo/)
  assert.match(text, /Alex/)
})

test('unknown region falls back to the id', () => {
  const { text } = describeEvent({ kind: 'defended', region_id: 'ZZ9', detail: {} }, graph)
  assert.match(text, /ZZ9/)
})
