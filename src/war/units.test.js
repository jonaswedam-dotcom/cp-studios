import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDuration, UNIT_TYPES, UNITS } from './units.js'

test('formatDuration humanizes seconds into h/m', () => {
  assert.equal(formatDuration(30), '30s')
  assert.equal(formatDuration(1800), '30m')
  assert.equal(formatDuration(3600), '1h')
  assert.equal(formatDuration(7200), '2h')
  assert.equal(formatDuration(5400), '1h 30m')
})

test('every unit type has stats and a travel time', () => {
  for (const t of UNIT_TYPES) {
    assert.ok(UNITS[t], `missing unit ${t}`)
    assert.ok(UNITS[t].travelSeconds > 0)
  }
})
