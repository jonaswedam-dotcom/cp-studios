// Pure, DOM-free geometry + path math for the Plinko board, so it can be
// unit-tested with `node --test` (see plinkoGeom.test.js). The canvas drawing
// itself stays in PlinkoGame.jsx.

export const CW = 480              // logical board width (px)

// ─── Multiplier tables (Stake-accurate), keyed by rows (8/12/16) and risk ─────
// Each array has rows+1 entries — one per payout slot (number of right deflections,
// 0..rows). The source of truth for both the canvas labels and the payout math.
// keep in sync with 039_casino_play_singleshot.sql (play_plinko)
export const MULTIPLIERS = {
  8: {
    low:    [5.6, 2.1, 1.1, 1.0, 0.5, 1.0, 1.1, 2.1, 5.6],
    medium: [13,   3,  1.3, 0.7, 0.4, 0.7, 1.3,  3,  13 ],
    high:   [29,   4,  1.5, 0.3, 0.2, 0.3, 1.5,  4,  29 ],
  },
  12: {
    low:    [10,   3,  1.6, 1.4, 1.1, 1.0, 0.5, 1.0, 1.1, 1.4, 1.6,  3,  10],
    medium: [33,  11,   4,   2,  1.1, 0.6, 0.3, 0.6, 1.1,  2,   4,  11,  33],
    high:   [170, 24,   8,   2,  0.7, 0.2, 0.2, 0.2, 0.7,  2,   8,  24, 170],
  },
  16: {
    low:    [16,   9,   2,  1.4, 1.4, 1.2, 1.1, 1.0, 0.5, 1.0, 1.1, 1.2, 1.4, 1.4,  2,   9,  16],
    medium: [110,  41,  10,   5,   3, 1.5, 1.0, 0.5, 0.3, 0.5, 1.0, 1.5,   3,   5,  10,  41, 110],
    high:   [1000, 130, 26,   9,   4,   2, 0.2, 0.2, 0.2, 0.2, 0.2,   2,   4,   9,  26, 130, 1000],
  },
}

// Map a row-by-row left/right decision array to its payout slot: the slot index is
// the number of right deflections (decisions[i] truthy = right), identical to the
// slot `buildPath` settles into. keep in sync with 039_casino_play_singleshot.sql
export function decisionsToSlot(decisions) {
  return decisions.reduce((s, d) => s + (d ? 1 : 0), 0)
}

// One full server-authoritative ball drop: roll a left/right decision per row, map
// to a slot, look up the multiplier, return the outcome the client animates plus the
// net wallet change. delta = floor(bet*mult) - bet (matches PlinkoGame.jsx).
// keep in sync with 039_casino_play_singleshot.sql (play_plinko)
export function resolvePlinko({ bet, rows, risk, rng = Math.random }) {
  const decisions = Array.from({ length: rows }, () => Math.floor(rng() * 2))
  const slot = decisionsToSlot(decisions)
  const mult = MULTIPLIERS[rows][risk][slot]
  return { decisions, slot, mult, delta: Math.floor(bet * mult) - bet }
}

// ─── Board geometry: proper offset peg lattice ────────────────────────────────
// Row i (0-indexed) has (i + 3) pegs, so the bottom row has (rows + 2) pegs that
// form (rows + 1) gaps — one per payout slot. Pegs live on a half-spacing unit
// grid: the ball always sits above a peg and deflects by one unit (= half a peg
// spacing) left/right each row, so it weaves through the gaps.
export function makeGeom(rows) {
  const N      = rows
  const MARGIN = 18
  const S      = (CW - 2 * MARGIN) / (N + 1)        // horizontal peg spacing
  const PEG_R  = Math.max(3, S * 0.12)
  const BALL_R = S * 0.24                            // ~2x the peg, still clears the gaps
  const TOP    = 46                                  // y of the first peg row
  const ROW_H  = Math.min(S * 0.92, 40)              // vertical spacing
  const SLOTS  = N + 1
  const SLOT_W = S
  const SLOT_H = 40
  const SLOT_Y = TOP + (N - 1) * ROW_H + PEG_R + BALL_R + 22
  const CH     = SLOT_Y + SLOT_H + 16

  const cx     = CW / 2
  const unitX  = (u) => cx + u * (S / 2)             // unit grid -> px
  const pegY   = (i) => TOP + i * ROW_H
  const slotCX = (k) => unitX(-N + 2 * k)            // bin/slot center, k = 0..N

  const pegs = []
  for (let i = 0; i < N; i++)
    for (let j = 0; j <= i + 2; j++)
      pegs.push({ x: unitX(-(i + 2) + 2 * j), y: pegY(i) })

  return { N, S, PEG_R, BALL_R, TOP, ROW_H, SLOTS, SLOT_W, SLOT_H, SLOT_Y, CH, cx, unitX, pegY, slotCX, pegs }
}

// ─── Path: the contact points (peg TOPS) the ball bounces across ──────────────
// decisions[i] = 1 -> deflect right, 0 -> left. Waypoints sit on the TOP of each
// struck peg (one ball-radius + peg-radius above its center, i.e. tangent), plus
// an entry drop and the final slot. slot = number of right deflections (0..rows),
// identical to the previous payout mapping.
export function buildPath(rows, decisions, geom) {
  const { unitX, pegY, slotCX, PEG_R, BALL_R, SLOT_Y, SLOT_H, ROW_H, S } = geom
  const off = PEG_R + BALL_R + S * 0.04              // ride a hair above peg tops (no overlap)
  const pts = [{ x: unitX(0), y: Math.max(BALL_R + 2, pegY(0) - off - ROW_H) }]  // entry
  let col = 0
  for (let i = 0; i < rows; i++) {
    pts.push({ x: unitX(2 * col - i), y: pegY(i) - off })   // top of struck peg
    if (decisions[i]) col++
  }
  pts.push({ x: slotCX(col), y: SLOT_Y + SLOT_H / 2 })       // settle into slot
  return { pts, slot: col }
}

// ─── Ball position along one bounce segment ───────────────────────────────────
// Arc between two contact points, built so the ball never clips the pegs it
// passes:
//   • Horizontal: cubic ease-out (1-(1-t)^3) — a quick sideways kick off the peg
//     that clears the peg's radius before the ball drops past it (lively ricochet).
//   • Vertical: a small upward bounce then gravity acceleration
//     (y = ay - bounce·t + (dy+bounce)·t²) — the ball lingers near the peg top
//     while it kicks sideways, then accelerates down. bounce = 0 for the clean
//     entry drop.
export function segPos(a, b, t, bounce) {
  const ex = 1 - (1 - t) ** 3
  const dy = b.y - a.y
  return {
    x: a.x + (b.x - a.x) * ex,
    y: a.y - bounce * t + (dy + bounce) * t * t,
  }
}
