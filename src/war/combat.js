import { UNITS, UNIT_TYPES } from './units.js'

export function emptyStack() {
  return { soldier: 0, tank: 0, jet: 0 }
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

// attackStack invades a region held by defenseStack.
// Returns { winner: 'attacker'|'defender', survivors: stack-of-winner }.
export function resolveCombat(attackStack, defenseStack) {
  const atk = { ...emptyStack(), ...attackStack }
  const def = { ...emptyStack(), ...defenseStack }
  const aStr = stackStrength(atk)
  const dStr = stackStrength(def)

  if (aStr > dStr) {
    return { winner: 'attacker', survivors: scaleToStrength(atk, aStr, aStr - dStr) }
  }
  if (dStr > aStr) {
    return { winner: 'defender', survivors: scaleToStrength(def, dStr, dStr - aStr) }
  }
  // tie: defender holds with a single token soldier
  return { winner: 'defender', survivors: { ...emptyStack(), soldier: 1 } }
}
