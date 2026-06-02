// Asserts the game constants in src/war/*.js match the literals embedded in the
// authoritative migration SQL. Guards the JS↔SQL duplication called out in CLAUDE.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { UNITS, START_ARMY } from './units.js'
import { COIN_PER_STRENGTH } from './spoils.js'
import { INCOME_PER_BANK_LEVEL_PER_HOUR, INCOME_PER_PROVINCE_PER_HOUR,
  defenseMultiplier, antiAirFactor, strengthMultiplier } from './buildings.js'
import { RETREAT_FRACTION, RNG_MIN, RNG_SPAN } from './combat.js'
import { neutralGarrison } from './neutral.js'

const here = dirname(fileURLToPath(import.meta.url))
const mig = (f) => readFileSync(join(here, '..', '..', 'supabase', 'migrations', f), 'utf8')

test('soldier/tank/jet strengths still match the legacy war_unit_strength() in 023', () => {
  // warship strength was raised to 20 in migration 036 (see the OP-warship test below),
  // so it no longer matches the historical literal in 023.
  const sql = mig('023_war_tick.sql')
  for (const [t, s] of [['soldier', 1], ['tank', 5], ['jet', 3]]) {
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

test('soldier/tank/jet stack strengths match war_stack_strength() in 026', () => {
  const sql = mig('026_war_combat_v2.sql')
  assert.match(sql, /'soldier'\)::numeric,0\)\*1/)
  assert.match(sql, /'tank'\)::numeric,0\)\*5/)
  assert.match(sql, /'jet'\)::numeric,0\)\*3/)
  // warship strength was raised to 20 in migration 036 (see the OP-warship test below).
})

test('province income 10/hr matches 027', () => {
  assert.equal(INCOME_PER_PROVINCE_PER_HOUR, 10)
  assert.match(mig('027_war_income_territory.sql'), /provinces\*10|provinces \* 10/)
})

test('START_ARMY soldiers match war_spawn() in 028', () => {
  assert.equal(START_ARMY.soldier, 500)
  assert.match(mig('028_war_spawn.sql'), /true, 500, 0, 0, 0/)
})

// 036 is the LIVE war_tick() (last create-or-replace in apply order: 023→026→027→034→036).
// Guard the live copy directly so drift in the actually-running tick is caught.
test('live tick (036) carries the combat + income constants', () => {
  const sql = mig('036_war_ports_and_warship.sql')
  assert.match(sql, /banklv\*50/)                    // bank income 50/level/hr
  assert.match(sql, /provinces\*10/)                 // per-province 10/hr
  assert.match(sql, /0\.8 \* def_raw \* 5/)          // loot
  assert.match(sql, /0\.85 \+ random\(\) \* 0\.30/)  // RNG band
  assert.match(sql, /\* 0\.25/)                      // attacker retreat
  assert.match(sql, /1 \+ 0\.5 \* def_bunker/)       // bunker +0.5/level
  assert.match(sql, /1 \+ 0\.1 \* atk_lab/)          // lab +0.1/level
  assert.match(sql, /\* 1\.5/)                       // offline dug-in
  assert.match(sql, /least\(0\.75, 0\.25 \* def_aa\)/) // anti-air min(0.75, 0.25/level)
})

test('OP warship strength (20) + port requirement match the live SQL in 036', () => {
  const sql = mig('036_war_ports_and_warship.sql')
  assert.equal(UNITS.warship.strength, 20)            // raised from 2 → "really OP"
  assert.equal(UNITS.warship.requiresPort, true)      // can only be built once you own a port
  assert.match(sql, /'warship'\)::numeric,0\)\*20/)   // attacker stack strength (war_stack_strength)
  assert.match(sql, /dest\.warship \* 20/)            // defender formula in the live tick
  assert.match(sql, /'bunker','antiair','factory','lab','bank','port'/) // port allowed by the type check
})

test('building multipliers match the SQL literals', () => {
  assert.equal(defenseMultiplier([{ type: 'bunker', level: 2 }]), 1 + 0.5 * 2)
  assert.equal(strengthMultiplier([{ type: 'lab', level: 3 }]), 1 + 0.1 * 3)
  assert.equal(antiAirFactor([{ type: 'antiair', level: 2 }]), Math.min(0.75, 0.25 * 2))
})

test('neutral garrison hash matches war_neutral_soldiers() in 023', () => {
  const g = neutralGarrison('FR1').soldier
  assert.ok(g >= 50 && g <= 300)
  assert.match(mig('023_war_tick.sql'), /50 \+ \(h % 251\)/)
})
