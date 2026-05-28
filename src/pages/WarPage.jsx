import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabase'
import { useApp } from '../context/AppContext'
import { useCasino } from '../context/CasinoContext'

// ─── Config ───────────────────────────────────────────────────────────────────
const GRID_COLS      = 31   // q range 0..30
const GRID_ROWS      = 25   // r range 0..24
const HEX_SIZE       = 28   // flat-top radius
const TROOP_COST     = 500  // coins per troop
const MOVE_SECONDS   = 30   // seconds per tile

// flat-top hex: width = size*2, height = size*sqrt(3)
const HW = HEX_SIZE * 2
const HH = Math.round(HEX_SIZE * Math.sqrt(3))

// ─── 20 vivid, distinct player colors ────────────────────────────────────────
const PLAYER_COLORS = [
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6',
  '#3b82f6','#8b5cf6','#ec4899','#06b6d4','#84cc16',
  '#f43f5e','#fb923c','#a3e635','#2dd4bf','#60a5fa',
  '#c084fc','#f472b6','#34d399','#38bdf8','#facc15',
]

// ─── Hex math (flat-top) ──────────────────────────────────────────────────────
// Pixel center of hex (q, r)
function hexCenter(q, r) {
  const x = HEX_SIZE * 1.5 * q
  const y = HH * (r + (q % 2 === 0 ? 0 : 0.5))
  return { x, y }
}

// Flat-top hex corners
function hexCorners(cx, cy) {
  const pts = []
  for (let i = 0; i < 6; i++) {
    const angleDeg = 60 * i          // flat-top starts at 0°
    const rad      = (Math.PI / 180) * angleDeg
    pts.push({ x: cx + HEX_SIZE * Math.cos(rad), y: cy + HEX_SIZE * Math.sin(rad) })
  }
  return pts
}

// Flat-top axial neighbors (6 directions)
const HEX_DIRS_EVEN = [
  [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1],
]
const HEX_DIRS_ODD = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [0, -1],
]
function hexNeighbors(q, r) {
  const dirs = (q % 2 === 0) ? HEX_DIRS_EVEN : HEX_DIRS_ODD
  return dirs.map(([dq, dr]) => ({ q: q + dq, r: r + dr }))
    .filter(n => n.q >= 0 && n.q < GRID_COLS && n.r >= 0 && n.r < GRID_ROWS)
}

// Pixel → hex (for click hit-testing)
function pixelToHex(px, py) {
  // Brute-force nearest center (fast enough for our grid size)
  let best = null, bestD = Infinity
  for (let q = 0; q < GRID_COLS; q++) {
    for (let r = 0; r < GRID_ROWS; r++) {
      const { x, y } = hexCenter(q, r)
      const d = (px - x) ** 2 + (py - y) ** 2
      if (d < bestD) { bestD = d; best = { q, r } }
    }
  }
  return best
}

// Canvas total size
const CANVAS_W = Math.ceil(HEX_SIZE * 1.5 * (GRID_COLS - 1) + HEX_SIZE * 2)
const CANVAS_H = Math.ceil(HH * GRID_ROWS + HH * 0.5 + 4)

// ─── Drawing helpers ──────────────────────────────────────────────────────────
function drawHex(ctx, q, r, fillColor, strokeColor, strokeWidth, alpha = 1) {
  const { x, y } = hexCenter(q, r)
  const pts = hexCorners(x, y)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.closePath()
  ctx.fillStyle = fillColor
  ctx.fill()
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = strokeWidth
  ctx.stroke()
  ctx.restore()
}

function drawTroopLabel(ctx, q, r, count, color) {
  const { x, y } = hexCenter(q, r)
  const label = count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count)
  ctx.save()
  ctx.font         = `bold ${count >= 100 ? 9 : 10}px system-ui, sans-serif`
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  // Shadow for contrast
  ctx.fillStyle    = 'rgba(0,0,0,0.7)'
  ctx.fillText(label, x + 1, y + 1)
  ctx.fillStyle    = color === '#000000' ? '#fff' : '#fff'
  ctx.fillText(label, x, y)
  ctx.restore()
}

// ─── Buy Troops Modal ─────────────────────────────────────────────────────────
function BuyTroopsModal({ balance, onConfirm, onClose, loading }) {
  const [count, setCount] = useState('')
  const max = Math.floor((balance ?? 0) / TROOP_COST)
  const n   = parseInt(count) || 0
  const cost = n * TROOP_COST
  const valid = n >= 1 && n <= max

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-cp-card border border-cp-border rounded-3xl p-6 space-y-5 shadow-2xl">
        <h3 className="font-display text-lg text-cp-text">Buy Troops</h3>
        <p className="text-cp-muted text-sm">
          Each troop costs <span className="text-amber-400 font-semibold">500 coins</span>.
          You can afford up to <span className="text-cp-text font-semibold">{max.toLocaleString()}</span> troops.
        </p>
        <div>
          <label className="block text-xs text-cp-muted uppercase tracking-wider mb-1.5">Troop Count</label>
          <input
            autoFocus
            type="number" min={1} max={max}
            value={count}
            onChange={e => setCount(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && valid && onConfirm(n)}
            className="w-full bg-cp-elevated border border-cp-border rounded-xl px-4 py-3 text-cp-text text-sm focus:border-red-500/50 focus:outline-none"
            placeholder="e.g. 50"
          />
          {count && !valid && n > 0 && (
            <p className="text-xs text-red-400 mt-1.5">
              {n > max ? `Not enough coins (need ${(n * TROOP_COST).toLocaleString()})` : 'Enter at least 1'}
            </p>
          )}
          {valid && (
            <p className="text-xs text-amber-400/80 mt-1.5">
              Cost: {cost.toLocaleString()} coins
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-cp-border text-cp-muted text-sm hover:text-cp-text transition-colors">
            Cancel
          </button>
          <button
            onClick={() => valid && onConfirm(n)}
            disabled={!valid || loading}
            className="flex-1 py-2.5 rounded-xl bg-red-500/80 hover:bg-red-500 text-white text-sm font-semibold transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {loading && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            Buy Troops
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Move Troops Modal ────────────────────────────────────────────────────────
function MoveTroopsModal({ fromTile, toTile, isAttack, onConfirm, onClose, loading }) {
  const [count, setCount] = useState('')
  const max   = Math.max(0, (fromTile?.troop_count ?? 1) - 1) // keep ≥1 behind
  const n     = parseInt(count) || 0
  const valid = n >= 1 && n <= max

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-cp-card border border-cp-border rounded-3xl p-6 space-y-5 shadow-2xl">
        <h3 className="font-display text-lg text-cp-text">
          {isAttack ? '⚔️ Attack' : '🏃 Move Troops'}
        </h3>
        {isAttack ? (
          <p className="text-cp-muted text-sm">
            Attacking <span className="text-cp-text font-medium">{toTile?.owner_name || 'unclaimed'}</span>
            {toTile?.troop_count > 0 && ` — they have ${toTile.troop_count.toLocaleString()} troops`}.
            Arrives in <span className="text-cp-text font-medium">30 seconds</span>.
          </p>
        ) : (
          <p className="text-cp-muted text-sm">
            Moving troops to an adjacent tile.
            Arrives in <span className="text-cp-text font-medium">30 seconds</span>.
          </p>
        )}
        <div>
          <label className="block text-xs text-cp-muted uppercase tracking-wider mb-1.5">
            Troops to send (max {max.toLocaleString()})
          </label>
          <input
            autoFocus
            type="number" min={1} max={max}
            value={count}
            onChange={e => setCount(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && valid && onConfirm(n)}
            className="w-full bg-cp-elevated border border-cp-border rounded-xl px-4 py-3 text-cp-text text-sm focus:border-red-500/50 focus:outline-none"
            placeholder={`1 – ${max}`}
          />
          {count && !valid && n > 0 && (
            <p className="text-xs text-red-400 mt-1.5">
              {n > max ? `Source tile must keep at least 1 troop` : 'Enter at least 1'}
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-cp-border text-cp-muted text-sm hover:text-cp-text transition-colors">
            Cancel
          </button>
          <button
            onClick={() => valid && onConfirm(n)}
            disabled={!valid || loading}
            className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors disabled:opacity-40 flex items-center justify-center gap-2 ${
              isAttack ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            {loading && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {isAttack ? 'Launch Attack' : 'Send Troops'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function WarPage() {
  const { session } = useApp()
  const { balance, placeBet } = useCasino()
  const userId   = session?.user?.id
  const userName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || 'Player'

  // ── State ──────────────────────────────────────────────────────────────────
  const [warPlayer,    setWarPlayer]    = useState(null)   // own war_players row
  const [tiles,        setTiles]        = useState({})     // key: `${q},${r}` → tile
  const [movements,    setMovements]    = useState([])     // active war_movements
  const [allPlayers,   setAllPlayers]   = useState([])     // all war_players
  const [initializing, setInitializing] = useState(true)
  const [error,        setError]        = useState('')

  // UI state
  const [selectedTile, setSelectedTile] = useState(null)   // {q,r}
  const [hoverTile,    setHoverTile]    = useState(null)
  const [tooltip,      setTooltip]      = useState(null)   // {x,y,tile}
  const [showBuyModal, setShowBuyModal] = useState(false)
  const [moveModal,    setMoveModal]    = useState(null)   // {fromTile, toTile, isAttack}
  const [actionLoading, setActionLoading] = useState(false)
  const [eliminated,   setEliminated]   = useState(false)
  const [flashMsg,     setFlashMsg]     = useState('')

  // Canvas / pan / zoom
  const canvasRef  = useRef(null)
  const offsetRef  = useRef({ x: -60, y: -30 })
  const scaleRef   = useRef(0.85)
  const dragging   = useRef(false)
  const dragStart  = useRef({ x: 0, y: 0, ox: 0, oy: 0 })
  const animRef    = useRef(null)

  // ── Tile key helpers ───────────────────────────────────────────────────────
  const tKey = (q, r) => `${q},${r}`

  // ── Fetch all data ─────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    const [tilesRes, playersRes, movRes] = await Promise.all([
      supabase.from('war_tiles').select('*'),
      supabase.from('war_players').select('*'),
      supabase.from('war_movements').select('*').eq('status', 'moving'),
    ])

    if (tilesRes.data) {
      const m = {}
      tilesRes.data.forEach(t => { m[tKey(t.q, t.r)] = t })
      setTiles(m)
    }
    if (playersRes.data) setAllPlayers(playersRes.data)
    if (movRes.data)     setMovements(movRes.data)

    // Find own war_players row
    if (playersRes.data && userId) {
      const mine = playersRes.data.find(p => p.user_id === userId)
      if (mine) setWarPlayer(mine)
    }
  }, [userId])

  // ── Player setup (first visit) ─────────────────────────────────────────────
  const initPlayer = useCallback(async (tilesMap, players) => {
    // Assign a color not already taken
    const usedColors = new Set(players.map(p => p.color))
    const color = PLAYER_COLORS.find(c => !usedColors.has(c)) || PLAYER_COLORS[players.length % PLAYER_COLORS.length]

    // Find a starting tile: prefer unclaimed, else least-troop enemy tile's neighbor
    let startQ = null, startR = null

    // Build set of owned positions
    const ownedKeys = new Set(Object.values(tilesMap).map(t => tKey(t.q, t.r)))

    // Try random unclaimed positions
    const allCoords = []
    for (let q = 0; q < GRID_COLS; q++)
      for (let r = 0; r < GRID_ROWS; r++)
        if (!ownedKeys.has(tKey(q, r))) allCoords.push({ q, r })

    if (allCoords.length > 0) {
      const pick = allCoords[Math.floor(Math.random() * allCoords.length)]
      startQ = pick.q; startR = pick.r
    } else {
      // Map full — find adjacent to least-troop tile
      const owned = Object.values(tilesMap).sort((a, b) => a.troop_count - b.troop_count)
      for (const t of owned) {
        const nbrs = hexNeighbors(t.q, t.r).filter(n => !ownedKeys.has(tKey(n.q, n.r)))
        if (nbrs.length > 0) {
          const pick = nbrs[Math.floor(Math.random() * nbrs.length)]
          startQ = pick.q; startR = pick.r; break
        }
      }
      // Absolute fallback
      if (startQ === null) { startQ = Math.floor(Math.random() * GRID_COLS); startR = Math.floor(Math.random() * GRID_ROWS) }
    }

    // Insert war_players row
    const { data: newPlayer, error: pe } = await supabase
      .from('war_players')
      .insert({ user_id: userId, display_name: userName, color, starting_q: startQ, starting_r: startR })
      .select().single()
    if (pe) { setError('Could not join the war.'); return }

    // Upsert starting tile
    const { error: te } = await supabase
      .from('war_tiles')
      .upsert({ q: startQ, r: startR, owner_id: userId, owner_name: userName, color, troop_count: 100 }, { onConflict: 'q,r' })
    if (te) { setError('Could not claim starting tile.'); return }

    setWarPlayer(newPlayer)
    setTiles(prev => ({ ...prev, [tKey(startQ, startR)]: { q: startQ, r: startR, owner_id: userId, owner_name: userName, color, troop_count: 100 } }))
  }, [userId, userName])

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return
    ;(async () => {
      setInitializing(true)
      await loadAll()
      setInitializing(false)
    })()
  }, [userId, loadAll])

  // After data loads, init player if needed
  const initDoneRef = useRef(false)
  useEffect(() => {
    if (initializing || initDoneRef.current || !userId) return
    if (!warPlayer) {
      initDoneRef.current = true
      initPlayer(tiles, allPlayers)
    }
  }, [initializing, warPlayer, tiles, allPlayers, userId, initPlayer])

  // ── Realtime subscriptions ─────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return
    const ch = supabase.channel('war-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'war_tiles' },
        payload => {
          const t = payload.new || payload.old
          if (!t) return
          if (payload.eventType === 'DELETE') {
            setTiles(prev => { const n = { ...prev }; delete n[tKey(t.q, t.r)]; return n })
          } else {
            setTiles(prev => ({ ...prev, [tKey(t.q, t.r)]: payload.new }))
          }
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'war_players' },
        payload => {
          if (payload.new?.user_id === userId) setWarPlayer(payload.new)
          setAllPlayers(prev => {
            const filtered = prev.filter(p => p.user_id !== (payload.new || payload.old)?.user_id)
            return payload.eventType === 'DELETE' ? filtered : [...filtered, payload.new]
          })
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'war_movements' },
        payload => {
          const m = payload.new || payload.old
          setMovements(prev => {
            const filtered = prev.filter(x => x.id !== m?.id)
            return (payload.new?.status === 'moving') ? [...filtered, payload.new] : filtered
          })
        })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [userId])

  // ── Movement resolution (poll every 5 s) ──────────────────────────────────
  const resolveMovements = useCallback(async () => {
    const now = new Date()
    const due = movements.filter(m => m.status === 'moving' && new Date(m.arrives_at) <= now)
    if (due.length === 0) return

    for (const mv of due) {
      const toKey = tKey(mv.to_q, mv.to_r)
      const dest  = tiles[toKey]

      // Mark movement as arrived first to prevent double-resolve
      const { error: mvErr } = await supabase
        .from('war_movements').update({ status: 'arrived' }).eq('id', mv.id).eq('status', 'moving')
      if (mvErr) continue  // already resolved by another client

      if (!dest || !dest.owner_id) {
        // Unclaimed — move in
        await supabase.from('war_tiles').upsert(
          { q: mv.to_q, r: mv.to_r, owner_id: mv.player_id,
            owner_name: allPlayers.find(p => p.user_id === mv.player_id)?.display_name || 'Player',
            color: allPlayers.find(p => p.user_id === mv.player_id)?.color || '#888',
            troop_count: mv.troop_count },
          { onConflict: 'q,r' }
        )
      } else if (dest.owner_id === mv.player_id) {
        // Friendly — reinforce
        await supabase.from('war_tiles')
          .update({ troop_count: dest.troop_count + mv.troop_count })
          .eq('q', mv.to_q).eq('r', mv.to_r)
      } else {
        // Combat
        const atkLeft = mv.troop_count - dest.troop_count
        const defLeft = dest.troop_count - mv.troop_count
        const killed  = Math.min(mv.troop_count, dest.troop_count)

        if (atkLeft > 0) {
          // Attacker wins — award coins for kills if it's ours
          if (mv.player_id === userId) {
            const coinReward = killed * TROOP_COST
            await supabase.from('wallets')
              .update({ balance: (balance ?? 0) + coinReward })
              .eq('user_id', userId)
            showFlash(`+${coinReward.toLocaleString()} coins from combat!`)
          }
          const atk = allPlayers.find(p => p.user_id === mv.player_id)
          await supabase.from('war_tiles').update({
            owner_id:    mv.player_id,
            owner_name:  atk?.display_name || 'Player',
            color:       atk?.color || '#888',
            troop_count: atkLeft,
          }).eq('q', mv.to_q).eq('r', mv.to_r)

          // Check if defender is eliminated
          await checkElimination(dest.owner_id)
        } else if (defLeft > 0) {
          // Defender wins — reduce defender troops
          await supabase.from('war_tiles')
            .update({ troop_count: defLeft })
            .eq('q', mv.to_q).eq('r', mv.to_r)
        } else {
          // Tie — defender keeps tile with 1 troop
          await supabase.from('war_tiles')
            .update({ troop_count: 1 })
            .eq('q', mv.to_q).eq('r', mv.to_r)
        }
      }
    }
  }, [movements, tiles, allPlayers, userId, balance])

  const showFlash = (msg) => {
    setFlashMsg(msg)
    setTimeout(() => setFlashMsg(''), 4000)
  }

  const checkElimination = useCallback(async (losingUserId) => {
    const { count } = await supabase
      .from('war_tiles')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', losingUserId)
    if ((count ?? 1) === 0) {
      await supabase.from('war_players').update({ is_alive: false }).eq('user_id', losingUserId)
      if (losingUserId === userId) setEliminated(true)
    }
  }, [userId])

  useEffect(() => {
    const interval = setInterval(resolveMovements, 5000)
    return () => clearInterval(interval)
  }, [resolveMovements])

  // ── Computed stats ─────────────────────────────────────────────────────────
  const myTiles  = Object.values(tiles).filter(t => t.owner_id === userId)
  const myTroops = myTiles.reduce((s, t) => s + t.troop_count, 0)

  // ── Canvas render ──────────────────────────────────────────────────────────
  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx    = canvas.getContext('2d')
    const W      = canvas.width
    const H      = canvas.height
    const ox     = offsetRef.current.x
    const oy     = offsetRef.current.y
    const sc     = scaleRef.current

    ctx.clearRect(0, 0, W, H)
    ctx.save()
    ctx.translate(ox, oy)
    ctx.scale(sc, sc)

    const nowMs = Date.now()

    // Draw all hexes
    for (let q = 0; q < GRID_COLS; q++) {
      for (let r = 0; r < GRID_ROWS; r++) {
        const tile    = tiles[tKey(q, r)]
        const isHover = hoverTile && hoverTile.q === q && hoverTile.r === r
        const isSel   = selectedTile && selectedTile.q === q && selectedTile.r === r

        const fillColor  = tile?.color  || '#1a1a1a'
        const baseAlpha  = tile?.color  ? 0.82 : 1
        const strokeClr  = isSel ? '#ffffff'
                         : isHover ? 'rgba(255,255,255,0.5)'
                         : 'rgba(255,255,255,0.08)'
        const strokeW    = isSel ? 2.5 : isHover ? 1.5 : 0.5

        drawHex(ctx, q, r, fillColor, strokeClr, strokeW, baseAlpha)

        // Troop count label
        if (tile && tile.troop_count > 0) {
          drawTroopLabel(ctx, q, r, tile.troop_count, tile.color)
        }
      }
    }

    // Draw "selected tile" neighbors highlighted
    if (selectedTile) {
      hexNeighbors(selectedTile.q, selectedTile.r).forEach(({ q, r }) => {
        drawHex(ctx, q, r, 'rgba(255,255,255,0.07)', 'rgba(255,255,255,0.3)', 1.2)
      })
    }

    // Draw in-transit movement dots
    movements.forEach(mv => {
      if (mv.status !== 'moving') return
      const total = new Date(mv.arrives_at) - new Date(mv.created_at)
      const elapsed = nowMs - new Date(mv.created_at).getTime()
      const t = Math.min(1, Math.max(0, elapsed / total))

      const from = hexCenter(mv.from_q, mv.from_r)
      const to   = hexCenter(mv.to_q,   mv.to_r)
      const x    = from.x + (to.x - from.x) * t
      const y    = from.y + (to.y - from.y) * t

      const pColor = allPlayers.find(p => p.user_id === mv.player_id)?.color || '#fff'
      ctx.save()
      ctx.beginPath()
      ctx.arc(x, y, 5, 0, Math.PI * 2)
      ctx.fillStyle = pColor
      ctx.shadowBlur = 8
      ctx.shadowColor = pColor
      ctx.fill()
      ctx.restore()

      // Label troops
      ctx.save()
      ctx.font = 'bold 8px system-ui'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillStyle = '#fff'
      ctx.fillText(mv.troop_count, x, y - 7)
      ctx.restore()
    })

    ctx.restore()
  }, [tiles, hoverTile, selectedTile, movements, allPlayers])

  // Animate (for moving dots)
  useEffect(() => {
    function loop() {
      render()
      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animRef.current)
  }, [render])

  // ── Canvas events ──────────────────────────────────────────────────────────
  const screenToWorld = useCallback((sx, sy) => ({
    x: (sx - offsetRef.current.x) / scaleRef.current,
    y: (sy - offsetRef.current.y) / scaleRef.current,
  }), [])

  const handleMouseDown = useCallback((e) => {
    dragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y }
  }, [])

  const handleMouseMove = useCallback((e) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    if (dragging.current) {
      offsetRef.current = {
        x: dragStart.current.ox + (e.clientX - dragStart.current.x),
        y: dragStart.current.oy + (e.clientY - dragStart.current.y),
      }
    }

    const wx = (e.clientX - rect.left - offsetRef.current.x) / scaleRef.current
    const wy = (e.clientY - rect.top  - offsetRef.current.y) / scaleRef.current
    const hx = pixelToHex(wx, wy)
    setHoverTile(hx)

    if (hx) {
      const tile = tiles[tKey(hx.q, hx.r)]
      setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, tile, q: hx.q, r: hx.r })
    } else {
      setTooltip(null)
    }
  }, [tiles])

  const handleMouseUp = useCallback((e) => {
    const moved = Math.abs(e.clientX - dragStart.current.x) + Math.abs(e.clientY - dragStart.current.y)
    dragging.current = false
    if (moved > 5) return  // was a drag, not a click

    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const wx = (e.clientX - rect.left - offsetRef.current.x) / scaleRef.current
    const wy = (e.clientY - rect.top  - offsetRef.current.y) / scaleRef.current
    const clicked = pixelToHex(wx, wy)
    if (!clicked) return

    const clickedKey  = tKey(clicked.q, clicked.r)
    const clickedTile = tiles[clickedKey]

    if (!selectedTile) {
      // Select if it's ours
      if (clickedTile?.owner_id === userId) setSelectedTile(clicked)
      return
    }

    // Already have a selection
    const isSameHex   = selectedTile.q === clicked.q && selectedTile.r === clicked.r
    if (isSameHex) { setSelectedTile(null); return }

    const isNeighbor = hexNeighbors(selectedTile.q, selectedTile.r)
      .some(n => n.q === clicked.q && n.r === clicked.r)

    if (!isNeighbor) {
      // Re-select if clicking a different own tile
      if (clickedTile?.owner_id === userId) { setSelectedTile(clicked); return }
      setSelectedTile(null)
      return
    }

    // Adjacent click — open move modal
    const fromTile = tiles[tKey(selectedTile.q, selectedTile.r)]
    if (!fromTile || fromTile.troop_count <= 1) { setSelectedTile(null); return }

    const isAttack = !clickedTile || clickedTile.owner_id !== userId
    setMoveModal({ fromTile, toTile: clickedTile || { q: clicked.q, r: clicked.r, troop_count: 0 }, toCoord: clicked, isAttack })
  }, [selectedTile, tiles, userId])

  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const delta    = e.deltaY > 0 ? 0.9 : 1.1
    const newScale = Math.min(2.5, Math.max(0.3, scaleRef.current * delta))
    const rect     = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    offsetRef.current = {
      x: mx - (mx - offsetRef.current.x) * (newScale / scaleRef.current),
      y: my - (my - offsetRef.current.y) * (newScale / scaleRef.current),
    }
    scaleRef.current = newScale
  }, [])

  const handleMouseLeave = useCallback(() => {
    dragging.current = false
    setHoverTile(null)
    setTooltip(null)
  }, [])

  // Attach wheel with passive:false (React synthetic events can't prevent default for wheel)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // ── Buy troops handler ─────────────────────────────────────────────────────
  const handleBuyTroops = useCallback(async (count) => {
    if (!warPlayer || actionLoading) return
    setActionLoading(true)
    try {
      const cost = count * TROOP_COST
      // Deduct from wallet
      const { error: we } = await supabase.from('wallets')
        .update({ balance: (balance ?? 0) - cost })
        .eq('user_id', userId)
      if (we) throw we

      const sq = warPlayer.starting_q, sr = warPlayer.starting_r
      const existing = tiles[tKey(sq, sr)]

      if (eliminated) {
        // Respawn on new unclaimed tile
        const unowned = []
        for (let q = 0; q < GRID_COLS; q++)
          for (let r = 0; r < GRID_ROWS; r++)
            if (!tiles[tKey(q, r)]?.owner_id) unowned.push({ q, r })

        let spawnQ = sq, spawnR = sr
        if (unowned.length > 0) {
          const p = unowned[Math.floor(Math.random() * unowned.length)]
          spawnQ = p.q; spawnR = p.r
        }

        await supabase.from('war_tiles').upsert(
          { q: spawnQ, r: spawnR, owner_id: userId, owner_name: warPlayer.display_name, color: warPlayer.color, troop_count: count },
          { onConflict: 'q,r' }
        )
        await supabase.from('war_players')
          .update({ is_alive: true, starting_q: spawnQ, starting_r: spawnR })
          .eq('user_id', userId)
        setEliminated(false)
      } else {
        // Add to starting tile
        const newCount = (existing?.troop_count || 0) + count
        await supabase.from('war_tiles').upsert(
          { q: sq, r: sr, owner_id: userId, owner_name: warPlayer.display_name, color: warPlayer.color, troop_count: newCount },
          { onConflict: 'q,r' }
        )
      }
      setShowBuyModal(false)
      showFlash(`+${count} troops purchased!`)
    } catch (err) {
      console.error('Buy troops failed:', err)
    } finally {
      setActionLoading(false)
    }
  }, [warPlayer, balance, userId, tiles, eliminated, actionLoading])

  // ── Move/Attack handler ────────────────────────────────────────────────────
  const handleMove = useCallback(async (troopCount) => {
    if (!moveModal || actionLoading) return
    setActionLoading(true)
    const { fromTile, toCoord } = moveModal
    try {
      const arrivesAt = new Date(Date.now() + MOVE_SECONDS * 1000).toISOString()

      // Deduct troops from source immediately
      const newFrom = fromTile.troop_count - troopCount
      await supabase.from('war_tiles')
        .update({ troop_count: newFrom })
        .eq('q', fromTile.q).eq('r', fromTile.r)

      // Insert movement
      await supabase.from('war_movements').insert({
        player_id:   userId,
        from_q:      fromTile.q,
        from_r:      fromTile.r,
        to_q:        toCoord.q,
        to_r:        toCoord.r,
        troop_count: troopCount,
        arrives_at:  arrivesAt,
      })

      setMoveModal(null)
      setSelectedTile(null)
      showFlash(`${troopCount} troops sent — arrives in ${MOVE_SECONDS}s`)
    } catch (err) {
      console.error('Move failed:', err)
    } finally {
      setActionLoading(false)
    }
  }, [moveModal, userId, actionLoading])

  // ── Derived: tile count per player for leaderboard ─────────────────────────
  const leaderboard = allPlayers
    .map(p => ({
      ...p,
      tileCount:  Object.values(tiles).filter(t => t.owner_id === p.user_id).length,
      troopTotal: Object.values(tiles).filter(t => t.owner_id === p.user_id).reduce((s, t) => s + t.troop_count, 0),
    }))
    .sort((a, b) => b.tileCount - a.tileCount)
    .slice(0, 8)

  // ─────────────────────────────────────────────────────────────────────────────
  if (initializing) return (
    <div className="min-h-screen bg-cp-bg flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-2 border-red-400 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-cp-muted text-sm">Loading war map…</p>
      </div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-cp-bg flex items-center justify-center p-6">
      <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-2xl px-6 py-4">{error}</div>
    </div>
  )

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-64px)] overflow-hidden bg-[#0a0a0a]">

      {/* ── Modals ── */}
      {showBuyModal && (
        <BuyTroopsModal
          balance={balance}
          loading={actionLoading}
          onConfirm={handleBuyTroops}
          onClose={() => setShowBuyModal(false)}
        />
      )}
      {moveModal && (
        <MoveTroopsModal
          fromTile={moveModal.fromTile}
          toTile={moveModal.toTile}
          isAttack={moveModal.isAttack}
          loading={actionLoading}
          onConfirm={handleMove}
          onClose={() => { setMoveModal(null); setSelectedTile(null) }}
        />
      )}

      {/* ── Flash message ── */}
      {flashMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-cp-card border border-cp-border rounded-2xl text-sm font-medium text-cp-text shadow-xl pointer-events-none"
          style={{ animation: 'fadeInDown 0.25s ease' }}>
          {flashMsg}
        </div>
      )}

      {/* ── Eliminated banner ── */}
      {eliminated && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 max-w-sm w-full mx-4 px-5 py-4 bg-red-900/80 border border-red-500/40 rounded-2xl text-center shadow-2xl backdrop-blur-sm">
          <p className="text-white font-semibold text-sm mb-1">💀 You have been eliminated!</p>
          <p className="text-red-200/80 text-xs mb-3">Buy troops to respawn on a new tile.</p>
          <button onClick={() => setShowBuyModal(true)} className="px-4 py-2 bg-red-500 hover:bg-red-400 text-white text-xs font-semibold rounded-xl transition-colors">
            Buy Troops to Respawn
          </button>
        </div>
      )}

      {/* ── Map canvas ── */}
      <div className="relative flex-1 overflow-hidden cursor-grab active:cursor-grabbing select-none">
        <canvas
          ref={canvasRef}
          width={window.innerWidth}
          height={window.innerHeight - 64}
          className="w-full h-full"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        />

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute pointer-events-none z-10 bg-cp-card border border-cp-border rounded-xl px-3 py-2 text-xs shadow-xl"
            style={{ left: tooltip.x + 14, top: tooltip.y - 10, maxWidth: 160 }}
          >
            {tooltip.tile ? (
              <>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: tooltip.tile.color }} />
                  <span className="font-medium text-cp-text truncate">{tooltip.tile.owner_name}</span>
                </div>
                <span className="text-cp-muted">{tooltip.tile.troop_count.toLocaleString()} troops</span>
              </>
            ) : (
              <span className="text-cp-muted">Unclaimed ({tooltip.q},{tooltip.r})</span>
            )}
          </div>
        )}

        {/* Zoom controls */}
        <div className="absolute bottom-4 right-4 flex flex-col gap-1">
          {[['＋', 1.2], ['－', 0.8]].map(([label, factor]) => (
            <button key={label}
              onClick={() => { scaleRef.current = Math.min(2.5, Math.max(0.3, scaleRef.current * factor)) }}
              className="w-8 h-8 bg-cp-card border border-cp-border rounded-lg text-cp-muted hover:text-cp-text flex items-center justify-center text-sm font-bold transition-colors"
            >{label}</button>
          ))}
        </div>
      </div>

      {/* ── Sidebar ── */}
      <aside className="w-full lg:w-72 flex-shrink-0 bg-cp-card border-t lg:border-t-0 lg:border-l border-cp-border overflow-y-auto">
        <div className="p-4 space-y-4">

          {/* Header */}
          <div className="flex items-center gap-2 pt-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-red-400">
              <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/>
            </svg>
            <h1 className="font-display text-lg text-cp-text">CP War</h1>
          </div>

          {/* My stats */}
          {warPlayer && (
            <div className="bg-cp-elevated border border-cp-border rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: warPlayer.color }} />
                <span className="text-cp-text text-sm font-semibold truncate">{warPlayer.display_name}</span>
                {eliminated && <span className="text-[10px] text-red-400 bg-red-500/15 border border-red-500/25 px-1.5 py-0.5 rounded-full">Eliminated</span>}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-cp-card rounded-xl p-2.5">
                  <p className="text-cp-muted mb-0.5">Tiles</p>
                  <p className="text-cp-text font-bold text-base">{myTiles.length}</p>
                </div>
                <div className="bg-cp-card rounded-xl p-2.5">
                  <p className="text-cp-muted mb-0.5">Troops</p>
                  <p className="text-cp-text font-bold text-base">{myTroops.toLocaleString()}</p>
                </div>
                <div className="bg-cp-card rounded-xl p-2.5 col-span-2">
                  <p className="text-cp-muted mb-0.5">Coins</p>
                  <p className="text-amber-400 font-bold">{(balance ?? 0).toLocaleString()}</p>
                </div>
              </div>
              <button
                onClick={() => setShowBuyModal(true)}
                className="w-full py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 hover:border-red-500/50 text-sm font-semibold transition-all"
              >
                Buy Troops — 500 coins each
              </button>
            </div>
          )}

          {/* Leaderboard */}
          <div>
            <p className="text-xs text-cp-muted uppercase tracking-wider mb-2">Leaderboard</p>
            <div className="space-y-1.5">
              {leaderboard.map((p, i) => (
                <div key={p.user_id} className="flex items-center gap-2 px-3 py-2 bg-cp-elevated rounded-xl">
                  <span className="text-xs text-cp-muted/60 w-4 text-right">{i + 1}</span>
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
                  <span className="flex-1 text-xs text-cp-text truncate">{p.display_name}</span>
                  <span className="text-xs text-cp-muted">{p.tileCount} tiles</span>
                </div>
              ))}
            </div>
          </div>

          {/* Instructions */}
          <div className="bg-cp-elevated border border-cp-border rounded-2xl p-4 space-y-2">
            <p className="text-xs font-semibold text-cp-muted uppercase tracking-wider">How to Play</p>
            <div className="space-y-1.5 text-xs text-cp-muted leading-relaxed">
              <p>🖱 <b className="text-cp-text/70">Click</b> one of your tiles to select it</p>
              <p>🎯 Click an adjacent tile to move or attack</p>
              <p>⚔️ Combat resolves after <b className="text-cp-text/70">30 seconds</b></p>
              <p>💰 Kill troops and earn <b className="text-cp-text/70">500 coins each</b></p>
              <p>🔍 Scroll to zoom · drag to pan</p>
              <p>💀 Lose all tiles → eliminated · buy troops to respawn</p>
            </div>
          </div>

        </div>
      </aside>

      <style>{`
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  )
}
