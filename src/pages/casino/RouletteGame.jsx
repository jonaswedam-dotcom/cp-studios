import { useState, useEffect, useRef } from 'react'
import { GameLayout, BetChips, ResultBanner, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'

const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36])

const WHEEL_ORDER = [
  0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,
  24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26
]

function getNumberColor(n) {
  if (n === 0) return 'green'
  return RED_NUMBERS.has(n) ? 'red' : 'black'
}

// Build conic-gradient string from wheel order
function buildWheelGradient() {
  const slotDeg = 360 / WHEEL_ORDER.length
  const segments = WHEEL_ORDER.map((num, i) => {
    const color = getNumberColor(num)
    const hex = color === 'red' ? '#dc2626' : color === 'green' ? '#16a34a' : '#1a1a1a'
    const start = (i * slotDeg).toFixed(3)
    const end   = ((i + 1) * slotDeg).toFixed(3)
    return `${hex} ${start}deg ${end}deg`
  })
  return `conic-gradient(${segments.join(', ')})`
}

const WHEEL_GRADIENT = buildWheelGradient()
const SLOT_DEG = 360 / WHEEL_ORDER.length

function calcWin(betType, chosenNumber, resultNumber, bet) {
  const color = getNumberColor(resultNumber)

  if (betType === 'number') {
    if (chosenNumber === resultNumber) {
      return { won: true, winAmount: bet * 34, multiplier: '35×' }
    }
    return { won: false, winAmount: -bet, multiplier: null }
  }
  if (betType === 'red') {
    if (color === 'red') return { won: true, winAmount: bet, multiplier: '2×' }
    return { won: false, winAmount: -bet, multiplier: null }
  }
  if (betType === 'black') {
    if (color === 'black') return { won: true, winAmount: bet, multiplier: '2×' }
    return { won: false, winAmount: -bet, multiplier: null }
  }
  if (betType === 'odd') {
    if (resultNumber !== 0 && resultNumber % 2 !== 0) return { won: true, winAmount: bet, multiplier: '2×' }
    return { won: false, winAmount: -bet, multiplier: null }
  }
  if (betType === 'even') {
    if (resultNumber !== 0 && resultNumber % 2 === 0) return { won: true, winAmount: bet, multiplier: '2×' }
    return { won: false, winAmount: -bet, multiplier: null }
  }
  return { won: false, winAmount: -bet, multiplier: null }
}

export default function RouletteGame() {
  const { balance, placeBet } = useCasino()

  const [betType, setBetType]         = useState(null)  // 'red'|'black'|'odd'|'even'|'number'
  const [chosenNumber, setChosenNumber] = useState(null)
  const [phase, setPhase]             = useState('idle') // 'idle'|'spinning'|'result'
  const [result, setResult]           = useState(null)   // { number, color } | null
  const [bet, setBet]                 = useState(50)
  const [gameResult, setGameResult]   = useState(null)   // 'win'|'loss'|null
  const [wonAmount, setWonAmount]     = useState(0)
  const [wheelRotation, setWheelRotation] = useState(0)
  const [pendingRotation, setPendingRotation] = useState(null)

  const spinTimeoutRef = useRef(null)

  useEffect(() => {
    return () => clearTimeout(spinTimeoutRef.current)
  }, [])

  function handleSpin() {
    if (!betType || phase === 'spinning') return
    if (betType === 'number' && chosenNumber === null) return

    setPhase('spinning')
    setResult(null)
    setGameResult(null)
    setWonAmount(0)

    // Pick result
    const resultNumber = Math.floor(Math.random() * 37) // 0-36
    const slotIdx = WHEEL_ORDER.indexOf(resultNumber)

    // Each slot center is at (slotIdx + 0.5) * SLOT_DEG from top
    // We want that slot to end at the top (0deg / 360deg)
    // Current rotation + 5 full rotations + offset
    const targetAngle = (slotIdx + 0.5) * SLOT_DEG
    // The wheel rotates clockwise; to land slot at top, add enough so the slot aligns
    const newRotation = wheelRotation + 5 * 360 + (360 - (wheelRotation % 360) - targetAngle + 360) % 360

    setWheelRotation(newRotation)
    setPendingRotation(newRotation)

    spinTimeoutRef.current = setTimeout(() => {
      const color = getNumberColor(resultNumber)
      setResult({ number: resultNumber, color })
      setPhase('result')

      const { won, winAmount } = calcWin(betType, chosenNumber, resultNumber, bet)
      setGameResult(won ? 'win' : 'loss')
      setWonAmount(won ? winAmount : bet)
      placeBet('roulette', bet, winAmount)
    }, 4200)
  }

  function handleNewGame() {
    setPhase('idle')
    setResult(null)
    setGameResult(null)
    setWonAmount(0)
  }

  function selectBetType(type) {
    if (phase === 'spinning') return
    if (phase === 'result') handleNewGame()
    setBetType(type)
    if (type !== 'number') setChosenNumber(null)
  }

  function selectNumber(n) {
    if (phase === 'spinning') return
    if (phase === 'result') handleNewGame()
    setBetType('number')
    setChosenNumber(n)
  }

  const isSpinning = phase === 'spinning'
  const canSpin = betType && (betType !== 'number' || chosenNumber !== null) && !isSpinning && (balance ?? 0) >= bet

  const resultColorLabel = result
    ? result.color.charAt(0).toUpperCase() + result.color.slice(1)
    : ''

  const resultMessage = result
    ? `${result.number} — ${resultColorLabel}${result.number !== 0 && result.number % 2 !== 0 ? ', Odd' : result.number !== 0 ? ', Even' : ''}`
    : null

  return (
    <GameLayout title="Roulette">
      <div className="flex flex-col items-center gap-6">

        {/* ── Wheel ── */}
        <div className="flex flex-col items-center gap-4">
          <div className="relative" style={{ width: 240, height: 240 }}>
            {/* Outer ring */}
            <div
              className="absolute inset-0 rounded-full border-4 border-amber-400/40"
              style={{
                boxShadow: isSpinning
                  ? '0 0 48px rgba(251,191,36,0.35), 0 0 80px rgba(251,191,36,0.15)'
                  : '0 0 24px rgba(0,0,0,0.6)',
                transition: 'box-shadow 0.4s',
              }}
            />

            {/* Spinning wheel */}
            <div
              style={{
                width: '100%',
                height: '100%',
                borderRadius: '50%',
                background: WHEEL_GRADIENT,
                transform: `rotate(${wheelRotation}deg)`,
                transition: isSpinning
                  ? 'transform 4s cubic-bezier(0.17,0.67,0.12,0.99)'
                  : 'none',
              }}
            />

            {/* Center cap */}
            <div
              className="absolute rounded-full border-2 border-amber-400/50 bg-cp-bg"
              style={{
                width: 64,
                height: 64,
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10,
                boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
              }}
            >
              <span className="text-amber-400 text-lg font-bold">
                {result !== null ? result.number : '?'}
              </span>
            </div>

            {/* Top marker */}
            <div
              className="absolute"
              style={{
                top: -2,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 20,
                width: 0,
                height: 0,
                borderLeft: '7px solid transparent',
                borderRight: '7px solid transparent',
                borderTop: '14px solid #fbbf24',
              }}
            />
          </div>

          {isSpinning && (
            <p className="text-sm text-cp-muted animate-pulse">Spinning…</p>
          )}
        </div>

        {/* ── Bet type buttons ── */}
        <div className="w-full max-w-sm">
          <p className="text-sm text-cp-muted font-medium mb-3">Bet type:</p>
          <div className="grid grid-cols-4 gap-2">
            {[
              { key: 'red',   label: 'Red',   bg: 'bg-red-600',    border: 'border-red-500' },
              { key: 'black', label: 'Black', bg: 'bg-neutral-800', border: 'border-neutral-600' },
              { key: 'odd',   label: 'Odd',   bg: 'bg-cp-elevated', border: 'border-cp-border' },
              { key: 'even',  label: 'Even',  bg: 'bg-cp-elevated', border: 'border-cp-border' },
            ].map(({ key, label, bg, border }) => {
              const selected = betType === key
              return (
                <button
                  key={key}
                  onClick={() => selectBetType(key)}
                  disabled={isSpinning}
                  className={`py-2.5 rounded-xl border-2 font-bold text-sm transition-all
                    ${selected
                      ? `${bg} ${border} text-white ring-2 ring-white/30 shadow-lg`
                      : `bg-cp-card border-cp-border text-cp-muted hover:border-amber-400/40 hover:text-cp-text`
                    }
                    ${isSpinning ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-cp-muted mt-2 text-center">Red/Black/Odd/Even pay 2×</p>
        </div>

        {/* ── Number grid ── */}
        <div className="w-full max-w-sm">
          <p className="text-sm text-cp-muted font-medium mb-3">
            Or pick a number <span className="text-amber-400">(35×)</span>:
          </p>
          <div className="grid grid-cols-7 gap-1.5">
            {/* 0 first, spans visually */}
            <button
              onClick={() => selectNumber(0)}
              disabled={isSpinning}
              className={`col-span-1 rounded-lg py-2 text-xs font-bold border-2 transition-all
                ${betType === 'number' && chosenNumber === 0
                  ? 'bg-green-600 border-green-500 text-white ring-2 ring-white/30'
                  : 'bg-green-900/40 border-green-700/40 text-green-400 hover:border-green-500'
                }
                ${isSpinning ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              0
            </button>

            {/* 1-36 */}
            {Array.from({ length: 36 }, (_, i) => i + 1).map((n) => {
              const color = getNumberColor(n)
              const selected = betType === 'number' && chosenNumber === n
              const base = color === 'red'
                ? 'bg-red-900/40 border-red-700/40 text-red-400 hover:border-red-500'
                : 'bg-neutral-900/60 border-neutral-700/40 text-neutral-400 hover:border-neutral-500'
              const activeBase = color === 'red'
                ? 'bg-red-600 border-red-500 text-white ring-2 ring-white/30'
                : 'bg-neutral-700 border-neutral-500 text-white ring-2 ring-white/30'

              return (
                <button
                  key={n}
                  onClick={() => selectNumber(n)}
                  disabled={isSpinning}
                  className={`rounded-lg py-1.5 text-xs font-bold border-2 transition-all
                    ${selected ? activeBase : base}
                    ${isSpinning ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  {n}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Bet chips ── */}
        <div className="w-full max-w-sm bg-cp-card border border-cp-border rounded-2xl p-4">
          <BetChips
            bet={bet}
            onBet={setBet}
            balance={balance ?? 0}
            disabled={isSpinning}
          />
        </div>

        {/* ── Spin / Play Again button ── */}
        {phase !== 'result' ? (
          <button
            onClick={handleSpin}
            disabled={!canSpin}
            className={`w-full max-w-sm py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
              ${!canSpin
                ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                : 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_24px_rgba(251,191,36,0.3)] hover:shadow-[0_0_32px_rgba(251,191,36,0.45)] active:scale-95'
              }
            `}
          >
            {isSpinning ? 'Spinning…' : 'Spin!'}
          </button>
        ) : (
          <button
            onClick={handleNewGame}
            className="w-full max-w-sm py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95"
          >
            Spin Again
          </button>
        )}

        {/* ── Result banner ── */}
        <div className="w-full max-w-sm">
          <ResultBanner
            result={gameResult}
            amount={wonAmount}
            message={resultMessage}
          />
        </div>

      </div>
    </GameLayout>
  )
}
