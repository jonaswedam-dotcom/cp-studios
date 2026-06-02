// casino-sim.mjs — Monte-Carlo RTP / win-rate / distribution report for every
// server-authoritative casino game, driven by the SAME pure engines the SQL RPCs
// mirror. Node ESM, no deps.
//
// Run: node scripts/casino-sim.mjs [trials]   (default 1,000,000)
//
// For each game it prints measured RTP (gross return per unit bet), win rate, and a
// short distribution, then asserts the measured RTP is within tolerance of the value
// implied by the game's current odds. Single-shot games use a fixed bet=1000 (so the
// floor() rounding in the engines is exercised the same way the SQL does). Mines /
// Chicken use a fixed cash-out strategy; Plinko uses a fixed (rows, risk) config.

import { resolveDice } from '../src/pages/casino/diceEngine.js'
import { resolveCoinFlip } from '../src/pages/casino/coinflipEngine.js'
import { resolveRoulette } from '../src/pages/casino/rouletteEngine.js'
import { resolveSlots, theoreticalRTP } from '../src/pages/casino/slotsEngine.js'
import { resolvePlinko, MULTIPLIERS } from '../src/pages/casino/plinkoGeom.js'
import { minesMult, buildMines } from '../src/pages/casino/minesEngine.js'
import {
  preRollLanes, chickenPayout, LANE_MULTIPLIERS, SAFE_PROBS,
} from '../src/pages/casino/chickenEngine.js'
import {
  buildDeck, shuffle, handValue, isBlackjack, dealerPlay, settle,
} from '../src/pages/casino/blackjackEngine.js'

const N = Number(process.argv[2] || 1_000_000)
const BET = 1000

let failures = 0
const pct = (x) => (x * 100).toFixed(2) + '%'

// rtp = gross returned per unit staked = (sumReturned) / (sumStaked).
// delta-based engines return a NET delta; gross returned = stake + delta.
function report(name, { rtp, winRate, target, tol, extra }) {
  const ok = Math.abs(rtp - target) <= tol
  if (!ok) failures++
  console.log(
    `${name.padEnd(16)} RTP ${pct(rtp).padStart(8)}  ` +
    `(target ${pct(target)}, ±${(tol * 100).toFixed(1)}pp)  ` +
    `win ${pct(winRate).padStart(7)}  ${ok ? 'OK ' : 'FAIL'}` +
    (extra ? `  ${extra}` : '')
  )
}

// ── Dice ─────────────────────────────────────────────────────────────────────
// guess fixed at 6; win → +bet*4 (gross 5x), else -bet. RTP = (1/6)*5 = 0.8333.
{
  let staked = 0, returned = 0, wins = 0
  for (let i = 0; i < N; i++) {
    const r = resolveDice({ bet: BET, guess: 6 })
    staked += BET; returned += BET + r.delta
    if (r.win) wins++
  }
  report('dice', { rtp: returned / staked, winRate: wins / N, target: 5 / 6, tol: 0.01 })
}

// ── Coin Flip ──────────────────────────────────────────────────────────────────
// choice heads; win → +floor(bet*0.95) (gross 1.95x at bet=1000), else -bet.
// RTP = 0.5 * 1.95 = 0.975.
{
  let staked = 0, returned = 0, wins = 0
  for (let i = 0; i < N; i++) {
    const r = resolveCoinFlip({ bet: BET, choice: 'heads' })
    staked += BET; returned += BET + r.delta
    if (r.win) wins++
  }
  report('coinflip', { rtp: returned / staked, winRate: wins / N, target: 0.975, tol: 0.01 })
}

// ── Roulette (red even-money) ──────────────────────────────────────────────────
// P(win) = 18/37; gross 2x on win. RTP = (18/37)*2 ≈ 0.9730.
{
  let staked = 0, returned = 0, wins = 0
  for (let i = 0; i < N; i++) {
    const r = resolveRoulette({ bet: BET, kind: 'red' })
    staked += BET; returned += BET + r.delta
    if (r.win) wins++
  }
  report('roulette-red', { rtp: returned / staked, winRate: wins / N, target: (18 / 37) * 2, tol: 0.01 })
}

// ── Roulette (straight number) ─────────────────────────────────────────────────
// P(win) = 1/37; gross 36x on win. RTP = (1/37)*36 ≈ 0.9730.
{
  let staked = 0, returned = 0, wins = 0
  for (let i = 0; i < N; i++) {
    const r = resolveRoulette({ bet: BET, kind: 'number', number: 17 })
    staked += BET; returned += BET + r.delta
    if (r.win) wins++
  }
  report('roulette-num', { rtp: returned / staked, winRate: wins / N, target: (1 / 37) * 36, tol: 0.01 })
}

// ── Slots ───────────────────────────────────────────────────────────────────
// Compare measured RTP against the engine's closed-form theoreticalRTP() (92-94% band).
{
  let staked = 0, returned = 0, wins = 0
  for (let i = 0; i < N; i++) {
    const r = resolveSlots({ bet: BET })
    staked += BET; returned += BET + r.net
    if (r.net > 0) wins++
  }
  const target = theoreticalRTP()
  report('slots', { rtp: returned / staked, winRate: wins / N, target, tol: 0.02,
    extra: `closed-form ${pct(target)}` })
}

// ── Plinko (12 rows, medium) ────────────────────────────────────────────────
// RTP target = exact binomial expectation over the multiplier table for this config.
{
  const rows = 12, risk = 'medium'
  const tbl = MULTIPLIERS[rows][risk]
  // exact binomial(rows, 0.5) expected multiplier
  const binom = (n, k) => { let c = 1; for (let i = 0; i < k; i++) c = c * (n - i) / (i + 1); return c }
  let target = 0
  for (let s = 0; s <= rows; s++) target += (binom(rows, s) / 2 ** rows) * tbl[s]

  let staked = 0, returned = 0, wins = 0
  const slots = {}
  for (let i = 0; i < N; i++) {
    const r = resolvePlinko({ bet: BET, rows, risk })
    staked += BET; returned += BET + r.delta
    if (r.delta > 0) wins++
    slots[r.slot] = (slots[r.slot] || 0) + 1
  }
  report('plinko-12-med', { rtp: returned / staked, winRate: wins / N, target, tol: 0.02,
    extra: `exact ${pct(target)}` })
}

// ── Mines (3 mines, cash out after 3 safe reveals) ──────────────────────────
// Fixed strategy: open with 3 mines, reveal 3 distinct safe tiles, cash out. If a
// mine is hit before then, bust. Compare measured RTP to the exact expectation.
{
  const mines = 3, target_reveals = 3
  // exact survival prob of revealing k safe tiles in a row from a fresh 25-cell board:
  // Π_{i<k} (safe-i)/(25-i), safe = 25-mines. payout mult on success = minesMult(k, mines).
  const safe = 25 - mines
  let survive = 1
  for (let i = 0; i < target_reveals; i++) survive *= (safe - i) / (25 - i)
  const mult = minesMult(target_reveals, mines)
  // gross return: success → bet + floor(bet*(mult-1)) ; bust → 0.
  const grossOnWin = BET + Math.floor(BET * (mult - 1))
  const target = survive * (grossOnWin / BET)

  let staked = 0, returned = 0, wins = 0
  for (let i = 0; i < N; i++) {
    staked += BET
    const mineCells = new Set(buildMines(mines))
    // reveal target_reveals distinct cells in a fixed scan order, skipping none.
    let revealed = 0, busted = false
    for (let cell = 0; cell < 25 && revealed < target_reveals; cell++) {
      if (mineCells.has(cell)) { busted = true; break }
      revealed++
    }
    if (!busted && revealed === target_reveals) {
      returned += grossOnWin; wins++
    }
    // bust → returned += 0
  }
  report('mines-3@3', { rtp: returned / staked, winRate: wins / N, target, tol: 0.01,
    extra: `cashout ${mult}x` })
}

// ── Chicken Road (cash out after crossing lane 3) ────────────────────────────
// Fixed strategy: cross lanes 1..3, then cash out. Bust if any of those lanes is unsafe.
{
  const stopLane = 3   // 1-based: cash out after 3 lanes crossed
  let survive = 1
  for (let i = 0; i < stopLane; i++) survive *= SAFE_PROBS[i]
  const grossOnWin = chickenPayout(BET, stopLane)   // bet + floor(bet*(mult-1))
  const target = survive * (grossOnWin / BET)

  let staked = 0, returned = 0, wins = 0
  for (let i = 0; i < N; i++) {
    staked += BET
    const lanes = preRollLanes()
    let crossed = 0, busted = false
    for (let l = 0; l < stopLane; l++) {
      if (lanes[l]) crossed++
      else { busted = true; break }
    }
    if (!busted && crossed === stopLane) { returned += grossOnWin; wins++ }
  }
  report('chicken@3', { rtp: returned / staked, winRate: wins / N, target, tol: 0.01,
    extra: `lane3 ${LANE_MULTIPLIERS[stopLane - 1]}x` })
}

// ── Blackjack (basic-ish strategy: player hits to 17, stands; no double) ─────
// No clean closed form; target is the well-known house edge band for stand-on-17
// dealer with a naive player. We assert RTP is in a plausible 0.90–1.00 band (this is
// primarily a wiring + no-crash check; exact rules are pinned by blackjackEngine.test.js).
{
  let staked = 0, returned = 0, wins = 0, pushes = 0
  const deckProto = buildDeck()
  for (let i = 0; i < N; i++) {
    staked += BET
    const deck = shuffle(deckProto)
    // Draw with an ascending index (dealerPlay's contract): deal p1,d1,p2,d2,
    // then player hits, then dealerPlay continues from the same index. The SQL
    // models the same single-direction draw; only the harness's index direction
    // is a convention, not game logic.
    let idx = 0
    const draw = () => deck[idx++]
    const player = [draw()]; const dealer = [draw()]
    player.push(draw()); dealer.push(draw())

    if (isBlackjack(player) || isBlackjack(dealer)) {
      const g = settle({ playerCards: player, dealerCards: dealer, bet: BET })
      returned += g; if (g > BET) wins++; else if (g === BET) pushes++
      continue
    }
    // player: hit while < 17
    while (handValue(player) < 17) player.push(draw())
    if (handValue(player) > 21) { /* bust, returned += 0 */ continue }
    // dealer plays from the current index
    const { dealerCards } = dealerPlay(deck, idx, dealer)
    const g = settle({ playerCards: player, dealerCards, bet: BET })
    returned += g
    if (g > BET) wins++; else if (g === BET) pushes++
  }
  const rtp = returned / staked
  const ok = rtp >= 0.90 && rtp <= 1.00
  if (!ok) failures++
  console.log(
    `${'blackjack'.padEnd(16)} RTP ${pct(rtp).padStart(8)}  ` +
    `(band 90.0%–100.0%)  win ${pct(wins / N).padStart(7)}  ` +
    `push ${pct(pushes / N)}  ${ok ? 'OK ' : 'FAIL'}`
  )
}

console.log('')
if (failures > 0) {
  console.error(`✗ ${failures} game(s) outside tolerance`)
  process.exit(1)
}
console.log(`✓ all games within tolerance (${N.toLocaleString()} trials each)`)
