import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDuration, UNIT_TYPES, UNITS, travelSecondsFor, TRAVEL_NEAR_KM, TRAVEL_FAR_KM } from './units.js'

test('formatDuration humanizes seconds into h/m', () => {
  assert.equal(formatDuration(30), '30s')
  assert.equal(formatDuration(1800), '30m')
  assert.equal(formatDuration(3600), '1h')
  assert.equal(formatDuration(7200), '2h')
  assert.equal(formatDuration(5400), '1h 30m')
})

test('every unit type has stats and a travel-time band', () => {
  for (const t of UNIT_TYPES) {
    assert.ok(UNITS[t], `missing unit ${t}`)
    assert.ok(UNITS[t].minTravelSeconds > 0)
    assert.ok(UNITS[t].maxTravelSeconds >= UNITS[t].minTravelSeconds)
  }
})

test('travelSecondsFor clamps to the band and scales with distance', () => {
  // At/under NEAR → floor; at/over FAR → cap.
  assert.equal(travelSecondsFor('soldier', 0), 180)
  assert.equal(travelSecondsFor('soldier', TRAVEL_NEAR_KM), 180)
  assert.equal(travelSecondsFor('soldier', TRAVEL_FAR_KM), 600)
  assert.equal(travelSecondsFor('soldier', 99999), 600)
  // Halfway through the band → halfway between floor and cap.
  const mid = (TRAVEL_NEAR_KM + TRAVEL_FAR_KM) / 2
  assert.equal(travelSecondsFor('soldier', mid), 390) // 180 + (600-180)/2
  // On the same leg, jets are strictly faster than soldiers at every distance.
  for (const d of [0, 1000, 2500, TRAVEL_FAR_KM, 99999]) {
    assert.ok(travelSecondsFor('jet', d) < travelSecondsFor('soldier', d), `jet should beat soldier at ${d}km`)
  }
  // Farther always costs at least as much as nearer.
  assert.ok(travelSecondsFor('soldier', 2000) > travelSecondsFor('soldier', 500))
})
