import { useState, useMemo } from 'react'
import { UNITS, UNIT_TYPES, formatDuration } from './units.js'
import { landNeighbors, airReachable, seaReachable } from './geo.js'
import { UnitIcon } from './icons.jsx'

export default function MoveUnitsModal({ graph, regions, fromRegion, onConfirm, onClose, loading }) {
  const fromRow = regions[fromRegion]
  const available = (t) => fromRow?.[t] || 0
  const firstWithUnits = UNIT_TYPES.find((t) => available(t) > 0) || 'soldier'
  const [type, setType]   = useState(firstWithUnits)
  const [dest, setDest]   = useState('')
  const [count, setCount] = useState('')

  // Destinations the chosen unit type can reach.
  const destinations = useMemo(() => {
    if (!graph) return []
    const mode = UNITS[type].mode
    let ids = []
    if (mode === 'air') ids = airReachable(fromRegion, graph, UNITS[type].airRangeKm)
    else if (mode === 'sea') ids = seaReachable(fromRegion, graph, UNITS[type].seaRangeKm)
    else ids = landNeighbors(fromRegion, graph)
    return ids.map((id) => ({
      id,
      label: graph.regions[id]?.city || graph.regions[id]?.name || id,
      owner: regions[id]?.owner_name,
      enemy: regions[id]?.owner_id && regions[id].owner_id !== fromRow?.owner_id,
    }))
  }, [graph, type, fromRegion, regions, fromRow])

  const max   = available(type)
  const n     = parseInt(count) || 0
  const valid = dest && n >= 1 && n <= max
  const destRow = regions[dest]
  const isAttack = destRow?.owner_id && destRow.owner_id !== fromRow?.owner_id

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-cp-card border border-cp-border rounded-3xl p-6 space-y-4 shadow-2xl">
        <h3 className="font-display text-lg text-cp-text">{isAttack ? '⚔️ Attack' : '🏃 Move Units'}</h3>

        <div className="grid grid-cols-4 gap-2">
          {UNIT_TYPES.map((t) => (
            <button key={t} disabled={available(t) === 0}
              onClick={() => { setType(t); setDest(''); setCount('') }}
              className={`flex flex-col items-center gap-1 py-2 rounded-xl border text-xs transition-colors disabled:opacity-30 ${
                type === t ? 'border-blue-500/60 bg-blue-500/10 text-cp-text' : 'border-cp-border text-cp-muted hover:text-cp-text'
              }`}>
              <UnitIcon type={t} className="w-5 h-5" />
              <span>{available(t).toLocaleString()}</span>
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs text-cp-muted uppercase tracking-wider mb-1.5">Destination</label>
          <select value={dest} onChange={(e) => setDest(e.target.value)}
            className="w-full bg-cp-elevated border border-cp-border rounded-xl px-4 py-3 text-cp-text text-sm focus:border-blue-500/50 focus:outline-none">
            <option value="">{destinations.length ? 'Choose…' : 'No reachable provinces'}</option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>{d.label}{d.enemy ? ` — ⚔ ${d.owner}` : d.owner ? ` — ${d.owner}` : ' — neutral'}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-cp-muted uppercase tracking-wider mb-1.5">
            {UNITS[type].label}s to send (max {max.toLocaleString()})
          </label>
          <input type="number" min={1} max={max} value={count}
            onChange={(e) => setCount(e.target.value)}
            className="w-full bg-cp-elevated border border-cp-border rounded-xl px-4 py-3 text-cp-text text-sm focus:border-blue-500/50 focus:outline-none"
            placeholder={`1 – ${max}`} />
          <p className="text-xs text-cp-muted mt-1.5">Arrives in {formatDuration(UNITS[type].travelSeconds)}.</p>
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-cp-border text-cp-muted text-sm hover:text-cp-text transition-colors">Cancel</button>
          <button onClick={() => valid && onConfirm({ type, dest, count: n })} disabled={!valid || loading}
            className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors disabled:opacity-40 flex items-center justify-center gap-2 ${isAttack ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'}`}>
            {loading && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {isAttack ? 'Launch Attack' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
