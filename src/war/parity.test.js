// Asserts the game constants in src/war/*.js match the literals embedded in the
// authoritative migration SQL. Guards the JS↔SQL duplication called out in CLAUDE.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { UNITS } from './units.js'
import { COIN_PER_STRENGTH } from './spoils.js'
import { INCOME_PER_BANK_LEVEL_PER_HOUR } from './buildings.js'

const here = dirname(fileURLToPath(import.meta.url))
const mig = (f) => readFileSync(join(here, '..', '..', 'supabase', 'migrations', f), 'utf8')

test('unit strengths match war_unit_strength() in 023', () => {
  const sql = mig('023_war_tick.sql')
  for (const [t, s] of [['soldier', 1], ['tank', 5], ['jet', 3], ['warship', 2]]) {
    assert.equal(UNITS[t].strength, s)
    assert.match(sql, new RegExp(`when '${t}' then ${s}`))
  }
})

test('bank income 50/level/hour matches buildings.js + 023', () => {
  assert.equal(INCOME_PER_BANK_LEVEL_PER_HOUR, 50)
  assert.match(mig('023_war_tick.sql'), /lv \* 50/)
})

test('loot uses COIN_PER_STRENGTH (5) and 0.8 in 023', () => {
  assert.equal(COIN_PER_STRENGTH, 5)
  assert.match(mig('023_war_tick.sql'), /0\.8 \* def_raw \* 5/)
})
