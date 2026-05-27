import { useState, useRef, useCallback, useEffect } from 'react'
import { GameLayout, BetChips, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'

// ── Board constants ───────────────────────────────────────────────────────────
const ROWS      = 8                       // 8 rows → 9 slots
const MULTS     = [10, 5, 2, 1.5, 0.5, 1.5, 2, 5, 10]
const BOARD_W   = 360                     // px
const TOP_PAD   = 44                      // px from top before first peg row
const ROW_H     = 38                      // px between peg rows
const PEG_R     = 5                       // peg radius px
const BALL_R    = 10                      // ball radius px
const SLOT_GAP  = 14                      // gap between last peg row and slots
const SLOT_H    = 44                      // slot box height px
const BOARD_H   = TOP_PAD + ROWS * ROW_H + SLOT_GAP + SLOT_H + 12
const SLOT_W    = BOARD_W / (ROWS + 1)    // 9 slots

// ── Geometry helpers ──────────────────────────────────────────────────────────
function pegX(row, col) { return BOARD_W * (col + 1) / (row + 2) }
function pegY(row)       { return TOP_PAD + row * ROW_H }
function slotCX(slot)    { return (slot + 0.5) * SLOT_W }
const   SLOT_Y           = TOP_PAD + ROWS * ROW_H + SLOT_GAP

// ── Multiplier colour ─────────────────────────────────────────────────────────
function multStyle(m) {
  if (m >= 5)  return { bg: '#f59e0b', dim: '#f59e0b44', text: '#000' }  // amber
  if (m >= 2)  return { bg: '#10b981', dim: '#10b98144', text: '#fff' }  // emerald
  if (m >= 1)  return { bg: '#3b82f6', dim: '#3b82f644', text: '#fff' }  // blue
  return            { bg: '#ef4444', dim: '#ef444444', text: '#fff' }    // red 0.5×
}

// ── Build ball waypoints ──────────────────────────────────────────────────────
function buildPath(decisions) {
  // decisions: array of 8 numbers (0=left, 1=right)
  // Returns {pts, slot}
  const pts = [{ x: BOARD_W / 2, y: TOP_PAD - BALL_R - 6 }]  // start above center
  let col = 0
  for (let r = 0; r < ROWS; r++) {
    pts.push({ x: pegX(r, col), y: pegY(r) })
    if (decisions[r]) col++
  }
  pts.push({ x: slotCX(col), y: SLOT_Y + SLOT_H / 2 })
  return { pts, slot: col }
}

// ── Peg list (computed once) ──────────────────────────────────────────────────
const ALL_PEGS = []
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c <= r; c++) {
    ALL_PEGS.push({ r, c, x: pegX(r, c), y: pegY(r) })
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PlinkoGame() {
  const { balance, placeBet } = useCasino()

  const [bet,      setBet]      = useState(50)
  const [phase,    setPhase]    = useState('idle')   // idle | dropping | done
  const [ballPt,   setBallPt]   = useState({ x: BOARD_W / 2, y: TOP_PAD - BALL_R - 6 })
  const [litSlot,  setLitSlot]  = useState(null)
  const [result,   setResult]   = useState(null)     // { slot, mult, winAmount }

  const timerRef   = useRef(null)
  const isDropping = phase === 'dropping'

  // Cleanup on unmount
  useEffect(() => () => clearTimeout(timerRef.current), [])

  // ── Drop ──────────────────────────────────────────────────────────────────
  const drop = useCallback(async () => {
    if (isDropping || balance === null || bet < 1 || bet > balance) return

    setPhase('dropping')
    setResult(null)
    setLitSlot(null)

    // Generate random path
    const decisions = Array.from({ length: ROWS }, () => +(Math.random() < 0.5))
    const { pts, slot } = buildPath(decisions)
    const mult      = MULTS[slot]
    const payout    = Math.floor(bet * mult)
    const winAmount = payout - bet

    // Position ball at starting point (no transition yet)
    setBallPt(pts[0])

    // Step through waypoints
    let step = 0
    function nextStep() {
      step++
      if (step >= pts.length) {
        setLitSlot(slot)
        placeBet('plinko', bet, winAmount).then(() => {
          setResult({ slot, mult, winAmount })
          setPhase('done')
        })
        return
      }
      setBallPt(pts[step])
      // Slow down near last step so ball "settles"
      const delay = step >= pts.length - 2 ? 350 : 200
      timerRef.current = setTimeout(nextStep, delay)
    }

    timerRef.current = setTimeout(nextStep, 80)
  }, [isDropping, balance, bet, placeBet])

  // ── Reset ─────────────────────────────────────────────────────────────────
  function handleReset() {
    clearTimeout(timerRef.current)
    setPhase('idle')
    setResult(null)
    setLitSlot(null)
    setBallPt({ x: BOARD_W / 2, y: TOP_PAD - BALL_R - 6 })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <GameLayout title="Plinko">
      <div className="flex flex-col items-center gap-6">

        {/* ── Board ── */}
        <div
          className="relative bg-cp-card border border-cp-border rounded-2xl select-none"
          style={{ width: BOARD_W, height: BOARD_H }}
        >
          {/* Pegs */}
          {ALL_PEGS.map(({ r, c, x, y }) => (
            <div
              key={`${r}-${c}`}
              className="absolute rounded-full bg-cp-elevated border border-cp-border/60"
              style={{
                width: PEG_R * 2,
                height: PEG_R * 2,
                left: x - PEG_R,
                top:  y - PEG_R,
              }}
            />
          ))}

          {/* Slots */}
          {MULTS.map((mult, i) => {
            const { bg, dim, text } = multStyle(mult)
            const isLit = litSlot === i
            return (
              <div
                key={i}
                className="absolute flex items-center justify-center text-xs font-bold rounded-lg transition-all duration-300"
                style={{
                  left:      i * SLOT_W + 1,
                  top:       SLOT_Y,
                  width:     SLOT_W - 2,
                  height:    SLOT_H,
                  background: isLit ? bg : dim,
                  color:      isLit ? text : bg,
                  transform:  isLit ? 'scale(1.07)' : 'scale(1)',
                  boxShadow:  isLit ? `0 0 18px ${bg}99` : 'none',
                  zIndex:     isLit ? 5 : 1,
                  fontSize:   mult >= 5 ? '0.8rem' : '0.7rem',
                }}
              >
                {mult}×
              </div>
            )
          })}

          {/* Ball */}
          <div
            className="absolute rounded-full z-10 pointer-events-none"
            style={{
              width:      BALL_R * 2,
              height:     BALL_R * 2,
              left:       ballPt.x - BALL_R,
              top:        ballPt.y - BALL_R,
              background: 'radial-gradient(circle at 38% 35%, #fde68a, #d97706)',
              boxShadow:  '0 0 14px rgba(251,191,36,0.75), 0 2px 8px rgba(0,0,0,0.45)',
              transition: isDropping
                ? 'left 0.17s ease-out, top 0.2s ease-in'
                : 'none',
            }}
          />
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
              style={{ color: multStyle(result.mult).bg }}
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

        {/* ── Bet ── */}
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
            {isDropping ? 'Dropping…' : '⬇ Drop Ball'}
          </button>
        ) : (
          <button
            onClick={handleReset}
            className="w-full max-w-sm py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95"
          >
            Drop Again
          </button>
        )}

        {/* Hint */}
        <p className="text-xs text-cp-muted/50 text-center">
          8 rows · 9 slots · Edges = highest multiplier
        </p>

      </div>
    </GameLayout>
  )
}
