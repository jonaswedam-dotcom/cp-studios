# Slots redesign — more rows, house-positive odds

**Date:** 2026-06-01
**Status:** Design — awaiting approval
**Area:** `src/pages/casino/SlotsGame.jsx` (+ new pure engine module & test)

## Problem

The current Slots game (`SlotsGame.jsx`) is wildly player-favourable — a coin printer.
It is 3 reels / 1 payline with symbol weights `[5,4,3,2,1]` and payouts:

| Outcome | Probability | Net result |
|---|---|---|
| 3 of a kind (`bet × 9`) | 6.67% | +9× |
| 2 of a kind (`+0.5×`) | 53.33% | +0.5× |
| No match | 40.00% | −1× |

- **Win rate ≈ 60%**, expected value **≈ +0.47× per spin → RTP ≈ 147%** (house edge **−47%**).
- Root cause: the 2-of-a-kind win is both very common (53%) *and* net-positive.

Goal: keep the look, add rows so it feels like a real machine, and make the odds
house-positive while still fun.

## Goals

- Expand from 1 visible row to a **5-reel × 3-row** grid with **5 paylines**.
- Make a single line win genuinely rare; wins come from 3/4/5-of-a-kind runs.
- Land **RTP ≈ 93%** (house edge ≈ 7%), net-positive-win rate ≈ 15% (down from 60%).
- Preserve the existing amber/dark aesthetic, `BetChips`, `ResultBanner`, single-bet UX.
- Move slot math into a **pure, unit-tested engine module** (mirrors `aviamastersEngine.js`).

## Non-goals

- Server-authoritative resolution. The casino stays client-side per
  `CLAUDE.md` §4 — same trust level as the other games.
- Bet-per-line, paylines selection UI, free spins, wilds/scatters, or sound. (Future.)
- Changing any other casino game, the wallet, or `placeBet`'s contract.

## Game model

**Grid:** 5 reels (columns) × 3 rows = 15 cells. Each cell is an independent
weighted symbol draw (no per-reel strips — keeps the engine simple and testable).

**Symbols & weights** (sum = 20):

| Symbol | Weight | Probability |
|---|---|---|
| 🍒 cherry | 6 | 0.30 |
| 🍋 lemon | 6 | 0.30 |
| 7️⃣ seven | 4 | 0.20 |
| ⭐ star | 3 | 0.15 |
| 💎 diamond | 1 | 0.05 |

**Paylines (5):** the 3 horizontal rows + 2 diagonals (V and Λ). Rows are 0=top,
1=middle, 2=bottom; columns 0–4. Each line is a 5-cell `[row, col]` path:

```
L1 top    : (0,0)(0,1)(0,2)(0,3)(0,4)
L2 middle : (1,0)(1,1)(1,2)(1,3)(1,4)
L3 bottom : (2,0)(2,1)(2,2)(2,3)(2,4)
L4 V      : (0,0)(1,1)(2,2)(1,3)(0,4)
L5 Λ      : (2,0)(1,1)(0,2)(1,3)(2,4)
```

**Win rule — "3+ from the left":** for each line, take the symbol in its leftmost
cell and count how many consecutive cells (from the left) match it. A run of **3, 4,
or 5** pays `PAYTABLE[symbol][runLength]`. Lines are evaluated independently and
**winnings stack** across lines.

**Paytable** — values are a **total-return** multiple of the *total bet* (the same
convention as today's "10×", where the stake is included in the return):

| Symbol | 3 of a kind | 4 of a kind | 5 of a kind |
|---|---|---|---|
| 🍒 cherry | 1× | 3× | 10× |
| 🍋 lemon | 1× | 3× | 10× |
| 7️⃣ seven | 3× | 8× | 25× |
| ⭐ star | 5× | 15× | 60× |
| 💎 diamond | 20× | 80× | 300× |

Design notes:
- 🍒/🍋 three-of-a-kind pays **1× = your bet back (a push)**. They are common enough
  that paying more would blow the RTP; "match 3, stake returned" is a clean, real-slot
  consolation tier and `ResultBanner` already renders `push` as *"Push — bet returned."*
- 💎 is rare (5%), so its 4-/5-of-a-kind multipliers are **almost free** RTP-wise —
  that's why the jackpot can be large (300×) without moving the house edge.
- All multipliers are integers, so net wallet changes are always exact multiples of the
  bet — no `Math.floor` rounding like the old 2-of-a-kind.

### Verified outcomes (closed-form + 5M-spin Monte Carlo, agree)

| Metric | Value |
|---|---|
| RTP | **93.1%** (house edge **6.9%**) |
| Overall hit rate (≥1 line) | 28.4% |
| Net-positive win (you profit) | **14.6%** |
| Push (stake returned) | 13.8% |
| Loss | 71.6% |
| Largest return in 5M spins | 303× |

These are reproducible via the sim script (below). The 5 paylines lift the hit rate
into a fun range (~28%) while each individual line wins only ~6.5% of the time.

## Payout / wallet semantics

Let `W` = sum of winning-line multipliers for a spin (an integer; `W = 0` if nothing
hits). The bet is **not** deducted up front (matching the current game); we pass the
**net** change to `placeBet`:

```
net = (W - 1) * bet
  W = 0  → net = -bet   → result 'loss'
  W = 1  → net = 0       → result 'push'
  W ≥ 2  → net > 0       → result 'win'
placeBet('slots', bet, net)   // CasinoContext infers win/push/loss from sign
```

This reuses `placeBet` unchanged (its 3rd arg is already "net change") and
`ResultBanner`'s existing `win` / `push` / `loss` states.

## Architecture

Follow the `aviamastersEngine.js` pattern: pure logic in its own module, injectable
`rng`, a `node:test` suite, and a sim script for tuning.

### New: `src/pages/casino/slotsEngine.js` (pure, no React/DOM)

Exported constants: `SYMBOLS`, `WEIGHTS`, `PAYLINES`, `PAYTABLE`, `ROWS=3`, `REELS=5`.

```
spinGrid(rng = Math.random) → number[3][5]
    // grid of symbol indices, one weighted draw per cell

evaluateGrid(grid) → {
  totalReturn,                 // W (integer)
  lines: [                     // one entry per WINNING line
    { lineIndex, symbol, runLength, multiplier, cells: [[r,c],…runLength] }
  ]
}

netForBet(totalReturn, bet) → number   // (W - 1) * bet

theoreticalRTP() → number    // closed-form from constants; pins the math in a test
```

`pickWeighted(table, rng)` — reuse the same helper shape as the aviamasters engine
(or import a shared copy); keeps a single weighted-draw implementation.

### New: `src/pages/casino/slotsEngine.test.js` (`node --test`)

- `evaluateGrid` on hand-built grids: 3-run, 4-run, 5-run, broken run (no win),
  multiple simultaneous winning lines (stacking), diagonal lines, empty result.
- `netForBet`: loss / push / win mapping for representative `W` values.
- `theoreticalRTP()` is within `[0.92, 0.94]` (locks the paytable math).
- `spinGrid` shape/range with a seeded rng (deterministic), like the existing tests.

### New: `scripts/slots-sim.mjs`

Monte-Carlo RTP / hit-rate / win-push-loss report for retuning (mirrors
`scripts/aviamasters-sim.mjs`). Documents how the numbers above were produced.

### Rewrite: `src/pages/casino/SlotsGame.jsx`

Keep all current chrome (frame, "CP Slots" header, paytable panel, `BetChips`, Spin
button, `ResultBanner`); swap the 3-reel internals for the 5×3 grid.

- **Layout:** render a 5-column × 3-row grid. Widen the frame from `max-w-sm` to
  `max-w-xl`; drop cell symbol size from 56px to ~34–38px so five columns fit. Same
  amber borders / inset glow. Mark the center row (or all 5 lines) with subtle payline
  hints.
- **Spin animation:** generate the final grid up front (as today with `finalReels`).
  Spin per **column** — each column's 3 cells cycle symbols on an interval; columns
  stop **left→right** on a stagger (e.g. 1000/1300/1600/1900/2200 ms). Reuse the
  `reelBlur` keyframe injection pattern; keep the `intervalRefs` / `timeoutRefs`
  cleanup (now 5 columns).
- **After the last column stops:** `evaluateGrid(grid)`, briefly **highlight the winning
  lines' cells** (glow/border on the `cells` from each winning line), set the
  `ResultBanner`, and call `placeBet('slots', bet, netForBet(W, bet))`.
- **ResultBanner:** `result` from sign of net; `amount` = `(W-1)*bet` (win) or `bet`
  (loss); `message` = a short summary, e.g. `"💎 ×3 — 20× line"` or
  `"2 winning lines · +240 coins"`.
- **Paytable panel:** show the 5 symbols × {3,4,5} multipliers and a one-line
  explainer: *"5 paylines · 3+ matching from the left · wins stack."*
- Single total bet covers all 5 lines — `BetChips` is unchanged.

## Testing / verification

1. `node --test src/pages/casino/slotsEngine.test.js` passes (evaluation + RTP bound).
2. `node scripts/slots-sim.mjs` reports RTP ≈ 93%, hit ≈ 28%, win ≈ 15%.
3. `npm run build` succeeds.
4. Manual (`npm run dev`): spin repeatedly — reels stop left→right, winning lines
   highlight, balance moves by the right amount, push shows "bet returned", paytable
   reads correctly, layout holds on a narrow screen.

## Tunable knobs (if the feel needs adjusting later)

- **House edge:** scale the paytable (RTP is linear in it). Trim 🍒/🍋 5-of-a-kind for
  more edge; the diamond jackpot barely moves it.
- **Hit rate:** the weights (not payouts) drive it; flatter weights → fewer wins.
- **No-push variant:** raise 🍒/🍋 3-of-a-kind to 1.5× and make the low symbols rarer
  (accepts a lower ~22% hit rate or a higher ~96% RTP).
- **Difficulty:** dropping the 2 diagonals (3 paylines only) gives ~18% hit
  ("casino-tough"); adding lines raises it.

## Open questions

1. OK to keep the **push tier** (🍒/🍋 ×3 returns the bet), or prefer the no-push
   variant above?
2. Keep 💎 5-of-a-kind at **300×**, or a rounder headline number (e.g. 250× / 500×)?
   (Negligible RTP impact either way.)
