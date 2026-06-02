import { UNIT_TYPES, UNITS } from './units.js'

// Composite "power" so the leaderboard rewards total might, not just raw land grabbed (which
// previously rewarded wide-but-shallow turtling). Provinces + army strength (÷100) + total
// building levels. Tunable weights.
export function playerPower({ regionCount, strength, buildingLevels }) {
  return regionCount + strength / 100 + buildingLevels
}

// Rank players by power, richest first, returning the top `limit` with their breakdown attached.
export function rankPlayers(players, regions, buildings, limit = 8) {
  const regionRows = Object.values(regions)
  return players
    .map((p) => {
      const mine = regionRows.filter((r) => r.owner_id === p.user_id)
      const regionCount = mine.length
      const strength = mine.reduce(
        (s, r) => s + UNIT_TYPES.reduce((a, t) => a + (r[t] || 0) * UNITS[t].strength, 0), 0)
      const buildingLevels = buildings
        .filter((b) => b.owner_id === p.user_id)
        .reduce((s, b) => s + (b.level || 0), 0)
      return { ...p, regionCount, strength, buildingLevels, power: playerPower({ regionCount, strength, buildingLevels }) }
    })
    .sort((a, b) => b.power - a.power)
    .slice(0, limit)
}
