import { emptyStack } from './combat.js'

// Deterministic small defending force on an unclaimed province (50–300 soldiers).
// MUST match the SQL war_neutral_soldiers() in Phase 3 (h = (h*31 + charCode) >>> 0; 50 + h%251).
export function neutralGarrison(regionId) {
  let h = 0
  for (let i = 0; i < regionId.length; i++) h = (h * 31 + regionId.charCodeAt(i)) >>> 0
  return { ...emptyStack(), soldier: 50 + (h % 251) }
}
