import { useState, useRef, useEffect, useCallback } from 'react'
import { GameLayout, BetChips, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'

// ─── Multiplier tables (Stake-accurate) ───────────────────────────────────────
const MULT_TABLE = {
  8: {
    low:    [5.6, 2.1, 1.1, 1.0, 0.5, 1.0, 1.1, 2.1, 5.6],
    medium: [13,   3,  1.3, 0.7, 0.4, 0.7, 1.3,  3,  13 ],
    high:   [29,   4,  1.5, 0.3, 0.2, 0.3, 1.5,  4,  29 ],
  },
  12: {
    low:    [8.9,  3,  1.4, 1.1, 1.0, 0.5, 0.2, 0.5, 1.0, 1.1, 1.4,  3, 8.9],
    medium: [33,  11,   4,   2,  1.1, 0.6, 0.3, 0.6, 1.1,  2,   4,  11,  33],
    high:   [170, 24,   8,   2,  0.7, 0.2, 0.2, 0.2, 0.7,  2,   8,  24, 170],
  },
  16: {
    low:    [16,   9,   2,  1.4, 1.4, 1.2, 1.1, 1.0, 0.5, 1.0, 1.1, 1.2, 1.4, 1.4,  2,   9,  16],
    medium: [110,  41,  10,   5,   3, 1.5, 1.0, 0.5, 0.3, 0.5, 1.0, 1.5,   3,   5,  10,  41, 110],
    high:   [1000, 130, 26,   9,   4,   2, 0.2, 0.2, 0.2, 0.2, 0.2,   2,   4,   9,  26, 130, 1000],
  },
}

// ─── Slot color ────────────────────────────────────────────────────────────────
function slotColor(m) {
  if (m >= 100) return { bg: '#7c3aed', border: '#a78bfa', text: '#fff', glow: 'rgba(124,58,237,0.85)' }
  if (m >= 29)  return { bg: '#be185d', border: '#f472b6', text: '#fff', glow: 'rgba(190,24,93,0.75)'  }
  if (m >= 10)  return { bg: '#dc2626', border: '#f87171', text: '#fff', glow: 'rgba(220,38,38,0.75)'  }
  if (m >= 5)   return { bg: '#d97706', border: '#fbbf24', text: '#000', glow: 'rgba(217,119,6,0.75)'  }
  if (m >= 2)   return { bg: '#059669', border: '#34d399', text: '#fff', glow: 'rgba(5,150,105,0.7)'   }
  if (m >= 1)   return { bg: '#2563eb', border: '#60a5fa', text: '#fff', glow: 'rgba(37,99,235,0.65)'  }
  if (m >= 0.4) return { bg: '#6d28d9', border: '#a78bfa', text: '#fff', glow: 'rgba(109,40,217,0.6)'  }
  return             { bg: '#b91c1c', border: '#f87171', text: '#fff', glow: 'rgba(185,28,28,0.6)'     }
}

// ─── Board geometry (derived from row count) ───────────────────────────────────
const CW = 480

function makeGeom(rows) {
  const TOP    = 54
  const ROW_H  = rows <= 8 ? 40 : rows <= 12 ? 35 : 29
  const PEG_R  = rows <= 8 ? 5.5 : rows <= 12 ? 4.5 : 3.5
  const BALL_R = PEG_R * 1.75
  const SLOTS  = rows + 1
  const SLOT_W = CW / SLOTS
  const SLOT_Y = TOP + rows * ROW_H + 14
  const SLOT_H = 44
  const CH     = SLOT_Y + SLOT_H + 14

  const pegX   = (r, c) => CW * (c + 1) / (r + 2)
  const pegY   = (r)    => TOP + r * ROW_H
  const slotCX = (s)    => (s + 0.5) * SLOT_W

  const pegs = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c <= r; c++)
      pegs.push({ r, c, x: pegX(r, c), y: pegY(r) })

  return { TOP, ROW_H, PEG_R, BALL_R, SLOTS, SLOT_W, SLOT_Y, SLOT_H, CH, pegX, pegY, slotCX, pegs }
}

// ─── Build ball waypoints from decisions ───────────────────────────────────────
function buildPath(rows, decisions, geom) {
  const { TOP, BALL_R, pegX, pegY, slotCX, SLOT_Y, SLOT_H } = geom
  const pts = [{ x: CW / 2, y: TOP - BALL_R - 2 }]
  let col = 0
  for (let r = 0; r < rows; r++) {
    pts.push({ x: pegX(r, col), y: pegY(r) })
    if (decisions[r]) col++
  }
  pts.push({ x: slotCX(col), y: SLOT_Y + SLOT_H / 2 })
  return { pts, slot: col }
}

// ─── Quadratic bezier point ────────────────────────────────────────────────────
function qBez(t, p0, cp, p1) {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * cp.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * cp.y + t * t * p1.y,
  }
}

// ─── Rounded rect helper (Safari <15.4 compat) ────────────────────────────────
function rrect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r)
  } else {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y,     x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x,     y + h, r)
    ctx.arcTo(x,     y + h, x,     y,     r)
    ctx.arcTo(x,     y,     x + w, y,     r)
    ctx.closePath()
  }
}

// ─── Draw the full board onto the canvas ──────────────────────────────────────
function drawScene(canvas, mults, geom, ballX, ballY, litSlot) {
  const dpr = window.devicePixelRatio || 1
  const ctx = canvas.getContext('2d')
  const { CH, pegs, SLOT_W, SLOT_Y, SLOT_H, PEG_R, BALL_R, slotCX } = geom

  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, CW, CH)

  // ── Background gradient ──
  const bgG = ctx.createLinearGradient(0, 0, 0, CH)
  bgG.addColorStop(0, '#0f172a')
  bgG.addColorStop(1, '#1e1b4b')
  rrect(ctx, 0, 0, CW, CH, 16)
  ctx.fillStyle = bgG
  ctx.fill()

  // ── Drop indicator arrow ──
  ctx.fillStyle = 'rgba(251,191,36,0.18)'
  ctx.beginPath()
  ctx.moveTo(CW / 2 - 9, 10)
  ctx.lineTo(CW / 2 + 9, 10)
  ctx.lineTo(CW / 2,     24)
  ctx.closePath()
  ctx.fill()

  // ── Slots ──
  mults.forEach((m, i) => {
    const { bg, border, text, glow } = slotColor(m)
    const x   = i * SLOT_W + 2
    const y   = SLOT_Y
    const w   = SLOT_W - 4
    const h   = SLOT_H
    const lit = litSlot === i

    ctx.save()
    if (lit) { ctx.shadowBlur = 24; ctx.shadowColor = glow }
    ctx.fillStyle = lit ? bg : bg + '28'
    rrect(ctx, x, y, w, h, 5)
    ctx.fill()
    if (lit) {
      ctx.strokeStyle = border
      ctx.lineWidth   = 2
      rrect(ctx, x, y, w, h, 5)
      ctx.stroke()
    }
    ctx.shadowBlur = 0

    const fontSize = m >= 100 ? 9 : m >= 10 ? 10 : 11
    ctx.fillStyle     = lit ? text : bg + 'bb'
    ctx.font          = `bold ${fontSize}px system-ui, -apple-system, sans-serif`
    ctx.textAlign     = 'center'
    ctx.textBaseline  = 'middle'
    ctx.fillText(`${m}×`, x + w / 2, y + h / 2)
    ctx.restore()
  })

  // ── Pegs ──
  pegs.forEach(({ x, y }) => {
    const dist = ballX != null ? Math.hypot(x - ballX, y - ballY) : Infinity
    const gf   = Math.max(0, 1 - dist / 28)

    ctx.save()
    if (gf > 0.05) {
      ctx.shadowBlur  = 12 * gf
      ctx.shadowColor = `rgba(255,255,255,${0.65 * gf})`
    }
    ctx.beginPath()
    ctx.arc(x, y, PEG_R, 0, Math.PI * 2)
    ctx.fillStyle = gf > 0.35 ? '#e2e8f0' : '#4a5568'
    ctx.fill()
    ctx.restore()
  })

  // ── Ball ──
  if (ballX != null) {
    ctx.save()
    ctx.shadowBlur  = 22
    ctx.shadowColor = 'rgba(251,191,36,0.85)'
    const gr = ctx.createRadialGradient(
      ballX - BALL_R * 0.3, ballY - BALL_R * 0.3, BALL_R * 0.05,
      ballX, ballY, BALL_R
    )
    gr.addColorStop(0,   '#fef9c3')
    gr.addColorStop(0.4, '#fbbf24')
    gr.addColorStop(1,   '#b45309')
    ctx.beginPath()
    ctx.arc(ballX, ballY, BALL_R, 0, Math.PI * 2)
    ctx.fillStyle = gr
    ctx.fill()
    ctx.restore()
  }

  ctx.restore()
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PlinkoGame() {
  const { balance, placeBet } = useCasino()

  const [bet,     setBet]     = useState(50)
  const [rows,    setRows]    = useState(8)
  const [risk,    setRisk]    = useState('medium')
  const [phase,   setPhase]   = useState('idle')   // idle | dropping | done
  const [litSlot, setLitSlot] = useState(null)
  const [result,  setResult]  = useState(null)

  const canvasRef = useRef(null)
  const rafRef    = useRef(null)

  // ── Resize canvas + redraw idle/done state ────────────────────────────────
  useEffect(() => {
    if (phase === 'dropping') return
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr   = window.devicePixelRatio || 1
    const g     = makeGeom(rows)
    const mults = MULT_TABLE[rows][risk]
    canvas.width        = Math.round(CW * dpr)
    canvas.height       = Math.round(g.CH * dpr)
    canvas.style.width  = `${CW}px`
    canvas.style.height = `${g.CH}px`
    drawScene(canvas, mults, g, null, null, litSlot)
  }, [rows, risk, phase, litSlot])

  // ── Cancel RAF on unmount ─────────────────────────────────────────────────
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  // ── Drop ──────────────────────────────────────────────────────────────────
  const drop = useCallback(async () => {
    if (phase === 'dropping' || balance === null || bet < 1 || bet > balance) return

    setPhase('dropping')
    setResult(null)
    setLitSlot(null)

    const g      = makeGeom(rows)
    const mults  = MULT_TABLE[rows][risk]
    const dpr    = window.devicePixelRatio || 1
    const canvas = canvasRef.current
    if (!canvas) return

    canvas.width        = Math.round(CW * dpr)
    canvas.height       = Math.round(g.CH * dpr)
    canvas.style.width  = `${CW}px`
    canvas.style.height = `${g.CH}px`

    // Decide the path
    const decisions = Array.from({ length: rows }, () => +(Math.random() < 0.5))
    const { pts, slot } = buildPath(rows, decisions, g)
    const mult      = mults[slot]
    const payout    = Math.floor(bet * mult)
    const winAmount = payout - bet

    // Build bezier arc segments
    // Control point is directly below p0 (halfway down), creating a
    // "fall straight then curve sideways" motion that looks like a peg bounce
    const segs = pts.slice(0, -1).map((p0, i) => {
      const p1 = pts[i + 1]
      return {
        p0,
        p1,
        cp: {
          x: p0.x,
          y: p0.y + (p1.y - p0.y) * 0.45,
        },
      }
    })

    // Speed: slightly faster per-segment on more rows (momentum builds up)
    const MS_PER_SEG = rows <= 8 ? 260 : rows <= 12 ? 230 : 200

    let segIdx   = 0
    let segStart = null

    function frame(ts) {
      if (segStart === null) segStart = ts

      const rawT = Math.min(1, (ts - segStart) / MS_PER_SEG)
      const et   = rawT * rawT   // ease-in = gravity effect

      const { p0, cp, p1 } = segs[segIdx]
      const { x: bx, y: by } = qBez(et, p0, cp, p1)

      drawScene(canvas, mults, g, bx, by, null)

      if (rawT >= 1) {
        segIdx++
        segStart = null
        if (segIdx >= segs.length) {
          // Animation finished → light the slot, settle the bet
          drawScene(canvas, mults, g, null, null, slot)
          setLitSlot(slot)
          placeBet('plinko', bet, winAmount).then(() => {
            setResult({ slot, mult, winAmount })
            setPhase('done')
          })
          return
        }
      }

      rafRef.current = requestAnimationFrame(frame)
    }

    rafRef.current = requestAnimationFrame(frame)
  }, [phase, balance, bet, rows, risk, placeBet])

  // ── Reset ─────────────────────────────────────────────────────────────────
  function handleReset() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setPhase('idle')
    setResult(null)
    setLitSlot(null)
  }

  const isDropping = phase === 'dropping'

  return (
    <GameLayout title="Plinko">
      <div className="flex flex-col items-center gap-5">

        {/* ── Canvas board ── */}
        <div className="w-full flex justify-center overflow-x-auto">
          <canvas
            ref={canvasRef}
            style={{ borderRadius: 16, display: 'block', maxWidth: '100%' }}
          />
        </div>

        {/* ── Risk + Rows selectors ── */}
        <div className="w-full max-w-sm bg-cp-card border border-cp-border rounded-2xl p-4 space-y-4">

          {/* Risk */}
          <div>
            <label className="block text-xs font-semibold text-cp-muted uppercase tracking-wider mb-2">
              Risk
            </label>
            <div className="grid grid-cols-3 gap-2">
              {['low', 'medium', 'high'].map(r => (
                <button
                  key={r}
                  onClick={() => !isDropping && setRisk(r)}
                  disabled={isDropping}
                  className={`py-2 rounded-xl text-sm font-semibold border capitalize transition-all
                    ${risk === r
                      ? 'bg-amber-400 border-amber-400 text-black'
                      : 'bg-cp-elevated border-cp-border text-cp-muted hover:border-amber-400/40 hover:text-cp-text'
                    }
                    ${isDropping ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Rows */}
          <div>
            <label className="block text-xs font-semibold text-cp-muted uppercase tracking-wider mb-2">
              Rows
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[8, 12, 16].map(r => (
                <button
                  key={r}
                  onClick={() => !isDropping && setRows(r)}
                  disabled={isDropping}
                  className={`py-2 rounded-xl text-sm font-semibold border transition-all
                    ${rows === r
                      ? 'bg-amber-400 border-amber-400 text-black'
                      : 'bg-cp-elevated border-cp-border text-cp-muted hover:border-amber-400/40 hover:text-cp-text'
                    }
                    ${isDropping ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Result banner ── */}
        {result && (
          <div
            className={`w-full max-w-sm rounded-2xl border px-5 py-4 text-center
              ${result.winAmount > 0
                ? 'bg-emerald-400/10 border-emerald-400/25'
                : 'bg-red-400/10 border-red-400/25'
              }`}
            style={{ animation: 'fadeInPlinko 0.3s ease forwards' }}
          >
            <p
              className="text-2xl font-extrabold mb-1"
              style={{ color: slotColor(result.mult).bg }}
            >
              {result.mult}×
            </p>
            <p className={`text-lg font-bold ${result.winAmount > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {result.winAmount > 0
                ? `+${formatCoins(result.winAmount)} coins 🎉`
                : `-${formatCoins(Math.abs(result.winAmount))} coins`
              }
            </p>
            <style>{`
              @keyframes fadeInPlinko {
                from { opacity: 0; transform: translateY(8px); }
                to   { opacity: 1; transform: translateY(0); }
              }
            `}</style>
          </div>
        )}

        {/* ── Bet controls ── */}
        <div className="w-full max-w-sm bg-cp-card border border-cp-border rounded-2xl p-4">
          <BetChips
            bet={bet}
            onBet={setBet}
            balance={balance ?? 0}
            disabled={isDropping}
          />
        </div>

        {/* ── Action button ── */}
        {phase !== 'done' ? (
          <button
            onClick={drop}
            disabled={isDropping || !bet || (balance ?? 0) < bet}
            className={`w-full max-w-sm py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
              ${isDropping || !bet || (balance ?? 0) < bet
                ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                : 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_24px_rgba(251,191,36,0.3)] active:scale-95'
              }
            `}
          >
            {isDropping ? 'Dropping…' : '⬇  Drop Ball'}
          </button>
        ) : (
          <button
            onClick={handleReset}
            className="w-full max-w-sm py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95"
          >
            Drop Again
          </button>
        )}

      </div>
    </GameLayout>
  )
}
