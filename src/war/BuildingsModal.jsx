import { BUILDINGS, BUILDING_TYPES, SLOTS_PER_REGION, buildingCost } from './buildings.js'

export default function BuildingsModal({ regionName, regionBuildings, regionCoastal = false, balance, onBuild, onUpgrade, onClose, loading, canReinforce, onReinforce }) {
  const used = regionBuildings.length
  const slotsLeft = SLOTS_PER_REGION - used

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-cp-card border border-cp-border rounded-3xl p-6 space-y-4 shadow-2xl">
        <h3 className="font-display text-lg text-cp-text">{regionName}</h3>

        {canReinforce && (
          <button onClick={onReinforce} disabled={loading}
            className="w-full py-2.5 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-300 hover:bg-sky-500/25 hover:border-sky-500/50 text-sm font-semibold transition-all disabled:opacity-40">
            🏃 Reinforce from another province
          </button>
        )}

        <p className="text-xs text-cp-muted uppercase tracking-wider pt-1">Buildings</p>
        <p className="text-xs text-cp-muted">{slotsLeft} of {SLOTS_PER_REGION} slots free. Economy buildings help your whole empire but are lost if this province is captured.</p>

        {/* Existing buildings (upgradeable) */}
        {regionBuildings.map((b) => {
          const next = buildingCost(b.type, b.level)
          const maxed = next === Infinity // 3-tier building at Lv3, or a single-tier port
          return (
            <div key={b.id} className="flex items-center gap-3 bg-cp-elevated border border-cp-border rounded-xl px-3 py-2.5">
              <div className="flex-1">
                <p className="text-sm text-cp-text">{BUILDINGS[b.type].label} <span className="text-cp-muted">Lv {b.level}</span></p>
                <p className="text-[11px] text-cp-muted">{BUILDINGS[b.type].desc}</p>
              </div>
              <button disabled={loading || maxed || (balance ?? 0) < next}
                onClick={() => onUpgrade(b)}
                className="px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-semibold disabled:opacity-30">
                {maxed ? 'Max' : `Upgrade · ${next.toLocaleString()}`}
              </button>
            </div>
          )
        })}

        {/* Build new (if slots free) */}
        {slotsLeft > 0 && (
          <div className="grid grid-cols-1 gap-2 pt-1">
            <p className="text-xs text-cp-muted uppercase tracking-wider">Build new</p>
            {BUILDING_TYPES.filter((t) => !regionBuildings.some((b) => b.type === t) && (!BUILDINGS[t].coastal || regionCoastal)).map((t) => {
              const cost = buildingCost(t, 0)
              return (
                <button key={t} disabled={loading || (balance ?? 0) < cost} onClick={() => onBuild(t)}
                  className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-cp-border text-left hover:border-cp-border-soft disabled:opacity-30">
                  <span className="text-sm text-cp-text">{BUILDINGS[t].label}<span className="block text-[11px] text-cp-muted">{BUILDINGS[t].desc}</span></span>
                  <span className="text-amber-400 text-xs font-semibold">{cost.toLocaleString()}</span>
                </button>
              )
            })}
          </div>
        )}

        <button onClick={onClose} className="w-full py-2.5 rounded-xl border border-cp-border text-cp-muted text-sm hover:text-cp-text transition-colors">Done</button>
      </div>
    </div>
  )
}
