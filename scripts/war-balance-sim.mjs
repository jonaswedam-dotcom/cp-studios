// Sanity-check the idle economy. Run: node scripts/war-balance-sim.mjs
import { buildingCost, incomePerTick, INCOME_PER_BANK_LEVEL_PER_HOUR } from '../src/war/buildings.js'

// Cost to take one bank from nothing to Lv 3.
const bankToMax = buildingCost('bank', 0) + buildingCost('bank', 1) + buildingCost('bank', 2)
// Income at Lv 3 per real hour (collected, no offline cap).
const lv3PerHour = incomePerTick([{ type: 'bank', level: 3 }], 3600)

const hoursToPayback = bankToMax / lv3PerHour
console.log('Bank Lv1→3 total cost:', bankToMax, 'coins')
console.log('Lv3 income/hour:', lv3PerHour, 'coins  (', INCOME_PER_BANK_LEVEL_PER_HOUR, '/level/hr )')
console.log('Hours of income to pay back one maxed bank:', hoursToPayback.toFixed(1))
console.log('Days (8h active/day):', (hoursToPayback / 8).toFixed(1))

// Crude "empire" curve: N maxed banks, collected ~8h/day, time to a 1,000,000 war chest.
for (const banks of [1, 5, 20]) {
  const perDay = lv3PerHour * banks * 8
  console.log(`${banks} maxed banks → ~${perDay.toLocaleString()}/day → ${(1_000_000 / perDay).toFixed(0)} days to 1M`)
}
