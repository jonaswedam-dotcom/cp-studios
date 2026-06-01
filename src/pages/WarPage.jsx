import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { useApp } from '../context/AppContext'
import { useCasino } from '../context/CasinoContext'
import { useWarData } from '../war/useWarData.js'
import MapView from '../war/MapView.jsx'
import Sidebar from '../war/Sidebar.jsx'
import BuyUnitsModal from '../war/BuyUnitsModal.jsx'
import MoveUnitsModal from '../war/MoveUnitsModal.jsx'
import BuildingsModal from '../war/BuildingsModal.jsx'
import { UNITS, UNIT_TYPES, formatDuration } from '../war/units.js'
import { describeEvent } from '../war/events.js'
import { troopCost, armySizeMultiplier } from '../war/economy.js'
import { emptyStack } from '../war/combat.js'
import { costMultiplier, strengthMultiplier, buildingCost, SLOTS_PER_REGION } from '../war/buildings.js'
import { landNeighbors, airReachable, seaReachable } from '../war/geo.js'
import { validateMove } from '../war/movement.js'
import { pickRandomSpawn } from '../war/spawn.js'

// Flip to false to enable the live game.
const COMING_SOON = false

const PLAYER_COLORS = [
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899',
  '#06b6d4','#84cc16','#f43f5e','#fb923c','#a3e635','#2dd4bf','#60a5fa','#c084fc',
]

export default function WarPage() {
  if (COMING_SOON) return <WarComingSoon />
  return <WarGame />
}

function WarComingSoon() {
  const navigate = useNavigate()
  return (
    <div className="min-h-[calc(100vh-64px)] bg-cp-bg flex items-center justify-center p-6">
      <div className="flex flex-col items-center text-center max-w-sm gap-6">
        <h1 className="font-display text-2xl text-cp-text font-normal">CP War — Coming Soon</h1>
        <button onClick={() => navigate('/')} className="px-6 py-2.5 rounded-xl border border-cp-border text-cp-muted text-sm font-medium hover:text-cp-text transition-all">Back to Home</button>
      </div>
    </div>
  )
}

function WarGame() {
  const { session } = useApp()
  const { balance, adjustBalance, loadBalance } = useCasino()
  const userId   = session?.user?.id
  const userName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || 'Player'

  const { graph, regions, players, movements, buildings, events, loading } = useWarData(userId)

  const [selected, setSelected]   = useState(null)   // region_id (one of mine)
  const [showBuy, setShowBuy]     = useState(false)
  const [moveFrom, setMoveFrom]   = useState(null)    // region_id for the move modal
  const [buildFor, setBuildFor]   = useState(null)    // region_id for the buildings modal
  const [busy, setBusy]           = useState(false)
  const [flash, setFlash]         = useState('')
  const initRef = useRef(false)
  const lastEventId = useRef(0)

  const me = players.find((p) => p.user_id === userId) || null
  const myRegionRows = Object.values(regions).filter((r) => r.owner_id === userId)
  const myUnits = myRegionRows.reduce((s, r) => s + UNIT_TYPES.reduce((a, t) => a + (r[t] || 0), 0), 0)
  const eliminated = me && myRegionRows.length === 0

  const myBuildings    = buildings.filter((b) => b.owner_id === userId)
  const buildingsIn    = (regionId) => buildings.filter((b) => b.region_id === regionId)
  const myCostMult     = costMultiplier(myBuildings)
  const myStrengthMult = strengthMultiplier(myBuildings)
  const myArmyMult     = armySizeMultiplier(myUnits)

  const now = Date.now()
  const myRegionIds = new Set(myRegionRows.map((r) => r.region_id))
  const outgoing = movements.filter((m) => m.player_id === userId && m.status === 'moving')
  const incoming = movements.filter((m) => m.status === 'moving' && m.player_id !== userId && myRegionIds.has(m.to_region))
  const shieldMsLeft = me?.shield_until ? new Date(me.shield_until).getTime() - now : 0
  const banksLevel = myBuildings.filter((b) => b.type === 'bank').reduce((s, b) => s + b.level, 0)
  const incomePerHour = banksLevel * 50 + myRegionRows.length * 10

  const showFlash = (m) => { setFlash(m); setTimeout(() => setFlash(''), 4000) }

  // ── Event toasts: fire showFlash for each newly-arrived event ───────────────
  useEffect(() => {
    const newest = events[0]
    if (!newest || newest.id <= lastEventId.current) return
    if (lastEventId.current !== 0) {
      const { icon, text } = describeEvent(newest, graph)
      showFlash(`${icon} ${text}`)
    }
    lastEventId.current = newest.id
  }, [events, graph])

  // ── First join: assign a random spawn province ──────────────────────────────
  useEffect(() => {
    if (loading || !graph || !userId || initRef.current) return
    if (me) { initRef.current = true; return }
    initRef.current = true
    ;(async () => {
      const claimed = new Set(Object.keys(regions))
      const used = new Set(players.map((p) => p.color))
      const color = PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[players.length % PLAYER_COLORS.length]
      const spawn = pickRandomSpawn(graph, claimed, Math.random)
      if (!spawn) { showFlash('The world is full!'); return }

      const { data: spawned, error } = await supabase.rpc('war_spawn', {
        p_region: spawn, p_country: graph.regions[spawn]?.country || null, p_color: color, p_name: userName,
      })
      if (error || !spawned) {
        initRef.current = false
        showFlash('Could not join the war — try again in a moment.')
        return
      }
      showFlash(`You start in ${graph.regions[spawned]?.city || spawned}!`)
    })()
  }, [loading, graph, userId, me, regions, players, userName])

  // ── Buy units (deploy onto HQ region) ───────────────────────────────────────
  const handleBuy = useCallback(async (type, count) => {
    if (busy || !me) return
    setBusy(true)
    try {
      const cost = troopCost(type, count, myCostMult, myArmyMult)
      if ((balance ?? 0) < cost) { showFlash('Not enough coins.'); return }
      let target = myRegionRows.find((r) => r.is_hq) || myRegionRows[0]
      if (!target) {
        const claimed = new Set(Object.keys(regions))
        const spawn = pickRandomSpawn(graph, claimed, Math.random)
        if (!spawn) { showFlash('No room to respawn.'); return }
        const { error: upErr } = await supabase.from('war_regions').upsert({
          region_id: spawn, owner_id: userId, owner_name: me.display_name, color: me.color,
          is_hq: true, ...emptyStack(), [type]: count,
        }, { onConflict: 'region_id' })
        if (upErr) { showFlash('Respawn failed.'); return }
        await adjustBalance(-cost)
        await supabase.from('war_players').update({ spawn_region: spawn }).eq('user_id', userId)
        showFlash(`Respawned in ${graph.regions[spawn]?.city || spawn}!`)
        return
      }
      const { error: upErr } = await supabase.from('war_regions')
        .update({ [type]: (target[type] || 0) + count, updated_at: new Date().toISOString() })
        .eq('region_id', target.region_id)
      if (upErr) { showFlash('Purchase failed.'); return }
      await adjustBalance(-cost)
      showFlash(`+${count} ${UNITS[type].label}${count > 1 ? 's' : ''}`)
    } finally { setShowBuy(false); setBusy(false) }
  }, [busy, me, balance, myRegionRows, regions, graph, userId, adjustBalance, myCostMult])

  // ── Send a movement ─────────────────────────────────────────────────────────
  const handleMove = useCallback(async ({ dest, stack, mode }) => {
    if (busy || !moveFrom) return
    setBusy(true)
    try {
      const src = regions[moveFrom]
      if (!src || src.owner_id !== userId) { showFlash('Move no longer valid.'); return }
      for (const t of UNIT_TYPES) if ((stack[t] || 0) > (src[t] || 0)) { showFlash('Not enough units.'); return }
      const v = validateMove(moveFrom, dest, stack, graph)
      if (v.error) { showFlash(v.error); return }
      const destRow = regions[dest]
      const destShielded = destRow?.owner_id && destRow.owner_id !== userId &&
        players.some((p) => p.user_id === destRow.owner_id && p.shield_until && new Date(p.shield_until) > new Date())
      if (destShielded) { showFlash("That player is shielded — you can't attack yet."); return }
      const arrivesAt = new Date(Date.now() + v.arrivesInSeconds * 1000).toISOString()
      const dec = {}; for (const t of UNIT_TYPES) dec[t] = (src[t] || 0) - (stack[t] || 0)
      const { error: decErr } = await supabase.from('war_regions').update({ ...dec, updated_at: new Date().toISOString() }).eq('region_id', moveFrom)
      if (decErr) { showFlash('Move failed.'); return }
      const { error: mvErr } = await supabase.from('war_movements').insert({
        player_id: userId, from_region: moveFrom, to_region: dest, units: stack, mode, arrives_at: arrivesAt,
      })
      if (mvErr) {
        await supabase.from('war_regions').update({ ...Object.fromEntries(UNIT_TYPES.map((t) => [t, src[t] || 0])), updated_at: new Date().toISOString() }).eq('region_id', moveFrom)
        showFlash('Move failed.'); return
      }
      showFlash(`Force en route — arrives in ${formatDuration(v.arrivesInSeconds)}`)
    } finally { setMoveFrom(null); setSelected(null); setBusy(false) }
  }, [busy, moveFrom, regions, userId, players, graph])

  // ── Build / upgrade buildings on an owned province ──────────────────────────
  const handleBuild = useCallback(async (type) => {
    if (busy || !buildFor) return
    setBusy(true)
    try {
      if (regions[buildFor]?.owner_id !== userId) { showFlash('You no longer own this province.'); return }
      const cost = buildingCost(type, 0)
      if ((balance ?? 0) < cost) { showFlash('Not enough coins.'); return }
      if (buildingsIn(buildFor).length >= SLOTS_PER_REGION) { showFlash('No slots left.'); return }
      const { error } = await supabase.from('war_buildings').insert({ region_id: buildFor, owner_id: userId, type, level: 1 })
      if (error) { showFlash('Build failed.'); return }
      await adjustBalance(-cost)
      showFlash(`Built ${type}.`)
    } finally { setBusy(false) }
  }, [busy, buildFor, balance, buildings, regions, userId, adjustBalance])

  const handleUpgrade = useCallback(async (b) => {
    if (busy) return
    setBusy(true)
    try {
      if (b.owner_id !== userId || regions[buildFor]?.owner_id !== userId) { showFlash('You no longer own this building.'); return }
      const cost = buildingCost(b.type, b.level)
      if (b.level >= 3) { showFlash('Already max level.'); return }
      if ((balance ?? 0) < cost) { showFlash('Not enough coins.'); return }
      const { error } = await supabase.from('war_buildings').update({ level: b.level + 1 }).eq('id', b.id)
      if (error) { showFlash('Upgrade failed.'); return }
      await adjustBalance(-cost)
      showFlash(`Upgraded ${b.type} to Lv ${b.level + 1}.`)
    } finally { setBusy(false) }
  }, [busy, buildFor, balance, regions, userId, adjustBalance])

  // ── Collect accrued income into the wallet on load + every 60s (also stamps activity) ──
  // Combat + movement resolution is now server-authoritative (the pg_cron war_tick()).
  useEffect(() => {
    if (!userId) return
    let alive = true
    const collect = async () => {
      const { data, error } = await supabase.rpc('war_collect_income')
      if (!alive || error) return
      if (data && data > 0) { showFlash(`+${data.toLocaleString()} coins (income)`); loadBalance() }
    }
    collect()
    const id = setInterval(collect, 60000)
    return () => { alive = false; clearInterval(id) }
  }, [userId, loadBalance])

  // ── Province click: select own → open move modal on second click ────────────
  const onRegionClick = useCallback((regionId) => {
    const row = regions[regionId]
    if (!selected) {
      if (row?.owner_id === userId) setSelected(regionId)
      return
    }
    if (regionId === selected) { setBuildFor(selected); setSelected(null); return }
    const src = regions[selected]
    if (!src || src.owner_id !== userId) { setSelected(null); return } // lost the source meanwhile
    const reachableLand = landNeighbors(selected, graph)
    const reachableAir  = graph ? airReachable(selected, graph, UNITS.jet.airRangeKm) : []
    const reachableSea  = graph ? seaReachable(selected, graph, UNITS.warship.seaRangeKm) : []
    const hasLand = (src.soldier || 0) > 0 || (src.tank || 0) > 0
    const hasJet  = (src.jet || 0) > 0
    const hasSea  = (src.warship || 0) > 0
    const canReach = (reachableLand.includes(regionId) && hasLand) || (reachableAir.includes(regionId) && hasJet) || (reachableSea.includes(regionId) && hasSea)
    const targetShielded = row?.owner_id && row.owner_id !== userId &&
      players.some((p) => p.user_id === row.owner_id && p.shield_until && new Date(p.shield_until) > new Date())
    if (canReach && targetShielded) { showFlash("That player is shielded — you can't attack yet."); return }
    if (canReach) { setMoveFrom(selected); return }
    if (row?.owner_id === userId) setSelected(regionId)
    else setSelected(null)
  }, [selected, regions, userId, graph, players])

  const highlight = useMemo(() => {
    if (!selected || !graph) return null
    const src = regions[selected]
    if (!src || src.owner_id !== userId) return null
    const land = (src.soldier || src.tank) ? landNeighbors(selected, graph) : []
    const air  = (src.jet) ? airReachable(selected, graph, UNITS.jet.airRangeKm) : []
    const sea  = (src.warship) ? seaReachable(selected, graph, UNITS.warship.seaRangeKm) : []
    const reach = new Set([...land, ...air, ...sea])
    const enemy = [...reach].filter((id) => regions[id]?.owner_id && regions[id].owner_id !== userId)
    const open  = [...reach].filter((id) => !regions[id]?.owner_id || regions[id].owner_id === userId)
    return { enemy: new Set(enemy), open: new Set(open) }
  }, [selected, graph, regions, userId])

  const leaderboard = players
    .map((p) => ({ ...p, regionCount: Object.values(regions).filter((r) => r.owner_id === p.user_id).length }))
    .sort((a, b) => b.regionCount - a.regionCount)
    .slice(0, 8)

  if (loading || !graph) return (
    <div className="min-h-screen bg-cp-bg flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-2 border-red-400 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-cp-muted text-sm">Loading war map…</p>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-64px)] overflow-hidden bg-[#0a0a0a]">
      {showBuy && <BuyUnitsModal balance={balance} costMult={myCostMult} armyMult={myArmyMult} loading={busy} onConfirm={handleBuy} onClose={() => setShowBuy(false)} />}
      {moveFrom && <MoveUnitsModal graph={graph} regions={regions} fromRegion={moveFrom} loading={busy} onConfirm={handleMove} onClose={() => { setMoveFrom(null); setSelected(null) }} />}
      {buildFor && (
        <BuildingsModal regionName={graph.regions[buildFor]?.city || buildFor}
          regionBuildings={buildingsIn(buildFor)} balance={balance} loading={busy}
          onBuild={handleBuild} onUpgrade={handleUpgrade} onClose={() => setBuildFor(null)} />
      )}

      {flash && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-cp-card border border-cp-border rounded-2xl text-sm font-medium text-cp-text shadow-xl pointer-events-none">
          {flash}
        </div>
      )}
      {eliminated && (
        <div className="fixed top-36 left-1/2 -translate-x-1/2 z-50 max-w-sm w-full mx-4 px-5 py-4 bg-red-900/80 border border-red-500/40 rounded-2xl text-center shadow-2xl backdrop-blur-sm">
          <p className="text-white font-semibold text-sm mb-1">💀 You have no provinces left!</p>
          <button onClick={() => setShowBuy(true)} className="mt-2 px-4 py-2 bg-red-500 hover:bg-red-400 text-white text-xs font-semibold rounded-xl transition-colors">Buy units to respawn</button>
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        <MapView graph={graph} regions={regions} movements={movements} buildings={buildings} onRegionClick={onRegionClick} highlight={highlight} />
        {selected && (
          <div className="absolute top-3 left-3 z-10 bg-cp-card border border-cp-border rounded-xl px-3 py-2 text-xs text-cp-text shadow-xl">
            Selected: <b>{graph.regions[selected]?.city || selected}</b> — click a reachable province to move/attack, or click it again to deselect.
          </div>
        )}
      </div>

      <Sidebar me={me} myRegions={myRegionRows.length} myUnits={myUnits} balance={balance}
        leaderboard={leaderboard} onBuy={() => setShowBuy(true)} eliminated={eliminated}
        bonuses={{ costMult: myCostMult, strengthMult: myStrengthMult }}
        events={events} graph={graph}
        outgoing={outgoing} incoming={incoming} shieldMsLeft={shieldMsLeft} incomePerHour={incomePerHour} />
    </div>
  )
}
