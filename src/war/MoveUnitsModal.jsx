import { useState, useMemo } from 'react'
import { UNITS, UNIT_TYPES, formatDuration } from './units.js'
import { landNeighbors, airReachable, seaReachable } from './geo.js'
import { validateMove, WARSHIP_CAPACITY } from './movement.js'
import { UnitIcon } from './icons.jsx'

export default function MoveUnitsModal({ graph, regions, fromRegion, initialDest, onConfirm, onClose, loading }) {
  const fromRow = regions[fromRegion]
  const available = (t) => fromRow?.[t] || 0

  // All provinces reachable from fromRegion (union of all modes).
  const allDestinations = useMemo(() => {
    if (!graph) return []
    const land = landNeighbors(fromRegion, graph)
    const air  = airReachable(fromRegion, graph, UNITS.jet.airRangeKm)
    const sea  = seaReachable(fromRegion, graph, UNITS.warship.seaRangeKm)
    const ids  = [...new Set([...land, ...air, ...sea])]
    return ids.map((id) => ({
      id,
      label: graph.regions[id]?.city || graph.regions[id]?.name || id,
      owner: regions[id]?.owner_name,
      enemy: regions[id]?.owner_id && regions[id].owner_id !== fromRow?.owner_id,
    }))
  }, [graph, fromRegion, regions, fromRow])

  // Seed from the province the player clicked on the map (if it's reachable).
  const [dest, setDest] = useState(
    initialDest && allDestinations.some((d) => d.id === initialDest) ? initialDest : ''
  )

  // Determine valid modes for the chosen destination.
  const validModes = useMemo(() => {
    if (!dest || !graph) return []
    const modes = []
    if (validateMove(fromRegion, dest, { soldier: 1 }, graph).mode === 'land') modes.push('land')
    if (validateMove(fromRegion, dest, { jet: 1 }, graph).mode === 'air') modes.push('air')
    if (validateMove(fromRegion, dest, { warship: 1 }, graph).mode === 'sea') modes.push('sea')
    return modes
  }, [dest, fromRegion, graph])

  const [mode, setMode] = useState('')

  // Keep mode in sync: reset or default when validModes changes.
  const effectiveMode = validModes.includes(mode) ? mode : (validModes[0] || '')

  // Per-unit counts for each type.
  const [counts, setCounts] = useState({ soldier: '', tank: '', jet: '', warship: '' })
  const setCount = (t, v) => setCounts((prev) => ({ ...prev, [t]: v }))

  // Which unit types to show inputs for based on effective mode.
  const inputTypes = useMemo(() => {
    if (effectiveMode === 'land') return ['soldier', 'tank']
    if (effectiveMode === 'air')  return ['jet']
    if (effectiveMode === 'sea')  return ['warship', 'soldier', 'tank']
    return []
  }, [effectiveMode])

  // Build the stack from current inputs (only types relevant to the mode).
  const stack = useMemo(() => {
    const s = {}
    for (const t of inputTypes) {
      const n = parseInt(counts[t]) || 0
      if (n > 0) s[t] = n
    }
    return s
  }, [counts, inputTypes])

  // Sea capacity remaining.
  const warships = parseInt(counts.warship) || 0
  const seaCargo = (parseInt(counts.soldier) || 0) + (parseInt(counts.tank) || 0)
  const seaCapacity = WARSHIP_CAPACITY * warships
  const seaCapacityRemaining = seaCapacity - seaCargo

  // Validate the current stack.
  const validation = useMemo(() => {
    if (!dest || !effectiveMode) return { error: 'Choose a destination.' }
    return validateMove(fromRegion, dest, stack, graph)
  }, [fromRegion, dest, effectiveMode, stack, graph])

  const stackIsEmpty = Object.keys(stack).length === 0
  const enoughUnits = Object.entries(stack).every(([t, n]) => n <= available(t))
  const canConfirm = !stackIsEmpty && enoughUnits && !validation.error && !loading

  const destRow = regions[dest]
  const isAttack = destRow?.owner_id && destRow.owner_id !== fromRow?.owner_id

  const handleModeChange = (m) => {
    setMode(m)
    setCounts({ soldier: '', tank: '', jet: '', warship: '' })
  }

  const handleDestChange = (id) => {
    setDest(id)
    setMode('')
    setCounts({ soldier: '', tank: '', jet: '', warship: '' })
  }

  const MODE_LABELS = { land: '🪖 Land', air: '✈️ Air', sea: '⚓ Sea' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-cp-card border border-cp-border rounded-3xl p-6 space-y-4 shadow-2xl">
        <h3 className="font-display text-lg text-cp-text">{isAttack ? '⚔️ Attack' : '🏃 Move Units'}</h3>

        {/* Destination selector */}
        <div>
          <label className="block text-xs text-cp-muted uppercase tracking-wider mb-1.5">Destination</label>
          <select value={dest} onChange={(e) => handleDestChange(e.target.value)}
            className="w-full bg-cp-elevated border border-cp-border rounded-xl px-4 py-3 text-cp-text text-sm focus:border-blue-500/50 focus:outline-none">
            <option value="">{allDestinations.length ? 'Choose…' : 'No reachable provinces'}</option>
            {allDestinations.map((d) => (
              <option key={d.id} value={d.id}>{d.label}{d.enemy ? ` — ⚔ ${d.owner}` : d.owner ? ` — ${d.owner}` : ' — neutral'}</option>
            ))}
          </select>
        </div>

        {/* Mode toggle (only if multiple modes are valid) */}
        {dest && validModes.length > 1 && (
          <div>
            <label className="block text-xs text-cp-muted uppercase tracking-wider mb-1.5">Mode</label>
            <div className="flex gap-2">
              {validModes.map((m) => (
                <button key={m} onClick={() => handleModeChange(m)}
                  className={`flex-1 py-2 rounded-xl border text-xs font-medium transition-colors ${
                    effectiveMode === m
                      ? 'border-blue-500/60 bg-blue-500/10 text-cp-text'
                      : 'border-cp-border text-cp-muted hover:text-cp-text'
                  }`}>
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Unit count inputs for the current mode */}
        {dest && effectiveMode && (
          <div className="space-y-3">
            <label className="block text-xs text-cp-muted uppercase tracking-wider">Units to send</label>
            {inputTypes.map((t) => {
              const max = available(t)
              const isCargo = effectiveMode === 'sea' && (t === 'soldier' || t === 'tank')
              return (
                <div key={t}>
                  <div className="flex items-center gap-2 mb-1">
                    <UnitIcon type={t} className="w-4 h-4 text-cp-muted" />
                    <span className="text-xs text-cp-muted">{UNITS[t].label}s — {max.toLocaleString()} available</span>
                    {isCargo && <span className="text-xs text-cp-muted ml-auto">(cargo)</span>}
                  </div>
                  <input type="number" min={0} max={max} value={counts[t]}
                    onChange={(e) => setCount(t, e.target.value)}
                    className="w-full bg-cp-elevated border border-cp-border rounded-xl px-4 py-2.5 text-cp-text text-sm focus:border-blue-500/50 focus:outline-none"
                    placeholder={`0 – ${max}`} />
                </div>
              )
            })}

            {/* Sea capacity readout */}
            {effectiveMode === 'sea' && warships > 0 && (
              <p className={`text-xs ${seaCapacityRemaining < 0 ? 'text-red-400' : 'text-cp-muted'}`}>
                Cargo capacity: {seaCapacityRemaining < 0 ? `${Math.abs(seaCapacityRemaining)} over limit` : `${seaCapacityRemaining} remaining`} ({seaCapacity} total)
              </p>
            )}

            {/* Arrival readout */}
            {!validation.error && !stackIsEmpty && (
              <p className="text-xs text-cp-muted">
                Arrives in <span className="text-cp-text font-medium">{formatDuration(validation.arrivesInSeconds)}</span> via {effectiveMode}.
              </p>
            )}

            {/* Error text */}
            {validation.error && !stackIsEmpty && (
              <p className="text-xs text-red-400">{validation.error}</p>
            )}
            {!enoughUnits && !stackIsEmpty && (
              <p className="text-xs text-red-400">Not enough units available.</p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-cp-border text-cp-muted text-sm hover:text-cp-text transition-colors">
            Cancel
          </button>
          <button
            onClick={() => canConfirm && onConfirm({ dest, stack, mode: effectiveMode })}
            disabled={!canConfirm}
            className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors disabled:opacity-40 flex items-center justify-center gap-2 ${
              isAttack ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'
            }`}>
            {loading && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {isAttack ? 'Launch Attack' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
