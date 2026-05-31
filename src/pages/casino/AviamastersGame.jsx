import { useState, useEffect, useRef } from 'react'
import { GameLayout, BetChips, ResultBanner, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'
import { generateRound, SPEEDS, MAX_MULT } from './aviamastersEngine'

// ── Multiplier color (matches Aviator conventions) ─────────────────────────────
function multColor(m, splashed) {
  if (splashed) return '#f87171'   // red-400
  if (m < 2)    return '#86efac'   // green-300
  if (m < 5)    return '#fde68a'   // amber-200
  return '#fdba74'                 // orange-300
}

// ── Plane position from progress (0→1 along the flight) ────────────────────────
function planePos(progress) {
  const x = 8 + Math.min(1, progress) * 72   // 8% → 80%
  const y = 78 - Math.min(1, progress) * 60  // 78% → 18%
  return { x, y }
}

const SPEED_OPTIONS = [
  { key: 'tortoise',  label: '🐢' },
  { key: 'walking',   label: '🚶' },
  { key: 'hare',      label: '🐇' },
  { key: 'lightning', label: '⚡' },
]

export default function AviamastersGame() {
  const { balance, placeBet } = useCasino()

  const [phase, setPhase]           = useState('betting') // 'betting'|'flying'|'landed'|'splashed'
  const [bet, setBet]               = useState(50)
  const [speed, setSpeed]           = useState('walking')
  const [multiplier, setMultiplier] = useState(1.00)
  const [eventIdx, setEventIdx]     = useState(-1)        // index of last applied event
  const [flashKind, setFlashKind]   = useState(null)      // 'mult'|'add'|'rocket' for bump anim
  const [gameResult, setGameResult] = useState(null)      // 'win'|'loss'
  const [wonAmount, setWonAmount]   = useState(0)

  const roundRef    = useRef(null)   // { events, finalMult, outcome }
  const idxRef      = useRef(-1)
  const betRef      = useRef(bet)
  const speedRef    = useRef(speed)
  const placeBetRef = useRef(placeBet)
  const intervalRef = useRef(null)

  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { placeBetRef.current = placeBet }, [placeBet])

  // ── Inject keyframes once ─────────────────────────────────────────────────
  useEffect(() => {
    const id = 'aviamasters-kf'
    if (!document.getElementById(id)) {
      const s = document.createElement('style')
      s.id = id
      s.textContent = `
        @keyframes amPlaneFly {
          0%, 100% { transform: translateY(0px) rotate(-12deg); }
          50%      { transform: translateY(-4px) rotate(-15deg); }
        }
        @keyframes amBump {
          0%   { transform: translate(-50%, -50%) scale(1); }
          40%  { transform: translate(-50%, -50%) scale(1.18); }
          100% { transform: translate(-50%, -50%) scale(1); }
        }
      `
      document.head.appendChild(s)
    }
  }, [])

  // ── Flight loop — advances one pre-rolled event per tick ───────────────────
  useEffect(() => {
    if (phase !== 'flying') return
    const round = roundRef.current
    const tick = SPEEDS[speedRef.current] ?? SPEEDS.walking

    intervalRef.current = setInterval(() => {
      const nextIdx = idxRef.current + 1

      if (nextIdx >= round.events.length) {
        clearInterval(intervalRef.current)
        resolveRound(round)
        return
      }

      const ev = round.events[nextIdx]
      idxRef.current = nextIdx
      setEventIdx(nextIdx)
      setMultiplier(ev.multAfter)
      setFlashKind(ev.kind)
    }, tick)

    return () => clearInterval(intervalRef.current)
  }, [phase])

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => clearInterval(intervalRef.current), [])

  function resolveRound(round) {
    if (round.outcome === 'land') {
      const win = Math.floor(betRef.current * Math.min(round.finalMult, MAX_MULT))
      const profit = win - betRef.current
      setGameResult('win')
      setWonAmount(profit)
      setPhase('landed')
      placeBetRef.current('aviamasters', betRef.current, profit)
    } else {
      setGameResult('loss')
      setWonAmount(betRef.current)
      setPhase('splashed')
      placeBetRef.current('aviamasters', betRef.current, -betRef.current)
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  function startFlight() {
    if ((balance ?? 0) < bet) return
    roundRef.current = generateRound()
    idxRef.current = -1
    setEventIdx(-1)
    setMultiplier(1.00)
    setFlashKind(null)
    setGameResult(null)
    setWonAmount(0)
    setPhase('flying')
  }

  function handlePlayAgain() {
    clearInterval(intervalRef.current)
    setPhase('betting')
    setMultiplier(1.00)
    idxRef.current = -1
    setEventIdx(-1)
    setFlashKind(null)
    setGameResult(null)
    setWonAmount(0)
  }

  // ── Loading guard ─────────────────────────────────────────────────────────
  if (balance === null) {
    return (
      <GameLayout title="Aviamasters">
        <div className="flex items-center justify-center h-48">
          <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        </div>
      </GameLayout>
    )
  }

  const isBetting  = phase === 'betting'
  const isFlying   = phase === 'flying'
  const isLanded   = phase === 'landed'
  const isSplashed = phase === 'splashed'
  const isResult   = isLanded || isSplashed

  const round       = roundRef.current
  const totalEvents = round?.events.length ?? 1
  const progress    = isFlying || isResult ? (eventIdx + 1) / totalEvents : 0
  const { x: planeX, y: planeY } = planePos(progress)
  const color    = multColor(multiplier, isSplashed)
  const multText = multiplier.toFixed(2)

  // Node / rocket badges positioned along the projected flight path.
  const badges = (round?.events ?? []).map((ev, i) => {
    const p   = (i + 1) / totalEvents
    const pos = planePos(p)
    return { ...ev, i, x: pos.x, y: pos.y, collected: i <= eventIdx }
  })

  return (
    <GameLayout title="Aviamasters">
      <div className="flex flex-col items-center gap-6">

        {/* ── Game board ── */}
        <div
          className="w-full max-w-md rounded-2xl border border-cp-border overflow-hidden"
          style={{ background: '#030712', height: 300, position: 'relative' }}
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

          {/* Water band + carrier */}
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, height: '14%',
            background: 'linear-gradient(180deg, rgba(56,189,248,0.10), rgba(2,6,23,0))',
          }} />
          <div style={{ position: 'absolute', right: '6%', bottom: '12%', fontSize: 22, opacity: 0.85 }}>🚢</div>

          {/* Trajectory trail */}
          {(isFlying || isResult) && (
            <svg
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="amTrail" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={color} stopOpacity="0" />
                  <stop offset="100%" stopColor={color} stopOpacity="0.5" />
                </linearGradient>
              </defs>
              <line
                x1="8%" y1="78%"
                x2={`${planeX}%`} y2={`${planeY}%`}
                stroke="url(#amTrail)" strokeWidth="2" strokeLinecap="round"
              />
            </svg>
          )}

          {/* Node / rocket badges */}
          {(isFlying || isResult) && badges.map(b => (
            <div
              key={b.i}
              style={{
                position: 'absolute', left: `${b.x}%`, top: `${b.y}%`,
                transform: 'translate(-50%, -50%)',
                fontSize: 11, fontWeight: 800, lineHeight: 1,
                padding: b.kind === 'rocket' ? 0 : '3px 6px',
                borderRadius: 8,
                opacity: b.collected ? 0.25 : 1,
                transition: 'opacity 0.25s',
                color:      b.kind === 'rocket' ? undefined : (b.kind === 'mult' ? '#000' : '#052e16'),
                background: b.kind === 'rocket' ? 'transparent'
                          : b.kind === 'mult'   ? '#fbbf24'
                          :                       '#86efac',
                boxShadow:  b.collected         ? 'none'
                          : b.kind === 'mult'   ? '0 0 10px rgba(251,191,36,0.6)'
                          : b.kind === 'add'    ? '0 0 10px rgba(134,239,172,0.5)'
                          :                       'none',
              }}
            >
              {b.kind === 'rocket' ? '🚀' : b.kind === 'mult' ? `×${b.value}` : `+${b.value}`}
            </div>
          ))}

          {/* Plane / resolve icon */}
          <div
            style={{
              position: 'absolute', left: `${planeX}%`, top: `${planeY}%`,
              transform: 'translate(-50%, -50%)',
              fontSize: 24,
              animation:  isFlying   ? 'amPlaneFly 0.8s ease-in-out infinite' : 'none',
              transition: isFlying   ? 'left 0.2s linear, top 0.2s linear'   : 'none',
              filter:     isSplashed ? 'none' : `drop-shadow(0 0 8px ${color})`,
            }}
          >
            {isSplashed ? '🌊' : isLanded ? '🛬' : '🛩️'}
          </div>

          {/* Counter Balance readout */}
          <div
            key={eventIdx}
            style={{
              position: 'absolute', top: '42%', left: '50%',
              transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none',
              animation: flashKind && isFlying ? 'amBump 0.3s ease-out' : 'none',
            }}
          >
            <div style={{
              fontSize: 56, fontWeight: 900, color, lineHeight: 1,
              textShadow: `0 0 32px ${color}80`, letterSpacing: '-2px',
            }}>
              {multText}×
            </div>
            {isFlying && (
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                Bet: {formatCoins(bet)} coins
              </div>
            )}
            {isSplashed && (
              <div style={{
                fontSize: 12, fontWeight: 700, color: '#f87171',
                textTransform: 'uppercase', letterSpacing: 3, marginTop: 4,
              }}>
                SPLASH
              </div>
            )}
          </div>
        </div>

        {/* ── Controls ── */}
        <div className="w-full max-w-md flex flex-col gap-4">

          {isBetting && (
            <div className="bg-cp-card border border-cp-border rounded-2xl p-4 flex flex-col gap-4">
              <BetChips bet={bet} onBet={setBet} balance={balance} disabled={false} />
              <div className="flex items-center justify-between">
                <span className="text-cp-muted text-sm font-semibold">Speed</span>
                <div className="flex gap-2">
                  {SPEED_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setSpeed(opt.key)}
                      className={`w-10 h-10 rounded-xl text-lg transition-all active:scale-95 border
                        ${speed === opt.key
                          ? 'bg-amber-400 border-amber-300'
                          : 'bg-cp-elevated border-cp-border hover:border-amber-400/40'
                        }`}
                      title={opt.key}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {isBetting && (
            <button
              onClick={startFlight}
              disabled={balance < bet}
              className={`w-full py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
                ${balance < bet
                  ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                  : 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_24px_rgba(251,191,36,0.3)] hover:shadow-[0_0_32px_rgba(251,191,36,0.45)] active:scale-95'
                }`}
            >
              Spin! 🛩️
            </button>
          )}

          {isFlying && (
            <div className="w-full py-3.5 rounded-2xl font-bold text-center text-cp-muted bg-cp-elevated border border-cp-border">
              In flight… {multText}×
            </div>
          )}

          {isResult && (
            <div className="flex flex-col gap-3">
              <div className={`text-center rounded-xl border py-3 px-4
                ${isLanded
                  ? 'border-emerald-400/30 bg-emerald-400/10'
                  : 'border-red-400/30 bg-red-400/10'
                }`}
              >
                {isLanded ? (
                  <>
                    <p className="text-emerald-400 font-bold text-lg">
                      Landed at {round?.finalMult.toFixed(2)}× 🎉
                    </p>
                    <p className="text-emerald-300 text-sm font-semibold mt-0.5">
                      {wonAmount >= 0 ? '+' : ''}{formatCoins(wonAmount)} coins
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-red-400 font-bold text-lg">
                      Splashed 🌊 at {round?.finalMult.toFixed(2)}×
                    </p>
                    <p className="text-cp-muted text-sm mt-0.5">Lost {formatCoins(bet)} coins</p>
                  </>
                )}
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
              message={isLanded
                ? `Landed at ${round?.finalMult.toFixed(2)}×`
                : `Splashed at ${round?.finalMult.toFixed(2)}×`}
            />
          </div>
        )}

      </div>
    </GameLayout>
  )
}
