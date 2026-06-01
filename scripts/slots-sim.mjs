// Monte-Carlo RTP / hit-rate report for the slots engine.
// Run: node scripts/slots-sim.mjs [spins]   (default 5,000,000)
import {
  spinGrid, evaluateGrid, netForBet, theoreticalRTP, PAYLINES,
} from '../src/pages/casino/slotsEngine.js'

const N = Number(process.argv[2] || 5_000_000)
let sumReturn = 0, win = 0, push = 0, loss = 0, maxReturn = 0

for (let n = 0; n < N; n++) {
  const { totalReturn } = evaluateGrid(spinGrid())
  sumReturn += totalReturn
  if (totalReturn > maxReturn) maxReturn = totalReturn
  const net = netForBet(totalReturn, 1)
  if (net > 0) win++
  else if (net === 0) push++
  else loss++
}

const pct = (x) => (x / N * 100).toFixed(2) + '%'
console.log(`spins               ${N.toLocaleString()}`)
console.log(`paylines            ${PAYLINES.length}`)
console.log(`RTP (closed-form)   ${(theoreticalRTP() * 100).toFixed(2)}%`)
console.log(`RTP (monte-carlo)   ${(sumReturn / N * 100).toFixed(2)}%`)
console.log(`house edge          ${((1 - sumReturn / N) * 100).toFixed(2)}%`)
console.log(`hit rate (win+push) ${pct(win + push)}`)
console.log(`  net-positive win  ${pct(win)}`)
console.log(`  push (bet back)   ${pct(push)}`)
console.log(`  loss              ${pct(loss)}`)
console.log(`largest return seen ${maxReturn}x`)
