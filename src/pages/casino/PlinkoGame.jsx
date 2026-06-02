import { useState, useRef, useEffect, useCallback } from 'react'
import { GameLayout, BetChips } from './shared'
import { useCasino } from '../../context/CasinoContext'
import { CW, makeGeom, buildPath, segPos } from './plinkoGeom'

// ─── Multiplier tables (Stake-accurate) ──────────────────────────────────────
const MULT_TABLE = {
  8: {
    low:    [5.6, 2.1, 1.1, 1.0, 0.5, 1.0, 1.1, 2.1, 5.6],
    medium: [13,   3,  1.3, 0.7, 0.4, 0.7, 1.3,  3,  13 ],
    high:   [29,   4,  1.5, 0.3, 0.2, 0.3, 1.5,  4,  29 ],
  },
  12: {
    low:    [10,   3,  1.6, 1.4, 1.1, 1.0, 0.5, 1.0, 1.1, 1.4, 1.6,  3,  10],
    medium: [33,  11,   4,   2,  1.1, 0.6, 0.3, 0.6, 1.1,  2,   4,  11,  33],
    high:   [170, 24,   8,   2,  0.7, 0.2, 0.2, 0.2, 0.7,  2,   8,  24, 170],
  },
  16: {
    low:    [16,   9,   2,  1.4, 1.4, 1.2, 1.1, 1.0, 0.5, 1.0, 1.1, 1.2, 1.4, 1.4,  2,   9,  16],
    medium: [110,  41,  10,   5,   3, 1.5, 1.0, 0.5, 0.3, 0.5, 1.0, 1.5,   3,   5,  10,  41, 110],
    high:   [1000, 130, 26,   9,   4,   2, 0.2, 0.2, 0.2, 0.2, 0.2,   2,   4,   9,  26, 130, 1000],
  },
}

// ─── Ball color palette ───────────────────────────────────────────────────────
const BALL_COLORS = [
  '#facc15', '#f97316', '#a78bfa', '#34d399',
  '#60a5fa', '#f472b6', '#fb923c', '#4ade80',
]

const FLASH_MS = 800

// ─── Slot tint: green for ≥1× (profit/push), red for <1× (loss) ──────────────
function slotTint(m) {
  return m >= 1
    ? [34,  197, 94]   // green-500
    : [239, 68,  68]   // red-500
}

// Board geometry, path building, and segment interpolation live in ./plinkoGeom
// (pure + unit-tested). This file owns only the canvas rendering + React glue.

// ─── Rounded rect (Safari compat) ────────────────────────────────────────────
// Always begins a fresh path so fill and stroke calls never share stale state.
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r)
  } else {
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y,     x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x,     y + h, r)
    ctx.arcTo(x,     y + h, x,     y,     r)
    ctx.arcTo(x,     y,     x + w, y,     r)
    ctx.closePath()
  }
}

// ─── Draw scene ───────────────────────────────────────────────────────────────
// balls: array of { x, y, trail, color } — x/y null when not yet/no longer visible
// litSlots: { [slotIdx]: landingTimestamp }
// pegHits: { "x_y": strikeTimestamp } — drives the per-peg strike "pop"
// now: current RAF timestamp (for flash/pop fade calculation)
function drawScene(canvas, mults, geom, balls, litSlots, pegHits, now) {
  const dpr = window.devicePixelRatio || 1
  const ctx = canvas.getContext('2d')
  const { CH, pegs, SLOT_W, SLOT_Y, SLOT_H, PEG_R, BALL_R, slotCX } = geom

  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, CW, CH)

  // ── Background ──
  ctx.fillStyle = '#151515'
  rrect(ctx, 0, 0, CW, CH, 16)
  ctx.fill()

  // ── Drop indicator ──
  ctx.fillStyle = 'rgba(251,191,36,0.18)'
  ctx.beginPath()
  ctx.moveTo(CW / 2 - 9, 10)
  ctx.lineTo(CW / 2 + 9, 10)
  ctx.lineTo(CW / 2,     24)
  ctx.closePath()
  ctx.fill()

  // ── Slots ──
  mults.forEach((m, i) => {
    const [tR, tG, tB] = slotTint(m)
    const w        = SLOT_W - 3
    const x        = slotCX(i) - w / 2
    const y        = SLOT_Y
    const h        = SLOT_H
    const flashTs  = litSlots[i]
    const flashAge = flashTs != null ? (now - flashTs) : Infinity
    const lit      = flashAge < FLASH_MS
    const ff       = lit ? Math.max(0, 1 - flashAge / FLASH_MS) : 0

    ctx.save()

    // ── Dark base ──
    ctx.fillStyle = '#1f1f1f'
    rrect(ctx, x, y, w, h, 6)
    ctx.fill()

    // ── Colored flash overlay (fades in on landing, fades out over FLASH_MS) ──
    if (ff > 0) {
      ctx.save()
      ctx.shadowBlur  = 20 * ff
      ctx.shadowColor = `rgba(${tR},${tG},${tB},${0.85 * ff})`
      ctx.globalAlpha = ff * 0.38
      ctx.fillStyle   = `rgb(${tR},${tG},${tB})`
      rrect(ctx, x, y, w, h, 6)
      ctx.fill()
      ctx.restore()
    }

    // ── Tinted border: subtle always, bright on flash ──
    ctx.strokeStyle = ff > 0
      ? `rgba(${tR},${tG},${tB},${Math.min(0.9, 0.2 + 0.7 * ff)})`
      : `rgba(${tR},${tG},${tB},0.18)`
    ctx.lineWidth = 1
    rrect(ctx, x, y, w, h, 6)
    ctx.stroke()

    // ── Text: white, bold, always fully opaque ──
    const label    = m >= 1000 ? `${Math.round(m / 1000)}K×` : `${m}×`
    const fontSize = m >= 100 ? 9 : m >= 10 ? 10 : 11
    ctx.fillStyle    = '#ffffff'
    ctx.font         = `bold ${fontSize}px system-ui, -apple-system, sans-serif`
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + w / 2, y + h / 2)

    ctx.restore()
  })

  // ── Ball trails ──
  balls.forEach(ball => {
    if (!ball.trail || ball.trail.length < 2) return
    ball.trail.forEach(({ x: tx, y: ty }, i) => {
      ctx.save()
      ctx.globalAlpha = ((i + 1) / ball.trail.length) * 0.25
      ctx.beginPath()
      ctx.arc(tx, ty, BALL_R * 0.62, 0, Math.PI * 2)
      ctx.fillStyle = ball.color
      ctx.fill()
      ctx.restore()
    })
  })

  // ── Pegs (proximity glow + strike-pop ring) ──
  const POP_MS = 260
  pegs.forEach(({ x, y }) => {
    let minDist = Infinity
    balls.forEach(b => {
      if (b.x != null) {
        const d = Math.hypot(x - b.x, y - b.y)
        if (d < minDist) minDist = d
      }
    })
    const gf    = minDist < 50 ? Math.max(0, 1 - minDist / 28) : 0
    const hitTs = pegHits[`${Math.round(x)}_${Math.round(y)}`]
    const pop   = hitTs != null ? Math.max(0, 1 - (now - hitTs) / POP_MS) : 0
    const glow  = Math.max(gf, pop)
    const r     = PEG_R * (1 + 0.55 * pop)

    // expanding shock ring at the moment of a strike
    if (pop > 0.02) {
      ctx.save()
      ctx.globalAlpha = pop * 0.5
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth   = 1.5
      ctx.beginPath()
      ctx.arc(x, y, PEG_R + (1 - pop) * PEG_R * 3, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    ctx.save()
    ctx.shadowBlur  = glow > 0.05 ? 16 * glow : 3
    ctx.shadowColor = glow > 0.05
      ? `rgba(255,255,255,${0.85 * glow})`
      : 'rgba(255,255,255,0.12)'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = glow > 0.3 ? '#ffffff' : 'rgba(255,255,255,0.82)'
    ctx.fill()
    ctx.restore()
  })

  // ── Balls ──
  balls.forEach(ball => {
    if (ball.x == null) return
    ctx.save()
    ctx.shadowBlur  = 20
    ctx.shadowColor = ball.color
    const gr = ctx.createRadialGradient(
      ball.x - BALL_R * 0.28, ball.y - BALL_R * 0.28, BALL_R * 0.05,
      ball.x, ball.y, BALL_R,
    )
    gr.addColorStop(0,    '#ffffff')
    gr.addColorStop(0.35, ball.color)
    gr.addColorStop(1,    ball.color + '80')
    ctx.beginPath()
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2)
    ctx.fillStyle = gr
    ctx.fill()
    ctx.restore()
  })

  ctx.restore()
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PlinkoGame() {
  const { balance, placeBet, adjustBalance } = useCasino()

  const [bet,           setBet]           = useState(50)
  const [rows,          setRows]          = useState(8)
  const [risk,          setRisk]          = useState('medium')
  const [autoActive,    setAutoActive]    = useState(false)
  const [recentResults, setRecentResults] = useState([])
  const [ballsActive,   setBallsActive]   = useState(false)
  const [inFlight,      setInFlight]      = useState(0)   // reactive mirror of inFlightRef

  const canvasRef       = useRef(null)
  const rafRef          = useRef(null)
  const autoRef         = useRef(null)
  const loopUntilRef    = useRef(0)        // keep RAF alive until this ts for slot fade
  const ballsRef        = useRef([])        // active ball objects
  const litSlotsRef     = useRef({})        // { slotIdx: landingTimestamp }
  const pegHitsRef      = useRef({})        // { "x_y": strikeTimestamp } for strike pops
  const ballIdRef       = useRef(0)
  const inFlightRef     = useRef(0)         // sum of bet amounts currently animating
  const balanceRef      = useRef(balance)
  const adjustBalanceRef = useRef(adjustBalance)
  adjustBalanceRef.current = adjustBalance
  const betRef       = useRef(bet)
  const geomRef      = useRef(makeGeom(8))
  const multsRef     = useRef(MULT_TABLE[8]['medium'])
  const rowsRef      = useRef(8)
  const riskRef      = useRef('medium')

  // Keep refs in sync with state/props
  useEffect(() => { balanceRef.current = balance }, [balance])
  useEffect(() => { betRef.current  = bet  }, [bet])
  useEffect(() => { rowsRef.current = rows }, [rows])
  useEffect(() => { riskRef.current = risk }, [risk])

  // ── Setup canvas size + initial draw on rows/risk change ─────────────────
  useEffect(() => {
    geomRef.current  = makeGeom(rows)
    multsRef.current = MULT_TABLE[rows][risk]

    // Don't resize while balls are in flight — let the active animation finish
    if (ballsRef.current.length > 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const g   = geomRef.current
    canvas.width        = Math.round(CW * dpr)
    canvas.height       = Math.round(g.CH * dpr)
    canvas.style.width  = `${CW}px`
    canvas.style.height = `${g.CH}px`
    drawScene(canvas, multsRef.current, g, [], litSlotsRef.current, {}, performance.now())
  }, [rows, risk])

  // ── RAF loop ──────────────────────────────────────────────────────────────
  const startLoop = useCallback(() => {
    if (rafRef.current) return  // already running

    function frame(ts) {
      const canvas = canvasRef.current
      if (!canvas) { rafRef.current = null; return }

      const balls    = ballsRef.current
      const g        = geomRef.current
      const mults    = multsRef.current
      const finished = []

      balls.forEach(ball => {
        if (ball.done) return
        if (ball.segStart === null) ball.segStart = ts

        const rawT   = Math.min(1, (ts - ball.segStart) / ball.msPerSeg)
        const a      = ball.pts[ball.segIdx]
        const b      = ball.pts[ball.segIdx + 1]
        const bounce = ball.segIdx === 0 ? 0 : ball.bounce   // entry drop has no bounce
        const pos    = segPos(a, b, rawT, bounce)
        ball.x = pos.x
        ball.y = pos.y

        ball.trail.push({ x: pos.x, y: pos.y })
        if (ball.trail.length > 6) ball.trail.shift()

        if (rawT >= 1) {
          ball.segIdx++
          ball.segStart = null
          // Arriving at a peg contact (pts[1..rows]) → pop that peg.
          if (ball.segIdx >= 1 && ball.segIdx <= ball.rows) {
            pegHitsRef.current[`${Math.round(b.x)}_${Math.round(b.y + ball.pegOffset)}`] = ts
          }
          if (ball.segIdx >= ball.pts.length - 1) {
            ball.done = true
            ball.x    = null
            // Merge new flash into litSlots (spread preserves earlier unrelated flashes)
            litSlotsRef.current = { ...litSlotsRef.current, [ball.slot]: ts }
            finished.push(ball)
          }
        }
      })

      // prune expired strike pops
      const hits = pegHitsRef.current
      for (const k in hits) if (ts - hits[k] > 300) delete hits[k]

      // Remove landed balls and settle bets
      if (finished.length > 0) {
        ballsRef.current = ballsRef.current.filter(b => !b.done)
        loopUntilRef.current = ts + FLASH_MS  // extend loop to show slot fade

        finished.forEach(ball => {
          inFlightRef.current = Math.max(0, inFlightRef.current - ball.bet)
          setInFlight(inFlightRef.current)
          placeBet('plinko', ball.bet, ball.winAmount).then(() => {
            setRecentResults(prev => {
              const next = [{ mult: ball.mult, winAmount: ball.winAmount }, ...prev]
              return next.slice(0, 10)
            })
          })
        })

        if (ballsRef.current.length === 0) setBallsActive(false)
      }

      drawScene(canvas, mults, g, ballsRef.current, litSlotsRef.current, pegHitsRef.current, ts)

      if (ballsRef.current.length > 0 || ts < loopUntilRef.current) {
        rafRef.current = requestAnimationFrame(frame)
      } else {
        rafRef.current = null
      }
    }

    rafRef.current = requestAnimationFrame(frame)
  }, [placeBet])

  // ── Drop one ball ─────────────────────────────────────────────────────────
  const drop = useCallback(() => {
    const bal  = balanceRef.current
    const b    = betRef.current
    const r    = rowsRef.current
    const risk = riskRef.current

    // Guard: don't over-bet (account for coins already in-flight)
    const available = (bal ?? 0) - inFlightRef.current
    if (bal === null || b < 1 || b > available) return

    const g     = makeGeom(r)
    const mults = MULT_TABLE[r][risk]

    const decisions     = Array.from({ length: r }, () => +(Math.random() < 0.5))
    const { pts, slot } = buildPath(r, decisions, g)
    const mult          = mults[slot]
    const payout        = Math.floor(b * mult)
    const winAmount     = payout - b
    const msPerSeg      = r <= 8 ? 240 : r <= 12 ? 215 : 190

    const id    = ballIdRef.current++
    const color = BALL_COLORS[id % BALL_COLORS.length]

    inFlightRef.current += b
    setInFlight(inFlightRef.current)

    ballsRef.current.push({
      id, pts, slot, mult, winAmount, bet: b, color, msPerSeg,
      rows: r, bounce: g.ROW_H * 0.6, pegOffset: g.PEG_R + g.BALL_R + g.S * 0.04,
      segIdx: 0, segStart: null,
      x: null, y: null,
      trail: [], done: false,
    })

    // Size canvas on first ball of a new run (rows may have changed)
    if (ballsRef.current.length === 1) {
      const canvas = canvasRef.current
      if (canvas) {
        const dpr = window.devicePixelRatio || 1
        canvas.width        = Math.round(CW * dpr)
        canvas.height       = Math.round(g.CH * dpr)
        canvas.style.width  = `${CW}px`
        canvas.style.height = `${g.CH}px`
      }
      geomRef.current  = g
      multsRef.current = mults
    }

    setBallsActive(true)
    startLoop()
  }, [startLoop])

  // ── Auto bet toggle ───────────────────────────────────────────────────────
  const toggleAuto = useCallback(() => {
    if (autoActive) {
      clearInterval(autoRef.current)
      autoRef.current = null
      setAutoActive(false)
    } else {
      drop()
      autoRef.current = setInterval(() => {
        const bal       = balanceRef.current
        const b         = betRef.current
        const available = (bal ?? 0) - inFlightRef.current
        if (bal === null || b > available) {
          clearInterval(autoRef.current)
          autoRef.current = null
          setAutoActive(false)
          return
        }
        drop()
      }, 600)
      setAutoActive(true)
    }
  }, [autoActive, drop])

  // Stop auto when effective balance is exhausted
  useEffect(() => {
    if (autoActive && balance !== null && balance - inFlightRef.current < bet) {
      clearInterval(autoRef.current)
      autoRef.current = null
      setAutoActive(false)
    }
  }, [balance, bet, autoActive])

  // Cleanup on unmount: cancel animation + forfeit any bets still in flight.
  // Without this, navigating away mid-game is a free play (same exploit as Blackjack).
  useEffect(() => () => {
    if (rafRef.current)  cancelAnimationFrame(rafRef.current)
    if (autoRef.current) clearInterval(autoRef.current)
    if (inFlightRef.current > 0) adjustBalanceRef.current(-inFlightRef.current)
  }, [])

  const availableBalance = (balance ?? 0) - inFlight
  const canDrop = balance !== null && bet >= 1 && availableBalance >= bet

  return (
    <GameLayout title="Plinko" wide>
      <div className="flex flex-col lg:flex-row gap-5 items-start">

        {/* ── Left controls panel ── */}
        <div className="w-full lg:w-72 flex-shrink-0 space-y-4">

          {/* Bet chips */}
          <div className="bg-cp-card border border-cp-border rounded-2xl p-4">
            <BetChips bet={bet} onBet={setBet} balance={balance ?? 0} />
          </div>

          {/* Risk selector */}
          <div className="bg-cp-card border border-cp-border rounded-2xl p-4">
            <label className="block text-xs font-semibold text-cp-muted uppercase tracking-wider mb-2">Risk</label>
            <div className="grid grid-cols-3 gap-2">
              {['low', 'medium', 'high'].map(r => (
                <button
                  key={r}
                  onClick={() => !ballsActive && setRisk(r)}
                  disabled={ballsActive}
                  className={`py-2 rounded-xl text-sm font-semibold border capitalize transition-all
                    ${risk === r
                      ? 'bg-amber-400 border-amber-400 text-black'
                      : 'bg-cp-elevated border-cp-border text-cp-muted hover:border-amber-400/40 hover:text-cp-text'
                    }
                    ${ballsActive ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Row selector */}
          <div className="bg-cp-card border border-cp-border rounded-2xl p-4">
            <label className="block text-xs font-semibold text-cp-muted uppercase tracking-wider mb-2">Rows</label>
            <div className="grid grid-cols-3 gap-2">
              {[8, 12, 16].map(r => (
                <button
                  key={r}
                  onClick={() => !ballsActive && setRows(r)}
                  disabled={ballsActive}
                  className={`py-2 rounded-xl text-sm font-semibold border transition-all
                    ${rows === r
                      ? 'bg-amber-400 border-amber-400 text-black'
                      : 'bg-cp-elevated border-cp-border text-cp-muted hover:border-amber-400/40 hover:text-cp-text'
                    }
                    ${ballsActive ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Drop Ball */}
          <button
            onClick={drop}
            disabled={!canDrop}
            className={`w-full py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
              ${canDrop
                ? 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_24px_rgba(251,191,36,0.3)] active:scale-95'
                : 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
              }`}
          >
            ⬇  Drop Ball
          </button>

          {/* Auto Bet */}
          <button
            onClick={toggleAuto}
            disabled={!canDrop && !autoActive}
            className={`w-full py-3 rounded-2xl font-semibold text-sm border transition-all active:scale-95
              ${autoActive
                ? 'bg-red-500/20 border-red-500/40 text-red-400 hover:bg-red-500/30'
                : canDrop
                  ? 'bg-cp-elevated border-cp-border text-cp-muted hover:border-amber-400/40 hover:text-cp-text'
                  : 'bg-cp-elevated border-cp-border text-cp-muted opacity-50 cursor-not-allowed'
              }`}
          >
            {autoActive ? '⏹  Stop Auto' : '▶  Auto Bet'}
          </button>

        </div>

        {/* ── Right: canvas + recent results ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">

          <div className="overflow-x-auto">
            <canvas
              ref={canvasRef}
              style={{ borderRadius: 16, display: 'block' }}
            />
          </div>

          {/* Recent results pills */}
          {recentResults.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {recentResults.map((r, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border
                    ${r.winAmount > 0
                      ? 'bg-emerald-400/15 border-emerald-400/30 text-emerald-400'
                      : r.winAmount === 0
                        ? 'bg-blue-400/15 border-blue-400/30 text-blue-400'
                        : 'bg-red-400/15 border-red-400/30 text-red-400'
                    }`}
                >
                  {r.mult >= 1000 ? `${Math.round(r.mult / 1000)}K×` : `${r.mult}×`}
                </span>
              ))}
            </div>
          )}

        </div>
      </div>
    </GameLayout>
  )
}
