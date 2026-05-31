// ── Aviamasters engine ─────────────────────────────────────────────────────────
// Pure, dependency-free round generation. No React, no DOM. The same code runs
// in the browser component and in scripts/aviamasters-sim.mjs (RTP tuning).
// All randomness comes through an injectable `rng` (default Math.random) so the
// unit tests and the simulation are deterministic / reproducible.

export const START_MULT = 1.0
export const MAX_MULT   = 250

// How many collectible slots a flight has (weighted).
// Capped at 5 to limit compound growth from multiplicative nodes.
export const NODE_COUNT = [
  { value: 1, weight: 15 },
  { value: 2, weight: 30 },
  { value: 3, weight: 30 },
  { value: 4, weight: 18 },
  { value: 5, weight: 7  },
]

// Per-slot probability a slot is a rocket (÷2) instead of a value node.
// Couples rocket count to flight length: count ≈ Binomial(nodeCount, ROCKET_CHANCE).
export const ROCKET_CHANCE = 0.18

// Given a value node, probability it is multiplicative (vs additive).
// Lower share keeps average mult modest; additive nodes feel gentler.
export const MULT_NODE_SHARE = 0.25

// Multiplicative node faces (×N) and their relative weights.
export const MULT_NODES = [
  { value: 2, weight: 50 },
  { value: 3, weight: 28 },
  { value: 4, weight: 15 },
  { value: 5, weight: 7  },
]

// Additive node faces (+N fractional) and their relative weights.
// Kept small relative to the 1.0 start so a single add node can't
// rocket the multiplier on its own; ×N nodes supply the big jumps.
export const ADD_NODES = [
  { value: 0.1, weight: 45 },
  { value: 0.2, weight: 30 },
  { value: 0.5, weight: 18 },
  { value: 1.0, weight: 7  },
]

// Probability the plane lands (wins) vs splashes (loses). Independent of the
// multiplier. Tuned via scripts/aviamasters-sim.mjs for ~97% RTP.
export const P_LAND = 0.3709

// Animation tick interval (ms per event) per speed setting. UI-only; no effect
// on odds or payouts.
export const SPEEDS = {
  tortoise:  1100,
  walking:   700,
  hare:      400,
  lightning: 180,
}

// Pick a value from a [{ value, weight }] table using one rng() draw.
export function pickWeighted(table, rng) {
  const total = table.reduce((sum, e) => sum + e.weight, 0)
  let r = rng() * total
  for (const e of table) {
    r -= e.weight
    if (r < 0) return e.value
  }
  return table[table.length - 1].value
}

// Generate one full round up-front. Returns the ordered events (for animation),
// the final clamped multiplier, and the land/splash outcome.
export function generateRound(rng = Math.random) {
  const nodeCount = pickWeighted(NODE_COUNT, rng)

  let mult = START_MULT
  const events = []

  for (let i = 0; i < nodeCount; i++) {
    if (rng() < ROCKET_CHANCE) {
      mult = mult / 2
      events.push({ kind: 'rocket', value: 2, multAfter: round2(mult) })
      continue
    }
    if (rng() < MULT_NODE_SHARE) {
      const value = pickWeighted(MULT_NODES, rng)
      mult = Math.min(MAX_MULT, mult * value)
      events.push({ kind: 'mult', value, multAfter: round2(mult) })
    } else {
      const value = pickWeighted(ADD_NODES, rng)
      mult = Math.min(MAX_MULT, mult + value)
      events.push({ kind: 'add', value, multAfter: round2(mult) })
    }
  }

  const finalMult = round2(Math.min(MAX_MULT, mult))
  const outcome = rng() < P_LAND ? 'land' : 'splash'
  return { events, finalMult, outcome }
}

function round2(n) {
  return Math.round(n * 100) / 100
}
