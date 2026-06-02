// Single source of truth for unit stats. All values are tunable.
// Travel times are DISTANCE-BASED: a leg between two provinces takes longer the farther
// apart their centroids are, scaled between each unit's [min, max] over a NEAR..FAR band
// (see travelSecondsFor). A typical inter-country hop (≤ ~400km) lands at the floor; the
// longest reachable legs hit the cap. Soldiers run 3m→10m; jets stay the fastest (1m→3m).
// Moves WITHIN your own territory (reinforcing a province you already own) resolve instantly
// client-side — see WarPage handleMove — so these leg times only apply to attacks.
// `landRangeKm` lets ground troops march to any province on the SAME landmass within range
// (plus every direct border neighbour, regardless of distance) — so a nearby enemy country is
// invadable with soldiers/tanks, not just jets. Crossing open sea to another landmass still
// requires a warship. Kept well under the jet's airRangeKm so air stays the long-range option.
export const UNITS = {
  soldier: { label: 'Soldier', strength: 1, cost: 100, mode: 'land', minTravelSeconds: 180, maxTravelSeconds: 600, landRangeKm: 2000 },  // 3m → 10m
  tank:    { label: 'Tank',    strength: 5, cost: 400, mode: 'land', minTravelSeconds: 240, maxTravelSeconds: 600, landRangeKm: 2000 },  // 4m → 10m
  jet:     { label: 'Jet',     strength: 3, cost: 800, mode: 'air',  minTravelSeconds: 60,  maxTravelSeconds: 180, airRangeKm: 4500 }, // 1m → 3m
  // Warships are a premium naval unit: expensive and very strong (strength 20), and they
  // ALSO ferry land units (see WARSHIP_CAPACITY). They require a Port to build and deploy to
  // one — so the `strength`/cost here MUST stay in sync with war_stack_strength() + the tick
  // defender formula in supabase/migrations/036_war_ports_and_warship.sql (parity.test.js).
  warship: { label: 'Warship', strength: 20, cost: 4000, mode: 'sea', minTravelSeconds: 240, maxTravelSeconds: 600, seaRangeKm: 7000, requiresPort: true }, // 4m → 10m
}

export const UNIT_TYPES = ['soldier', 'tank', 'jet', 'warship']

// Distance band (km) over which travel time scales from each unit's min to its max.
export const TRAVEL_NEAR_KM = 400
export const TRAVEL_FAR_KM = 4000

// Travel time (seconds) for one unit type over a leg of `distanceKm`, linearly
// interpolated across its [min, max] band and clamped at both ends.
export function travelSecondsFor(type, distanceKm) {
  const u = UNITS[type]
  const frac = Math.max(0, Math.min(1, (distanceKm - TRAVEL_NEAR_KM) / (TRAVEL_FAR_KM - TRAVEL_NEAR_KM)))
  return Math.round(u.minTravelSeconds + (u.maxTravelSeconds - u.minTravelSeconds) * frac)
}

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
