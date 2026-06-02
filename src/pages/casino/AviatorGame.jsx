import { useState, useEffect, useRef } from 'react'
import { GameLayout, BetChips, ResultBanner, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'
import FlightBoard from './FlightBoard'
import { generateCrash, multiplierForElapsed } from './aviatorTrajectory'

const HISTORY_KEY = 'cp-studios:aviator-history'
const HISTORY_MAX = 15
const BIG_WIN_MULT = 5

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.slice(0, HISTORY_MAX) : []
  } catch {
    return []
  }
}

function pillStyle(m) {
  if (m < 2) return { color: '#f87171', borderColor: '#7f1d1d', background: '#2a1112' }
  if (m <= 5) return { color: '#fcd34d', borderColor: '#854d0e', background: '#2a210f' }
  return { color: '#86efac', borderColor: '#14532d', background: '#0f2a18' }
}

function HistoryBar({ items }) {
  if (!items.length) return null
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        overflow: 'hidden',
        marginBottom: 12,
        WebkitMaskImage: 'linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)',
      }}
    >
      {items.map((m, i) => {
        const s = pillStyle(m)
        return (
          <span
            key={i}
            style={{ flex: 'none', fontSize: 12, fontWeight: 700, padding: '4px 9px', borderRadius: 999, border: `1px solid ${s.borderColor}`, color: s.color, background: s.background }}
          >
            {m.toFixed(2)}×
          </span>
        )
      })}
    </div>
  )
}

function BigWinBurst({ multiplier, amount }) {
  const coins = Array.from({ length: 14 })
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(60% 50% at 50% 45%, rgba(251,191,36,0.22), rgba(251,191,36,0) 70%)' }} />
      {!REDUCED_MOTION &&
        coins.map((_, i) => {
          const angle = (i / coins.length) * Math.PI * 2
          return (
            <span
              key={i}
              style={{ position: 'absolute', fontSize: 18, animation: 'bwBurst 0.9s ease-out forwards', '--dx': `${Math.cos(angle) * 120}px`, '--dy': `${Math.sin(angle) * 90}px` }}
            >
              🪙
            </span>
          )
        })}
      <div style={{ position: 'relative', fontFamily: '"Playfair Display", Georgia, serif', fontWeight: 800, fontSize: 30, color: '#fde68a', textShadow: '0 0 26px rgba(251,191,36,0.6)' }}>
        +{formatCoins(amount)} coins
      </div>
      <div style={{ position: 'relative', fontSize: 12, color: '#a8a29e', marginTop: 4 }}>Huge win at {multiplier.toFixed(2)}× 🎉</div>
      <style>{`@keyframes bwBurst { from { transform: translate(0,0) scale(0.4); opacity: 1 } to { transform: translate(var(--dx), var(--dy)) scale(1); opacity: 0 } }`}</style>
    </div>
  )
}

export default function AviatorGame() {
  const { balance, placeBet } = useCasino()

  const [phase, setPhase] = useState('betting') // betting | flying | crashed | cashedout
  const [multiplier, setMultiplier] = useState(1.0)
  const [bet, setBet] = useState(50)
  const [cashedOutAt, setCashedOutAt] = useState(null)
  const [gameResult, setGameResult] = useState(null)
  const [wonAmount, setWonAmount] = useState(0)
  const [history, setHistory] = useState(loadHistory)
  const [bigWin, setBigWin] = useState(null) // { multiplier, amount } | null

  const crashPointRef = useRef(null)
  const startTimeRef = useRef(0)
  const rafRef = useRef(null)
  const multiplierRef = useRef(1.0)
  const settledRef = useRef(false) // ensures a round settles (pays out) exactly once
  const betRef = useRef(bet)
  const placeBetRef = useRef(placeBet)

  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => { placeBetRef.current = placeBet }, [placeBet])

  function recordRound(crashMult) {
    setHistory((prev) => {
      const next = [crashMult, ...prev].slice(0, HISTORY_MAX)
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  // Flight loop — driven by phase so the RAF never captures stale state.
  useEffect(() => {
    if (phase !== 'flying') return
    let active = true
    const tick = () => {
      if (!active) return
      const elapsed = (performance.now() - startTimeRef.current) / 1000
      const m = multiplierForElapsed(elapsed)
      if (m >= crashPointRef.current) {
        if (settledRef.current) return
        settledRef.current = true
        const cp = crashPointRef.current
        multiplierRef.current = cp
        setMultiplier(cp)
        setPhase('crashed')
        setGameResult('loss')
        setWonAmount(betRef.current)
        placeBetRef.current('aviator', betRef.current, -betRef.current)
        recordRound(cp)
        return
      }
      multiplierRef.current = m
      setMultiplier(+m.toFixed(2))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { active = false; cancelAnimationFrame(rafRef.current) }
  }, [phase])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  function startFlight() {
    if ((balance ?? 0) < bet) return
    settledRef.current = false
    crashPointRef.current = generateCrash()
    multiplierRef.current = 1.0
    startTimeRef.current = performance.now()
    setMultiplier(1.0)
    setCashedOutAt(null)
    setGameResult(null)
    setWonAmount(0)
    setBigWin(null)
    setPhase('flying')
  }

  function handleCashOut() {
    if (phase !== 'flying') return
    if (settledRef.current) return
    settledRef.current = true
    cancelAnimationFrame(rafRef.current)
    const m = multiplierRef.current
    const win = Math.floor(betRef.current * (m - 1))
    setCashedOutAt(m)
    setPhase('cashedout')
    setGameResult('win')
    setWonAmount(win)
    placeBetRef.current('aviator', betRef.current, win)
    recordRound(crashPointRef.current)
    if (m >= BIG_WIN_MULT) setBigWin({ multiplier: m, amount: win })
  }

  function handlePlayAgain() {
    cancelAnimationFrame(rafRef.current)
    setPhase('betting')
    setMultiplier(1.0)
    multiplierRef.current = 1.0
    crashPointRef.current = null
    setCashedOutAt(null)
    setGameResult(null)
    setWonAmount(0)
    setBigWin(null)
  }

  if (balance === null) {
    return (
      <GameLayout title="Aviator">
        <div className="flex items-center justify-center h-48">
          <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        </div>
      </GameLayout>
    )
  }

  const isBetting = phase === 'betting'
  const isFlying = phase === 'flying'
  const isCrashed = phase === 'crashed'
  const isCashedOut = phase === 'cashedout'
  const isResult = isCrashed || isCashedOut
  const liveWin = Math.floor(bet * (multiplier - 1))

  return (
    <GameLayout title="Aviator">
      <div className="flex flex-col items-center gap-6">
        <div className="w-full max-w-md">
          <HistoryBar items={history} />
          <div style={{ position: 'relative' }}>
            <FlightBoard
              phase={phase}
              multiplier={multiplier}
              crashPoint={crashPointRef.current}
              cashedOutAt={cashedOutAt}
              bet={bet}
            />
            {bigWin && <BigWinBurst multiplier={bigWin.multiplier} amount={bigWin.amount} />}
          </div>
        </div>

        <div className="w-full max-w-md flex flex-col gap-4">
          {isBetting && (
            <div className="bg-cp-card border border-cp-border rounded-2xl p-4">
              <BetChips bet={bet} onBet={setBet} balance={balance} disabled={false} />
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
              Fly! ✈
            </button>
          )}

          {isFlying && (
            <button
              onClick={handleCashOut}
              className="w-full py-3.5 rounded-2xl font-bold text-black transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', boxShadow: '0 0 28px rgba(251,191,36,0.4)', animation: REDUCED_MOTION ? 'none' : 'aviatorPulse 1.1s ease-out infinite', fontSize: 17 }}
            >
              CASH OUT&nbsp; +{formatCoins(liveWin)} &nbsp;·&nbsp; {multiplier.toFixed(2)}×
            </button>
          )}

          {isCrashed && (
            <div className="flex flex-col gap-3">
              <div className="text-center rounded-xl border border-red-400/30 bg-red-400/10 py-3 px-4">
                <p className="text-red-400 font-bold text-lg">FLEW AWAY ✈ {crashPointRef.current?.toFixed(2)}×</p>
                <p className="text-cp-muted text-sm mt-0.5">Lost {formatCoins(bet)} coins</p>
              </div>
              <button onClick={handlePlayAgain} className="w-full py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95">Play Again</button>
            </div>
          )}

          {isCashedOut && (
            <div className="flex flex-col gap-3">
              <div className="text-center rounded-xl border border-emerald-400/30 bg-emerald-400/10 py-3 px-4">
                <p className="text-emerald-400 font-bold text-lg">Cashed out at {cashedOutAt?.toFixed(2)}× 🎉</p>
                <p className="text-emerald-300 text-sm font-semibold mt-0.5">+{formatCoins(wonAmount)} coins</p>
              </div>
              <button onClick={handlePlayAgain} className="w-full py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95">Play Again</button>
            </div>
          )}
        </div>

        {isResult && (
          <div className="w-full max-w-md">
            <ResultBanner
              result={gameResult}
              amount={wonAmount}
              message={isCrashed ? `Flew away at ${crashPointRef.current?.toFixed(2)}×` : `Cashed out at ${cashedOutAt?.toFixed(2)}×`}
            />
          </div>
        )}

        <style>{`@keyframes aviatorPulse { 0%{box-shadow:0 0 0 0 rgba(251,191,36,0.55)} 70%{box-shadow:0 0 0 14px rgba(251,191,36,0)} 100%{box-shadow:0 0 0 0 rgba(251,191,36,0)} }`}</style>
      </div>
    </GameLayout>
  )
}
