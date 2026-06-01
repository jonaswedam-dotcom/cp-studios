// Single source of truth for unit stats. All values are tunable.
// Travel times are tuned for an active session-friendly pace (tens of minutes):
// the world advances via the server tick, and the leg length still gives a
// defender time to log in and react (pairs with the 48h/offline shields).
// Keep these short (e.g. 20–60s) while testing the tick locally, then restore.
export const UNITS = {
  soldier: { label: 'Soldier', strength: 1, cost: 100, mode: 'land', travelSeconds: 1200 },   // 20m
  tank:    { label: 'Tank',    strength: 5, cost: 500, mode: 'land', travelSeconds: 2400 },   // 40m
  jet:     { label: 'Jet',     strength: 3, cost: 800, mode: 'air',  travelSeconds: 600, airRangeKm: 7000 }, // 10m
  warship: { label: 'Warship', strength: 2, cost: 600, mode: 'sea',  travelSeconds: 2400, seaRangeKm: 7000 }, // 40m
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
