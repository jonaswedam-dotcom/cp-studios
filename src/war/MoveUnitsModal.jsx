import { useState, useEffect, useMemo } from 'react'
import { UNITS, formatDuration } from './units.js'
import { validateMove, WARSHIP_CAPACITY } from './movement.js'
import { UnitIcon } from './icons.jsx'

// Streamlined "send forces" panel. The destination is already chosen (the province the
// player clicked), and `sources` is the pre-computed list of valid {from, mode} launch
// options — so there is NO destination dropdown. Source/mode default to the best option
// and only surface a picker when there's a real choice. Unit counts default to "send all".
const MODE_LABEL = { land: '🪖 Land', air: '✈️ Air', sea: '⚓ Sea' }
const INPUT_TYPES = { land: ['soldier', 'tank'], air: ['jet'], sea: ['warship', 'soldier', 'tank'] }

export default function MoveUnitsModal({ graph, regions, dest, sources = [], onConfirm, onClose, loading }) {
  const [idx, setIdx] = useState(0)
  const candidate = sources[idx] || sources[0]
  const from = candidate?.from
  const mode = candidate?.mode
  const fromRow = regions[from]
  const userId = fromRow?.owner_id

  const destRow = regions[dest]
  const isAttack = destRow?.owner_id && destRow.owner_id !== userId
  const isReinforce = destRow?.owner_id && destRow.owner_id === userId
  const destName = graph.regions[dest]?.city || graph.regions[dest]?.name || dest

  const inputTypes = mode ? INPUT_TYPES[mode] : []
  const available = (t) => fromRow?.[t] || 0

  // Counts default to the full available force; reseed whenever source/mode changes.
  // For sea, cargo (soldiers/tanks) defaults to 0 so the panel never opens over capacity —
  // the player opts cargo in.
  const [counts, setCounts] = useState({})
  useEffect(() => {
    const seed = {}
    for (const t of inputTypes) seed[t] = (mode === 'sea' && t !== 'warship') ? 0 : available(t)
    setCounts(seed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, mode])

  const setCount = (t, v) => setCounts((p) => ({ ...p, [t]: v }))
  const setAll = (frac) => {
    const seed = {}
    for (const t of inputTypes) seed[t] = Math.floor(available(t) * frac)
    if (mode === 'sea') {
      // Fit cargo (soldiers first, then tanks) into the chosen warships' capacity so the
      // preset is always valid instead of over-limit.
      let cap = WARSHIP_CAPACITY * (seed.warship || 0)
      seed.soldier = Math.min(seed.soldier || 0, cap); cap -= seed.soldier
      seed.tank = Math.min(seed.tank || 0, cap)
    }
    setCounts(seed)
  }

  const stack = useMemo(() => {
    const s = {}
    for (const t of inputTypes) { const n = parseInt(counts[t]) || 0; if (n > 0) s[t] = n }
    return s
  }, [counts, inputTypes])

  // Sea cargo capacity (warships ferry soldiers/tanks).
  const warships = parseInt(counts.warship) || 0
  const seaCargo = (parseInt(counts.soldier) || 0) + (parseInt(counts.tank) || 0)
  const seaCapacity = WARSHIP_CAPACITY * warships
  const seaOver = mode === 'sea' && seaCargo > seaCapacity

  const validation = useMemo(() => {
    if (!from || !mode) return { error: 'No route.' }
    return validateMove(from, dest, stack, graph)
  }, [from, mode, dest, stack, graph])

  const stackEmpty = Object.keys(stack).length === 0
  const enough = Object.entries(stack).every(([t, n]) => n <= available(t))
  const canConfirm = !stackEmpty && enough && !seaOver && !validation.error && !loading && !!from

  const remaining = inputTypes.reduce((s, t) => s + Math.max(0, available(t) - (parseInt(counts[t]) || 0)), 0)
  const armyFor = (c) => INPUT_TYPES[c.mode].reduce((s, t) => s + (regions[c.from]?.[t] || 0), 0)

  const title = isAttack ? `⚔️ Attack ${destName}` : isReinforce ? `🏃 Reinforce ${destName}` : `🚩 Take ${destName}`
  const cta   = isAttack ? 'Launch Attack' : isReinforce ? 'Send' : 'Capture'
  const ctaColor = isAttack ? 'bg-red-600 hover:bg-red-500' : isReinforce ? 'bg-sky-600 hover:bg-sky-500' : 'bg-emerald-600 hover:bg-emerald-500'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-cp-card border border-cp-border rounded-3xl p-6 space-y-4 shadow-2xl modal-in">
        <h3 className="font-display text-lg text-cp-text">{title}</h3>

        {/* Source / mode picker — only when there's more than one way to attack */}
        {sources.length > 1 ? (
          <div>
            <label className="block text-xs text-cp-muted uppercase tracking-wider mb-1.5">Attack from</label>
            <div className="flex flex-wrap gap-2">
              {sources.map((c, i) => (
                <button key={`${c.from}-${c.mode}`} onClick={() => setIdx(i)}
                  className={`px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
                    i === idx ? 'border-blue-500/60 bg-blue-500/10 text-cp-text' : 'border-cp-border text-cp-muted hover:text-cp-text'
                  }`}>
                  {graph.regions[c.from]?.city || c.from} · {MODE_LABEL[c.mode]} · {armyFor(c).toLocaleString()}
                </button>
              ))}
            </div>
          </div>
        ) : from ? (
          <p className="text-xs text-cp-muted">
            From <span className="text-cp-text font-medium">{graph.regions[from]?.city || from}</span> via {MODE_LABEL[mode]}
          </p>
        ) : null}

        {/* Quick amount presets */}
        {inputTypes.length > 0 && (
          <div className="flex items-center justify-between">
            <label className="text-xs text-cp-muted uppercase tracking-wider">Units to send</label>
            <div className="flex gap-1.5">
              <button onClick={() => setAll(1)} className="px-2.5 py-1 rounded-lg border border-cp-border text-[11px] text-cp-muted hover:text-cp-text transition-colors">All</button>
              <button onClick={() => setAll(0.5)} className="px-2.5 py-1 rounded-lg border border-cp-border text-[11px] text-cp-muted hover:text-cp-text transition-colors">Half</button>
            </div>
          </div>
        )}

        {/* Per-unit inputs for the active mode */}
        <div className="space-y-3">
          {inputTypes.map((t) => {
            const max = available(t)
            const isCargo = mode === 'sea' && (t === 'soldier' || t === 'tank')
            return (
              <div key={t}>
                <div className="flex items-center gap-2 mb-1">
                  <UnitIcon type={t} className="w-4 h-4 text-cp-muted" />
                  <span className="text-xs text-cp-muted">{UNITS[t].label}s — {max.toLocaleString()} available</span>
                  {isCargo && <span className="text-xs text-cp-muted ml-auto">(cargo)</span>}
                </div>
                <input type="number" min={0} max={max} value={counts[t] ?? ''}
                  onChange={(e) => setCount(t, e.target.value)}
                  className="w-full bg-cp-elevated border border-cp-border rounded-xl px-4 py-2.5 text-cp-text text-sm focus:border-blue-500/50 focus:outline-none"
                  placeholder={`0 – ${max}`} />
              </div>
            )
          })}

          {mode === 'sea' && warships > 0 && (
            <p className={`text-xs ${seaOver ? 'text-red-400' : 'text-cp-muted'}`}>
              Cargo: {seaOver ? `${seaCargo - seaCapacity} over limit` : `${seaCapacity - seaCargo} of ${seaCapacity} free`}
            </p>
          )}
          {!stackEmpty && !validation.error && !seaOver && (
            <p className="text-xs text-cp-muted">
              Arrives in <span className="text-cp-text font-medium">{formatDuration(validation.arrivesInSeconds)}</span>
              {fromRow && <> · leaves <span className="text-cp-text font-medium">{remaining.toLocaleString()}</span> in {graph.regions[from]?.city || from}</>}
            </p>
          )}
          {validation.error && !stackEmpty && !seaOver && <p className="text-xs text-red-400">{validation.error}</p>}
          {!enough && !stackEmpty && <p className="text-xs text-red-400">Not enough units available.</p>}
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-cp-border text-cp-muted text-sm hover:text-cp-text transition-colors">Cancel</button>
          <button onClick={() => canConfirm && onConfirm({ from, dest, stack, mode })} disabled={!canConfirm}
            className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors disabled:opacity-40 flex items-center justify-center gap-2 ${ctaColor}`}>
            {loading && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {cta}
          </button>
        </div>
      </div>
    </div>
  )
}
