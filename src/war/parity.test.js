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
  defenseMultiplier, antiAirFactor, strengthMultiplier,
  SLOTS_PER_REGION, buildingCost } from './buildings.js'
import { armySizeMultiplier } from './economy.js'
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

test('bank income 125/level/hour matches buildings.js + live tick (048)', () => {
  // Raised 50→125 in migration 048 (income rebalance). 023's lv*50 / 038's banklv*50 superseded.
  assert.equal(INCOME_PER_BANK_LEVEL_PER_HOUR, 125)
  assert.match(mig('048_war_income_rebalance.sql'), /banklv\*125/)
  assert.match(mig('023_war_tick.sql'), /lv \* 50/) // historical original, now superseded
})

test('loot uses COIN_PER_STRENGTH (15) in the live tick (038)', () => {
  // Raised 5→15 in migration 038 (balance). 023's original `0.8 * def_raw * 5` is superseded.
  assert.equal(COIN_PER_STRENGTH, 15)
  assert.match(mig('038_war_balance.sql'), /0\.8 \* def_raw \* 15/)
  assert.match(mig('023_war_tick.sql'), /0\.8 \* def_raw \* 5/) // historical original, now superseded
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

test('province income 25/hr matches buildings.js + live tick (048)', () => {
  // Raised 10→25 in migration 048 (income rebalance). 027/038's provinces*10 superseded.
  assert.equal(INCOME_PER_PROVINCE_PER_HOUR, 25)
  assert.match(mig('048_war_income_rebalance.sql'), /provinces\*25/)
  assert.match(mig('027_war_income_territory.sql'), /provinces\*10|provinces \* 10/) // historical, superseded
})

test('START_ARMY soldiers match war_spawn() in 028', () => {
  assert.equal(START_ARMY.soldier, 500)
  assert.match(mig('028_war_spawn.sql'), /true, 500, 0, 0, 0/)
})

// 048 is the LIVE war_tick() (last create-or-replace in apply order: 023→026→027→034→036→038→048).
// Guard the live copy directly so drift in the actually-running tick is caught.
test('live tick (048) carries the combat + income constants', () => {
  const sql = mig('048_war_income_rebalance.sql')
  assert.match(sql, /banklv\*125/)                   // bank income 125/level/hr (raised 50→125 in 048)
  assert.match(sql, /provinces\*25/)                 // per-province 25/hr (raised 10→25 in 048)
  assert.match(sql, /0\.8 \* def_raw \* 15/)         // loot (raised 5→15 in 038)
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

// ── Server-authoritative war economy (migrations 052/053) ───────────────────
// 052 moves unit/building purchases server-side (DEFINER RPCs). The cost math it
// embeds MUST match the client formulas in economy.js / units.js / buildings.js,
// or a player's displayed price won't match what they're charged. 053 then revokes
// the direct client writes those RPCs replace.

test('war_buy_units (052) embeds unit costs matching units.js', () => {
  assert.equal(UNITS.soldier.cost, 100)
  assert.equal(UNITS.tank.cost, 400)
  assert.equal(UNITS.jet.cost, 800)
  assert.equal(UNITS.warship.cost, 4000)
  const sql = mig('052_war_server_authoritative.sql')
  assert.match(sql, /when 'soldier' then 100/)
  assert.match(sql, /when 'tank' then 400/)
  assert.match(sql, /when 'jet' then 800/)
  assert.match(sql, /when 'warship' then 4000/)
})

test('war_buy_units (052) army-size surcharge + factory discount match economy.js/buildings.js', () => {
  // armySizeMultiplier(strength) = 1 + 0.25 * floor(strength / 2500)
  assert.equal(armySizeMultiplier(0), 1)
  assert.equal(armySizeMultiplier(2500), 1.25)
  assert.equal(armySizeMultiplier(5200), 1.5)
  // costMultiplier(factory) = max(0.5, 1 - 0.1 * factoryLevels)
  const sql = mig('052_war_server_authoritative.sql')
  assert.match(sql, /1 \+ 0\.25 \* floor\([^/]*\/ 2500\)/)
  assert.match(sql, /greatest\(0\.5, 1 - 0\.1 \*/)
  // army strength sum must weight warship at 20 (matches 036 / units.js)
  assert.equal(UNITS.warship.strength, 20)
  assert.match(sql, /warship \* 20/)
})

test('war_build/war_upgrade (052) building costs match buildings.js arrays', () => {
  assert.deepEqual([buildingCost('bunker', 0), buildingCost('bunker', 1), buildingCost('bunker', 2)], [800, 1600, 3200])
  assert.deepEqual([buildingCost('antiair', 0), buildingCost('antiair', 1), buildingCost('antiair', 2)], [1000, 2000, 4000])
  assert.deepEqual([buildingCost('factory', 0), buildingCost('factory', 1), buildingCost('factory', 2)], [1500, 3000, 6000])
  assert.deepEqual([buildingCost('lab', 0), buildingCost('lab', 1), buildingCost('lab', 2)], [1500, 3000, 6000])
  assert.deepEqual([buildingCost('bank', 0), buildingCost('bank', 1), buildingCost('bank', 2)], [1200, 2400, 4800])
  assert.equal(buildingCost('port', 0), 2500)
  const sql = mig('052_war_server_authoritative.sql')
  assert.match(sql, /array\[800,1600,3200\]/)
  assert.match(sql, /array\[1000,2000,4000\]/)
  assert.match(sql, /array\[1500,3000,6000\]/)
  assert.match(sql, /array\[1200,2400,4800\]/)
  assert.match(sql, /array\[2500\]/)
})

test('war_build (052) enforces SLOTS_PER_REGION building cap', () => {
  assert.equal(SLOTS_PER_REGION, 3)
  assert.match(mig('052_war_server_authoritative.sql'), />= 3/)
})

test('lockdown (053) revokes client write on war_regions/buildings/movements', () => {
  const sql = mig('053_war_write_lockdown.sql')
  assert.match(sql, /revoke[^;]*update[^;]*on\s+public\.war_regions\s+from[^;]*authenticated/i)
  assert.match(sql, /revoke[^;]*on\s+public\.war_buildings\s+from[^;]*authenticated/i)
  assert.match(sql, /revoke[^;]*on\s+public\.war_movements\s+from[^;]*authenticated/i)
})
