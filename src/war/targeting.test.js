import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sourcesForDest, computeTargets } from './targeting.js'

// ── Fixture world (centroids ~111km per degree of lng at the equator) ──────────
//   ME1 is a coastal HQ with every unit type; ME2 is a small inland province.
//   ENEMY_ADJ / NEUTRAL_ADJ border ME1. ENEMY_FAR_AIR & COAST_FAR are only
//   reachable by air/sea. ENEMY_FAR_OOR is out of every range.
const G = {
  regions: {
    ME1:           { centroid: [0, 0],    coastal: true,  neighbors: ['ENEMY_ADJ', 'NEUTRAL_ADJ', 'ME2'] },
    ME2:           { centroid: [0.1, 0],  coastal: false, neighbors: ['ME1', 'NEUTRAL_ADJ'] },
    ENEMY_ADJ:     { centroid: [0.2, 0],  coastal: false, neighbors: ['ME1'] },           // ~22km, bordering
    NEUTRAL_ADJ:   { centroid: [-0.2, 0], coastal: false, neighbors: ['ME1', 'ME2'] },    // ~22km, bordering, unclaimed
    ENEMY_FAR_AIR: { centroid: [3, 0],    coastal: false, neighbors: [] },                // ~333km, air only
    COAST_FAR:     { centroid: [2, 0],    coastal: true,  neighbors: [] },                // ~222km, sea + air
    ENEMY_FAR_OOR: { centroid: [80, 0],   coastal: false, neighbors: [] },                // ~8900km, out of range
    NEUTRAL_FAR_AIR:{ centroid: [3, 0.1], coastal: false, neighbors: [] },                // ~333km, unclaimed, air only
  },
}

const REGIONS = {
  ME1:           { region_id: 'ME1',           owner_id: 'me',     soldier: 500, tank: 10, jet: 5, warship: 3 },
  ME2:           { region_id: 'ME2',           owner_id: 'me',     soldier: 50,  tank: 0,  jet: 0, warship: 0 },
  ENEMY_ADJ:     { region_id: 'ENEMY_ADJ',     owner_id: 'enemyA', soldier: 100, tank: 0,  jet: 0, warship: 0 },
  ENEMY_FAR_AIR: { region_id: 'ENEMY_FAR_AIR', owner_id: 'enemyB', soldier: 50,  tank: 0,  jet: 0, warship: 0 },
  COAST_FAR:     { region_id: 'COAST_FAR',     owner_id: 'enemyD', soldier: 50,  tank: 0,  jet: 0, warship: 0 },
  ENEMY_FAR_OOR: { region_id: 'ENEMY_FAR_OOR', owner_id: 'enemyC', soldier: 50,  tank: 0,  jet: 0, warship: 0 },
  // NEUTRAL_ADJ and NEUTRAL_FAR_AIR have no rows -> unclaimed neutral garrisons.
}

const OPTS = { userId: 'me', airRangeKm: 4500, seaRangeKm: 7000 }
const kindOf = (targets) => Object.fromEntries(targets.map((t) => [t.id, t.kind]))

// ── computeTargets: the bounded "what glows" set ───────────────────────────────

test('computeTargets badges bordering enemies as attack and neutrals as expand', () => {
  const k = kindOf(computeTargets(REGIONS, G, OPTS))
  assert.equal(k.ENEMY_ADJ, 'attack')
  assert.equal(k.NEUTRAL_ADJ, 'expand')
})

test('computeTargets badges claimed enemies reachable only by air or sea', () => {
  const k = kindOf(computeTargets(REGIONS, G, OPTS))
  assert.equal(k.ENEMY_FAR_AIR, 'attack') // air-only
  assert.equal(k.COAST_FAR, 'attack')     // sea + air
})

test('computeTargets never badges your own provinces (no reinforce noise)', () => {
  const k = kindOf(computeTargets(REGIONS, G, OPTS))
  assert.equal(k.ME1, undefined)
  assert.equal(k.ME2, undefined)
})

test('computeTargets excludes targets out of every range', () => {
  const k = kindOf(computeTargets(REGIONS, G, OPTS))
  assert.equal(k.ENEMY_FAR_OOR, undefined)
})

test('computeTargets does NOT badge distant unclaimed neutrals (air/sea), only claimed', () => {
  const k = kindOf(computeTargets(REGIONS, G, OPTS))
  assert.equal(k.NEUTRAL_FAR_AIR, undefined)
})

test('computeTargets drops shielded enemies', () => {
  const k = kindOf(computeTargets(REGIONS, G, { ...OPTS, shieldedOwnerIds: new Set(['enemyA']) }))
  assert.equal(k.ENEMY_ADJ, undefined) // shielded -> not badged
  assert.equal(k.NEUTRAL_ADJ, 'expand') // others unaffected
})

test('computeTargets requires land units to badge a bordering province', () => {
  // S borders E, but E is far (out of air range) so only a land attack is possible.
  const g = { regions: {
    S: { centroid: [0, 0],  coastal: false, neighbors: ['E'] },
    E: { centroid: [50, 0], coastal: false, neighbors: ['S'] }, // ~5500km, out of air range
  } }
  const noLand = { S: { region_id: 'S', owner_id: 'me', soldier: 0, tank: 0, jet: 9, warship: 9 },
                   E: { region_id: 'E', owner_id: 'foe', soldier: 1 } }
  assert.equal(kindOf(computeTargets(noLand, g, OPTS)).E, undefined)

  const withLand = { ...noLand, S: { ...noLand.S, soldier: 1 } }
  assert.equal(kindOf(computeTargets(withLand, g, OPTS)).E, 'attack')
})

// ── sourcesForDest: the permissive "what a click can do" set ───────────────────

test('sourcesForDest prefers land over air for a bordering enemy', () => {
  const s = sourcesForDest('ENEMY_ADJ', REGIONS, G, OPTS)
  assert.deepEqual(s[0], { from: 'ME1', mode: 'land' })
  assert.ok(s.some((x) => x.from === 'ME1' && x.mode === 'air'))
})

test('sourcesForDest returns an air-only source for a non-bordering land enemy', () => {
  const s = sourcesForDest('ENEMY_FAR_AIR', REGIONS, G, OPTS)
  assert.deepEqual(s, [{ from: 'ME1', mode: 'air' }])
})

test('sourcesForDest prefers sea over air for a coastal target in range', () => {
  const s = sourcesForDest('COAST_FAR', REGIONS, G, OPTS)
  assert.deepEqual(s[0], { from: 'ME1', mode: 'sea' })
  assert.ok(s.some((x) => x.from === 'ME1' && x.mode === 'air'))
})

test('sourcesForDest is permissive: distant unclaimed neutrals are clickable by air', () => {
  const s = sourcesForDest('NEUTRAL_FAR_AIR', REGIONS, G, OPTS)
  assert.deepEqual(s, [{ from: 'ME1', mode: 'air' }])
})

test('sourcesForDest is empty for an unreachable province (no dead-click panel)', () => {
  assert.deepEqual(sourcesForDest('ENEMY_FAR_OOR', REGIONS, G, OPTS), [])
})

test('sourcesForDest orders same-mode sources by largest army first', () => {
  // NEUTRAL_ADJ borders both ME1 (army 510) and ME2 (army 50).
  const s = sourcesForDest('NEUTRAL_ADJ', REGIONS, G, OPTS)
  const land = s.filter((x) => x.mode === 'land')
  assert.deepEqual(land.map((x) => x.from), ['ME1', 'ME2'])
})
