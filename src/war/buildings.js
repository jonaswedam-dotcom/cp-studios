export const SLOTS_PER_REGION = 3
export const INCOME_PER_BANK_LEVEL_PER_HOUR = 50 // tunable
export const INCOME_PER_PROVINCE_PER_HOUR = 10

export const BUILDINGS = {
  bunker:  { label: 'Bunker',      kind: 'defense', cost: [800, 1600, 3200],  desc: 'Defenders here fight much harder.' },
  antiair: { label: 'Anti-Air',    kind: 'defense', cost: [1000, 2000, 4000], desc: 'Shoots down incoming jets.' },
  factory: { label: 'War Factory', kind: 'economy', cost: [1500, 3000, 6000], desc: 'Cheaper troops everywhere.' },
  lab:     { label: 'Command Lab', kind: 'economy', cost: [1500, 3000, 6000], desc: 'Stronger troops everywhere.' },
  bank:    { label: 'Bank',        kind: 'economy', cost: [1200, 2400, 4800], desc: 'Passive coin income.' },
}
export const BUILDING_TYPES = Object.keys(BUILDINGS)

// Cost to go from `currentLevel` to `currentLevel + 1`. currentLevel 0 = build.
export function buildingCost(type, currentLevel) {
  const t = BUILDINGS[type]
  if (!t || currentLevel >= 3) return Infinity
  return t.cost[currentLevel]
}

// ── Local (per-region) defensive effects ────────────────────────────────────
export function defenseMultiplier(regionBuildings) {
  const b = regionBuildings.find((x) => x.type === 'bunker')
  return b ? 1 + 0.5 * b.level : 1
}
export function antiAirFactor(regionBuildings) {
  const b = regionBuildings.find((x) => x.type === 'antiair')
  return b ? Math.min(0.75, 0.25 * b.level) : 0
}

// ── Global (per-player) economy effects ─────────────────────────────────────
function totalLevel(buildings, type) {
  return buildings.filter((b) => b.type === type).reduce((s, b) => s + b.level, 0)
}
export function costMultiplier(playerBuildings) {
  return Math.max(0.4, 1 - 0.1 * totalLevel(playerBuildings, 'factory'))
}
export function strengthMultiplier(playerBuildings) {
  return 1 + 0.1 * totalLevel(playerBuildings, 'lab')
}
export function incomePerTick(playerBuildings, tickSeconds, provinceCount = 0) {
  const lv = totalLevel(playerBuildings, 'bank')
  const rate = lv * INCOME_PER_BANK_LEVEL_PER_HOUR + provinceCount * INCOME_PER_PROVINCE_PER_HOUR
  return Math.round(rate * (tickSeconds / 3600))
}
