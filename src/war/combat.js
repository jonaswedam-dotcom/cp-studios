import { UNITS, UNIT_TYPES } from './units.js'

export function emptyStack() {
  return { soldier: 0, tank: 0, jet: 0, warship: 0 }
}

// Build a stack object from a war_regions row (or movement), reading UNIT_TYPES.
export function stackFromRow(row) {
  const s = emptyStack()
  for (const t of UNIT_TYPES) s[t] = row?.[t] || 0
  return s
}

export function stackTotal(stack) {
  return UNIT_TYPES.reduce((s, t) => s + (stack[t] || 0), 0)
}

export function stackStrength(stack) {
  return UNIT_TYPES.reduce((s, t) => s + (stack[t] || 0) * UNITS[t].strength, 0)
}

// Scale a stack down to a target strength, keeping unit proportions, floored.
function scaleToStrength(stack, fromStrength, targetStrength) {
  const out = emptyStack()
  if (fromStrength <= 0 || targetStrength <= 0) return out
  const ratio = targetStrength / fromStrength
  for (const t of UNIT_TYPES) out[t] = Math.floor((stack[t] || 0) * ratio)
  return out
}

// Guarantee at least one surviving unit for a winner (avoid a 0-unit owned region).
function ensureSurvivor(survivors, original) {
  if (stackTotal(survivors) > 0) return survivors
  let best = 'soldier', n = -1
  for (const t of UNIT_TYPES) if ((original[t] || 0) > n) { n = original[t] || 0; best = t }
  return { ...survivors, [best]: 1 }
}

const RETREAT_FRACTION = 0.25 // losing attacker keeps this share, sent home
const RNG_MIN = 0.85, RNG_SPAN = 0.30 // effective strength ×[0.85,1.15]

function retreatStack(stack) {
  const out = emptyStack()
  for (const t of UNIT_TYPES) out[t] = Math.floor((stack[t] || 0) * RETREAT_FRACTION)
  return out
}

// attackStack invades a region held by defenseStack.
// opts: { attackMult=1 (Lab), defenseMult=1 (Bunker), antiAir=0 (Anti-Air vs jets), rng=Math.random }.
// Returns { winner: 'attacker'|'defender', survivors: stack-of-winner, retreat: stack }.
export function resolveCombat(attackStack, defenseStack, opts = {}) {
  const { attackMult = 1, defenseMult = 1, antiAir = 0, rng = Math.random } = opts
  const atk = { ...emptyStack(), ...attackStack }
  const def = { ...emptyStack(), ...defenseStack }

  let aStr = stackStrength(atk) * attackMult
  // Anti-air removes a fraction of the incoming jet contribution before the clash.
  aStr -= antiAir * (atk.jet || 0) * UNITS.jet.strength * attackMult
  aStr = Math.max(0, aStr)
  const dStr = stackStrength(def) * defenseMult

  const aEff = aStr * (RNG_MIN + rng() * RNG_SPAN)
  const dEff = dStr * (RNG_MIN + rng() * RNG_SPAN)

  if (aEff > dEff) {
    return { winner: 'attacker', survivors: ensureSurvivor(scaleToStrength(atk, aEff, aEff - dEff), atk), retreat: emptyStack() }
  }
  if (dEff > aEff) {
    return { winner: 'defender', survivors: ensureSurvivor(scaleToStrength(def, dEff, dEff - aEff), def), retreat: retreatStack(atk) }
  }
  // tie: defender holds with a single token soldier
  return { winner: 'defender', survivors: { ...emptyStack(), soldier: 1 }, retreat: retreatStack(atk) }
}

export { RETREAT_FRACTION, RNG_MIN, RNG_SPAN }
