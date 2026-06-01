// Asserts the game constants in src/war/*.js match the literals embedded in the
// authoritative migration SQL. Guards the JS↔SQL duplication called out in CLAUDE.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { UNITS, START_ARMY } from './units.js'
import { COIN_PER_STRENGTH } from './spoils.js'
import { INCOME_PER_BANK_LEVEL_PER_HOUR, INCOME_PER_PROVINCE_PER_HOUR } from './buildings.js'
import { RETREAT_FRACTION, RNG_MIN, RNG_SPAN } from './combat.js'

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

test('combat RNG band + retreat fraction match 026 tick', () => {
  assert.equal(RNG_MIN, 0.85)
  assert.equal(RNG_SPAN, 0.30)
  assert.equal(RETREAT_FRACTION, 0.25)
  const sql = mig('026_war_combat_v2.sql')
  assert.match(sql, /0\.85 \+ random\(\) \* 0\.30/)
  assert.match(sql, /\* 0\.25/) // attacker retreat keeps 25%
})

test('unit strengths match war_stack_strength() in 026', () => {
  const sql = mig('026_war_combat_v2.sql')
  assert.match(sql, /'soldier'\)::numeric,0\)\*1/)
  assert.match(sql, /'tank'\)::numeric,0\)\*5/)
  assert.match(sql, /'jet'\)::numeric,0\)\*3/)
  assert.match(sql, /'warship'\)::numeric,0\)\*2/)
})

test('province income 10/hr matches 027', () => {
  assert.equal(INCOME_PER_PROVINCE_PER_HOUR, 10)
  assert.match(mig('027_war_income_territory.sql'), /provinces\*10|provinces \* 10/)
})

test('START_ARMY soldiers match war_spawn() in 028', () => {
  assert.equal(START_ARMY.soldier, 500)
  assert.match(mig('028_war_spawn.sql'), /true, 500, 0, 0, 0/)
})
