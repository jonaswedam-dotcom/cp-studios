import { describeEvent } from './events.js'
import { formatDuration } from './units.js'

export default function Sidebar({ me, myRegions, myUnits, balance, leaderboard, onBuy, eliminated, bonuses, events, graph, outgoing, incoming, shieldMsLeft, incomePerHour }) {
  const costBonus = bonuses ? Math.round((1 - bonuses.costMult) * 100) : 0
  const strengthBonus = bonuses ? Math.round((bonuses.strengthMult - 1) * 100) : 0
  const hasBonuses = costBonus > 0 || strengthBonus > 0
  return (
    <aside className="w-full lg:w-72 flex-shrink-0 bg-cp-card border-t lg:border-t-0 lg:border-l border-cp-border overflow-y-auto">
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 pt-1">
          <h1 className="font-display text-lg text-cp-text">CP War</h1>
        </div>

        {me && (
          <div className="bg-cp-elevated border border-cp-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: me.color }} />
              <span className="text-cp-text text-sm font-semibold truncate">{me.display_name}</span>
              {eliminated && <span className="text-[10px] text-red-400 bg-red-500/15 border border-red-500/25 px-1.5 py-0.5 rounded-full">Eliminated</span>}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-cp-card rounded-xl p-2.5"><p className="text-cp-muted mb-0.5">Provinces</p><p className="text-cp-text font-bold text-base">{myRegions}</p></div>
              <div className="bg-cp-card rounded-xl p-2.5"><p className="text-cp-muted mb-0.5">Units</p><p className="text-cp-text font-bold text-base">{myUnits.toLocaleString()}</p></div>
              <div className="bg-cp-card rounded-xl p-2.5 col-span-2"><p className="text-cp-muted mb-0.5">Coins</p><p className="text-amber-400 font-bold">{(balance ?? 0).toLocaleString()}</p></div>
            </div>
            {hasBonuses && (
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {costBonus > 0 && <span className="px-2 py-1 rounded-lg bg-cp-card text-cp-muted">Troops −{costBonus}% cost</span>}
                {strengthBonus > 0 && <span className="px-2 py-1 rounded-lg bg-cp-card text-cp-muted">+{strengthBonus}% strength</span>}
              </div>
            )}
            <button onClick={onBuy} className="w-full py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 hover:border-red-500/50 text-sm font-semibold transition-all">
              Buy Units
            </button>
          </div>
        )}

        {me && (
          <div className="bg-cp-elevated border border-cp-border rounded-2xl p-4 space-y-2 text-xs">
            {shieldMsLeft > 0 && (
              <p className="text-cp-text">🛡 Shield: <b>{formatDuration(Math.round(shieldMsLeft / 1000))}</b> left</p>
            )}
            <p className="text-cp-muted">💰 Income: <b className="text-amber-400">+{(incomePerHour || 0).toLocaleString()}/hr</b></p>
            {outgoing && outgoing.length > 0 && (
              <div><p className="text-cp-muted mt-1 mb-1">Outgoing</p>
                {outgoing.map((m) => (
                  <p key={m.id} className="text-cp-text">→ {graph?.regions?.[m.to_region]?.city || m.to_region} · {formatDuration(Math.max(0, Math.round((new Date(m.arrives_at).getTime() - Date.now()) / 1000)))}</p>
                ))}</div>
            )}
            {incoming && incoming.length > 0 && (
              <div><p className="text-red-400 mt-1 mb-1">⚠ Incoming</p>
                {incoming.map((m) => (
                  <p key={m.id} className="text-red-300">{graph?.regions?.[m.to_region]?.city || m.to_region} · {formatDuration(Math.max(0, Math.round((new Date(m.arrives_at).getTime() - Date.now()) / 1000)))}</p>
                ))}</div>
            )}
          </div>
        )}

        <div>
          <p className="text-xs text-cp-muted uppercase tracking-wider mb-2">Leaderboard</p>
          <div className="space-y-1.5">
            {leaderboard.map((p, i) => (
              <div key={p.user_id} className="flex items-center gap-2 px-3 py-2 bg-cp-elevated rounded-xl">
                <span className="text-xs text-cp-muted/60 w-4 text-right">{i + 1}</span>
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
                <span className="flex-1 text-xs text-cp-text truncate">{p.display_name}</span>
                <span className="text-xs text-cp-muted">{p.regionCount} prov.</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-cp-elevated border border-cp-border rounded-2xl p-4 space-y-2">
          <p className="text-xs font-semibold text-cp-muted uppercase tracking-wider">How to Play</p>
          <div className="space-y-1.5 text-xs text-cp-muted leading-relaxed">
            <p>🖱 Click one of your provinces to select it</p>
            <p>🎯 Click again to choose units + a destination</p>
            <p>🪖 Soldiers/tanks move to bordering provinces</p>
            <p>✈️ Jets fly across water to nearby provinces</p>
            <p>🚢 Warships ferry troops between coastal provinces</p>
            <p>🏗 Click a province you own again to build/upgrade</p>
            <p>⚔️ Combat resolves when units arrive</p>
            <p>💰 Buy units with coins; expand to win</p>
          </div>
        </div>

        <div>
          <p className="text-xs text-cp-muted uppercase tracking-wider mb-2">Activity</p>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {(events || []).length === 0 && <p className="text-xs text-cp-muted/60">No activity yet.</p>}
            {(events || []).map((e) => {
              const { icon, text } = describeEvent(e, graph)
              return (
                <div key={e.id} className="flex items-start gap-2 px-3 py-2 bg-cp-elevated rounded-xl text-xs">
                  <span>{icon}</span><span className="flex-1 text-cp-text">{text}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </aside>
  )
}
