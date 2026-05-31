// Single source of truth for unit stats. All values are tunable.
export const UNITS = {
  soldier: { label: 'Soldier', strength: 1, cost: 100, mode: 'land', travelSeconds: 30 },
  tank:    { label: 'Tank',    strength: 5, cost: 500, mode: 'land', travelSeconds: 45 },
  jet:     { label: 'Jet',     strength: 3, cost: 800, mode: 'air',  travelSeconds: 20, airRangeKm: 4500 },
  warship: { label: 'Warship', strength: 2, cost: 600, mode: 'sea',  travelSeconds: 60, seaRangeKm: 7000 },
}

export const UNIT_TYPES = ['soldier', 'tank', 'jet', 'warship']

// What a freshly-spawned player gets on their starting province.
export const START_ARMY = { soldier: 500, tank: 0, jet: 0, warship: 0 }
