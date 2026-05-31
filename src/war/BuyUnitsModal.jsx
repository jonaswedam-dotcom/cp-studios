import { useState } from 'react'
import { UNITS, UNIT_TYPES } from './units.js'
import { troopCost, maxAffordable } from './economy.js'
import { UnitIcon } from './icons.jsx'

export default function BuyUnitsModal({ balance, onConfirm, onClose, loading }) {
  const [type, setType]   = useState('soldier')
  const [count, setCount] = useState('')
  const max   = maxAffordable(type, balance)
  const n     = parseInt(count) || 0
  const cost  = troopCost(type, n)
  const valid = n >= 1 && n <= max

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-cp-card border border-cp-border rounded-3xl p-6 space-y-5 shadow-2xl">
        <h3 className="font-display text-lg text-cp-text">Buy Units</h3>

        <div className="grid grid-cols-4 gap-2">
          {UNIT_TYPES.map((t) => (
            <button key={t} onClick={() => { setType(t); setCount('') }}
              className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs transition-colors ${
                type === t ? 'border-red-500/60 bg-red-500/10 text-cp-text' : 'border-cp-border text-cp-muted hover:text-cp-text'
              }`}>
              <UnitIcon type={t} className="w-5 h-5" />
              <span>{UNITS[t].label}</span>
              <span className="text-amber-400/80">{UNITS[t].cost}</span>
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs text-cp-muted uppercase tracking-wider mb-1.5">
            How many (max {max.toLocaleString()})
          </label>
          <input autoFocus type="number" min={1} max={max} value={count}
            onChange={(e) => setCount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && valid && onConfirm(type, n)}
            className="w-full bg-cp-elevated border border-cp-border rounded-xl px-4 py-3 text-cp-text text-sm focus:border-red-500/50 focus:outline-none"
            placeholder={`1 – ${max}`} />
          {valid && <p className="text-xs text-amber-400/80 mt-1.5">Cost: {cost.toLocaleString()} coins</p>}
          {count && !valid && n > 0 && <p className="text-xs text-red-400 mt-1.5">Not enough coins.</p>}
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-cp-border text-cp-muted text-sm hover:text-cp-text transition-colors">Cancel</button>
          <button onClick={() => valid && onConfirm(type, n)} disabled={!valid || loading}
            className="flex-1 py-2.5 rounded-xl bg-red-500/80 hover:bg-red-500 text-white text-sm font-semibold transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
            {loading && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            Buy
          </button>
        </div>
      </div>
    </div>
  )
}
