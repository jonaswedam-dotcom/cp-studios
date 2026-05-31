// Monte-Carlo RTP harness for the Aviamasters engine.
// Run: node scripts/aviamasters-sim.mjs [rounds]
//
// RTP = P_LAND × E[min(finalMult, 250)]. We measure E directly (it does not
// depend on P_LAND), so the landing probability for a target RTP is simply
// P_LAND = TARGET_RTP / E. The script prints that recommendation plus the RTP
// implied by the current P_LAND constant.

import { generateRound, P_LAND, MAX_MULT } from '../src/pages/casino/aviamastersEngine.js'

const TARGET_RTP = 0.97
const rounds = Number(process.argv[2] ?? 1_000_000)

let sumMult = 0
let maxMult = 0
let landCount = 0
let payoutSum = 0   // realized payout multiple (only winning rounds pay)

for (let i = 0; i < rounds; i++) {
  const r = generateRound(Math.random)
  const capped = Math.min(r.finalMult, MAX_MULT)
  sumMult += capped
  if (capped > maxMult) maxMult = capped
  if (r.outcome === 'land') {
    landCount++
    payoutSum += capped
  }
}

const eMult = sumMult / rounds
const measuredRtp = payoutSum / rounds
const recommendedPLand = TARGET_RTP / eMult

console.log(`rounds:                 ${rounds.toLocaleString()}`)
console.log(`E[min(mult,250)]:       ${eMult.toFixed(4)}`)
console.log(`max mult observed:      ${maxMult.toFixed(2)}`)
console.log(`current P_LAND:         ${P_LAND.toFixed(4)}`)
console.log(`win rate (this run):    ${(landCount / rounds * 100).toFixed(2)}%`)
console.log(`measured RTP:           ${(measuredRtp * 100).toFixed(2)}%`)
console.log(`recommended P_LAND:     ${recommendedPLand.toFixed(4)}  (for ${(TARGET_RTP * 100)}% RTP)`)
