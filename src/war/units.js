// Single source of truth for Phase 1 unit stats. All values are tunable.
export const UNITS = {
  soldier: { label: 'Soldier', strength: 1, cost: 100, mode: 'land', travelSeconds: 30 },
  tank:    { label: 'Tank',    strength: 5, cost: 500, mode: 'land', travelSeconds: 45 },
  jet:     { label: 'Jet',     strength: 3, cost: 800, mode: 'air',  travelSeconds: 20, airRangeKm: 4500 },
}

export const UNIT_TYPES = ['soldier', 'tank', 'jet']

// What a freshly-spawned player gets on their starting province.
export const START_ARMY = { soldier: 500, tank: 0, jet: 0 }
