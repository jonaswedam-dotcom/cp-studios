// Single source of truth for unit stats. All values are tunable.
// Travel times are tuned for an active, fast-paced session (single-digit minutes):
// the world advances via the per-minute server tick, so the practical floor on an
// attack leg is the tick cadence. Moves WITHIN your own territory (reinforcing a
// province you already own) resolve instantly client-side — see WarPage handleMove —
// so these leg times only apply to attacks on enemy/neutral provinces.
export const UNITS = {
  soldier: { label: 'Soldier', strength: 1, cost: 100, mode: 'land', travelSeconds: 180 },   // 3m
  tank:    { label: 'Tank',    strength: 5, cost: 400, mode: 'land', travelSeconds: 300 },   // 5m
  jet:     { label: 'Jet',     strength: 3, cost: 800, mode: 'air',  travelSeconds: 60, airRangeKm: 4500 }, // 1m
  warship: { label: 'Warship', strength: 2, cost: 600, mode: 'sea',  travelSeconds: 300, seaRangeKm: 7000 }, // 5m
}

export const UNIT_TYPES = ['soldier', 'tank', 'jet', 'warship']

// What a freshly-spawned player gets on their starting province.
export const START_ARMY = { soldier: 500, tank: 0, jet: 0, warship: 0 }

// Human-friendly travel time, e.g. 3600 -> "1h", 1800 -> "30m", 5400 -> "1h 30m".
export function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}
