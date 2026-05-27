import { useState, useEffect, useRef, useCallback } from 'react'
import { GameLayout, BetChips, ResultBanner, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'

// ── Crash point generator ─────────────────────────────────────────────────────
function generateCrash() {
  if (Math.random() < 0.05) return 1.00
  const u = Math.random()
  return Math.max(1.01, +(1 / (1 - u * 0.95)).toFixed(2))
}

// ── Multiplier color ──────────────────────────────────────────────────────────
function multColor(m, crashed) {
  if (crashed) return '#f87171'        // red-400
  if (m < 2)   return '#86efac'        // green-300
  if (m < 5)   return '#fde68a'        // amber-200
  return '#fdba74'                     // orange-300
}

// ── Plane position from multiplier ───────────────────────────────────────────
function planePos(m) {
  const progress = Math.min(1, (m - 1) / 8)
  const x = 8 + progress * 72   // 8% → 80%
  const y = 80 - progress * 68  // 80% → 12%
  return { x, y }
}

export default function AviatorGame() {
  const { balance, placeBet } = useCasino()

  const [phase, setPhase] = useState('betting')         // 'betting' | 'flying' | 'crashed' | 'cashedout'
  const [multiplier, setMultiplier] = useState(1.00)
  const [bet, setBet] = useState(50)
  const [cashedOutAt, setCashedOutAt] = useState(null)
  const [gameResult, setGameResult] = useState(null)
  const [wonAmount, setWonAmount] = useState(0)

  const crashPointRef = useRef(null)
  const intervalRef = useRef(null)
  const currentMultRef = useRef(1.00)
  const phaseRef = useRef('betting')

  phaseRef.current = phase

  // Inject keyframes once
  useEffect(() => {
    const id = 'aviator-kf'
    if (!document.getElementById(id)) {
      const s = document.createElement('style')
      s.id = id
      s.textContent = `
        @keyframes planeFly {
          0%, 100% { transform: translateY(0px) rotate(-15deg); }
          50%       { transform: translateY(-4px) rotate(-18deg); }
        }
        @keyframes cashoutPulse {
          0%   { box-shadow: 0 0 0 0 rgba(251,191,36,0.7); }
          70%  { box-shadow: 0 0 0 12px rgba(251,191,36,0); }
          100% { box-shadow: 0 0 0 0 rgba(251,191,36,0); }
        }
        @keyframes trailFade {
          from { opacity: 0.6; }
          to   { opacity: 0; }
        }
      `
      document.head.appendChild(s)
    }
  }, [])

  function startFlight() {
    if ((balance ?? 0) < bet) return

    crashPointRef.current = generateCrash()
    currentMultRef.current = 1.00
    setMultiplier(1.00)
    setCashedOutAt(null)
    setGameResult(null)
    setWonAmount(0)
    setPhase('flying')

    intervalRef.current = setInterval(() => {
      const current = currentMultRef.current
      const next = +(current + 0.01 + current * 0.002).toFixed(2)

      if (next >= crashPointRef.current) {
        clearInterval(intervalRef.current)
        currentMultRef.current = crashPointRef.current
        setMultiplier(crashPointRef.current)
        setPhase('crashed')
        setGameResult('loss')
        setWonAmount(bet)
        placeBet('aviator', bet, -bet)
      } else {
        currentMultRef.current = next
        setMultiplier(next)
      }
    }, 80)
  }

  function handleCashOut() {
    if (phaseRef.current !== 'flying') return
    clearInterval(intervalRef.current)

    const m = currentMultRef.current
    const win = Math.floor(bet * (m - 1))
    setCashedOutAt(m)
    setPhase('cashedout')
    setGameResult('win')
    setWonAmount(win)
    placeBet('aviator', bet, win)
  }

  function handlePlayAgain() {
    clearInterval(intervalRef.current)
    setPhase('betting')
    setMultiplier(1.00)
    currentMultRef.current = 1.00
    setCashedOutAt(null)
    setGameResult(null)
    setWonAmount(0)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => clearInterval(intervalRef.current)
  }, [])

  const isBetting   = phase === 'betting'
  const isFlying    = phase === 'flying'
  const isCrashed   = phase === 'crashed'
  const isCashedOut = phase === 'cashedout'
  const isResult    = isCrashed || isCashedOut

  const { x: planeX, y: planeY } = planePos(multiplier)
  const multText = multiplier.toFixed(2)
  const color = multColor(multiplier, isCrashed)

  return (
    <GameLayout title="Aviator">
      <div className="flex flex-col items-center gap-6">

        {/* ── Game board ── */}
        <div
          className="w-full max-w-md rounded-2xl border border-cp-border overflow-hidden"
          style={{
            background: '#030712',
            height: 300,
            position: 'relative',
          }}
        >
          {/* Grid lines */}
          <svg
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.08 }}
            preserveAspectRatio="none"
          >
            {[20, 40, 60, 80].map(pct => (
              <line key={`h${pct}`} x1="0" y1={`${pct}%`} x2="100%" y2={`${pct}%`} stroke="#6b7280" strokeWidth="1" />
            ))}
            {[20, 40, 60, 80].map(pct => (
              <line key={`v${pct}`} x1={`${pct}%`} y1="0" x2={`${pct}%`} y2="100%" stroke="#6b7280" strokeWidth="1" />
            ))}
          </svg>

          {/* Trajectory trail */}
          {(isFlying || isCrashedOut || isCrashed) && (
            <svg
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="trailGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={color} stopOpacity="0" />
                  <stop offset="100%" stopColor={color} stopOpacity="0.5" />
                </linearGradient>
              </defs>
              <line
                x1="8%"
                y1="80%"
                x2={`${planeX}%`}
                y2={`${planeY}%`}
                stroke="url(#trailGrad)"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          )}

          {/* Plane or explosion */}
          <div
            style={{
              position: 'absolute',
              left: `${planeX}%`,
              top: `${planeY}%`,
              transform: 'translate(-50%, -50%)',
              fontSize: isCrashed ? 28 : 24,
              animation: isFlying ? 'planeFly 0.8s ease-in-out infinite' : 'none',
              transition: isFlying ? 'left 0.08s linear, top 0.08s linear' : 'none',
              filter: isCrashed ? 'none' : `drop-shadow(0 0 8px ${color})`,
            }}
          >
            {isCrashed ? '💥' : '✈️'}
          </div>

          {/* Multiplier display */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                fontSize: isCrashed ? 56 : 64,
                fontWeight: 900,
                color,
                lineHeight: 1,
                textShadow: isCrashed
                  ? '0 0 32px rgba(248,113,113,0.6)'
                  : `0 0 32px ${color}80`,
                transition: 'color 0.2s, font-size 0.1s',
                letterSpacing: '-2px',
              }}
            >
              {multText}×
            </div>
            {isCrashed && (
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#f87171',
                  textTransform: 'uppercase',
                  letterSpacing: 3,
                  marginTop: 4,
                }}
              >
                CRASHED
              </div>
            )}
            {isFlying && (
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                Bet: {formatCoins(bet)} coins
              </div>
            )}
          </div>

          {/* Cashed out overlay */}
          {isCashedOut && (
            <div
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                background: 'rgba(16,185,129,0.15)',
                border: '1px solid rgba(52,211,153,0.4)',
                borderRadius: 10,
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 700,
                color: '#34d399',
              }}
            >
              Cashed out at {cashedOutAt?.toFixed(2)}×
            </div>
          )}
        </div>

        {/* ── Controls ── */}
        <div className="w-full max-w-md flex flex-col gap-4">

          {/* Bet chips — only in betting phase */}
          {isBetting && (
            <div className="bg-cp-card border border-cp-border rounded-2xl p-4">
              <BetChips
                bet={bet}
                onBet={setBet}
                balance={balance ?? 0}
                disabled={false}
              />
            </div>
          )}

          {/* Main action button */}
          {isBetting && (
            <button
              onClick={startFlight}
              disabled={(balance ?? 0) < bet}
              className={`w-full py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
                ${(balance ?? 0) < bet
                  ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                  : 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_24px_rgba(251,191,36,0.3)] hover:shadow-[0_0_32px_rgba(251,191,36,0.45)] active:scale-95'
                }
              `}
            >
              Fly! ✈️
            </button>
          )}

          {isFlying && (
            <button
              onClick={handleCashOut}
              className="w-full py-3.5 rounded-2xl font-bold text-base tracking-wide text-black transition-all active:scale-95"
              style={{
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                animation: 'cashoutPulse 1s ease-out infinite',
                fontSize: 18,
              }}
            >
              Cash Out! {multText}×
            </button>
          )}

          {isCrashed && (
            <div className="flex flex-col gap-3">
              <div className="text-center rounded-xl border border-red-400/30 bg-red-400/10 py-3 px-4">
                <p className="text-red-400 font-bold text-lg">
                  CRASHED 💥 at {crashPointRef.current?.toFixed(2)}×
                </p>
                <p className="text-cp-muted text-sm mt-0.5">Lost {formatCoins(bet)} coins</p>
              </div>
              <button
                onClick={handlePlayAgain}
                className="w-full py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95"
              >
                Play Again
              </button>
            </div>
          )}

          {isCashedOut && (
            <div className="flex flex-col gap-3">
              <div className="text-center rounded-xl border border-emerald-400/30 bg-emerald-400/10 py-3 px-4">
                <p className="text-emerald-400 font-bold text-lg">
                  Cashed out at {cashedOutAt?.toFixed(2)}× 🎉
                </p>
                <p className="text-emerald-300 text-sm font-semibold mt-0.5">
                  +{formatCoins(wonAmount)} coins
                </p>
              </div>
              <button
                onClick={handlePlayAgain}
                className="w-full py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95"
              >
                Play Again
              </button>
            </div>
          )}
        </div>

        {/* ── Result banner ── */}
        {isResult && (
          <div className="w-full max-w-md">
            <ResultBanner
              result={gameResult}
              amount={wonAmount}
              message={
                isCrashed
                  ? `Crashed at ${crashPointRef.current?.toFixed(2)}×`
                  : `Cashed out at ${cashedOutAt?.toFixed(2)}×`
              }
            />
          </div>
        )}

      </div>
    </GameLayout>
  )
}
