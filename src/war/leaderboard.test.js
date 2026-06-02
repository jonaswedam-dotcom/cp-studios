import { test } from 'node:test'
import assert from 'node:assert/strict'
import { playerPower, rankPlayers } from './leaderboard.js'

test('playerPower combines provinces, strength/100 and building levels', () => {
  assert.equal(playerPower({ regionCount: 3, strength: 500, buildingLevels: 2 }), 3 + 5 + 2)
})

test('rankPlayers ranks a small-but-mighty turtle above a wide weak sprawler', () => {
  const players = [
    { user_id: 'turtle', display_name: 'T' },
    { user_id: 'sprawl', display_name: 'S' },
  ]
  const regions = {
    t1: { region_id: 't1', owner_id: 'turtle', soldier: 0, tank: 200, jet: 0, warship: 0 }, // strength 1000
    s1: { region_id: 's1', owner_id: 'sprawl', soldier: 1, tank: 0, jet: 0, warship: 0 },
    s2: { region_id: 's2', owner_id: 'sprawl', soldier: 1, tank: 0, jet: 0, warship: 0 },
    s3: { region_id: 's3', owner_id: 'sprawl', soldier: 1, tank: 0, jet: 0, warship: 0 },
  }
  const ranked = rankPlayers(players, regions, [])
  assert.equal(ranked[0].user_id, 'turtle') // 1 + 1000/100 + 0 = 11  >  sprawl 3 + 0.03
  assert.equal(ranked[0].regionCount, 1)
  assert.equal(ranked[1].regionCount, 3)
})

test('rankPlayers counts building levels toward power and respects the limit', () => {
  const players = [{ user_id: 'a', display_name: 'A' }, { user_id: 'b', display_name: 'B' }]
  const regions = { r: { region_id: 'r', owner_id: 'a', soldier: 0, tank: 0, jet: 0, warship: 0 } }
  const buildings = [{ owner_id: 'a', level: 3 }, { owner_id: 'a', level: 2 }]
  const ranked = rankPlayers(players, regions, buildings, 1)
  assert.equal(ranked.length, 1)
  assert.equal(ranked[0].user_id, 'a')
  assert.equal(ranked[0].buildingLevels, 5)
})
