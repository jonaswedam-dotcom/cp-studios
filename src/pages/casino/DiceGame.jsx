import { useState, useEffect, useRef } from 'react'
import { GameLayout, BetChips, ResultBanner, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'

// ── Dot positions for each face ───────────────────────────────────────────────
// Each entry: array of [top%, left%] positions for dots
const DOT_POSITIONS = {
  1: [
    [50, 50],
  ],
  2: [
    [25, 75],
    [75, 25],
  ],
  3: [
    [25, 75],
    [50, 50],
    [75, 25],
  ],
  4: [
    [25, 25],
    [25, 75],
    [75, 25],
    [75, 75],
  ],
  5: [
    [25, 25],
    [25, 75],
    [50, 50],
    [75, 25],
    [75, 75],
  ],
  6: [
    [25, 25],
    [25, 75],
    [50, 25],
    [50, 75],
    [75, 25],
    [75, 75],
  ],
}

function DiceFace({ number, size = 160 }) {
  const dots = DOT_POSITIONS[number] ?? []
  const dotSize = Math.round(size * 0.1)

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.18,
        background: 'linear-gradient(145deg, #f9fafb, #e5e7eb)',
        position: 'relative',
        boxShadow: '0 0 32px rgba(255,255,255,0.12), inset 0 2px 4px rgba(255,255,255,0.8), 0 6px 24px rgba(0,0,0,0.5)',
        flexShrink: 0,
      }}
    >
      {dots.map(([top, left], i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            width: dotSize,
            height: dotSize,
            borderRadius: '50%',
            background: '#1f2937',
            top: `calc(${top}% - ${dotSize / 2}px)`,
            left: `calc(${left}% - ${dotSize / 2}px)`,
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)',
          }}
        />
      ))}
    </div>
  )
}

export default function DiceGame() {
  const { balance, play } = useCasino()

  const [guess, setGuess]           = useState(null)   // 1-6 | null
  const [phase, setPhase]           = useState('idle') // 'idle' | 'rolling' | 'result'
  const [displayNumber, setDisplayNumber] = useState(1)
  const [result, setResult]         = useState(null)   // 1-6 | null
  const [bet, setBet]               = useState(50)
  const [gameResult, setGameResult] = useState(null)   // 'win' | 'loss' | null
  const [wonAmount, setWonAmount]   = useState(0)
  const [error, setError]           = useState(null)

  const intervalRef = useRef(null)
  const timeoutRef  = useRef(null)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearInterval(intervalRef.current)
      clearTimeout(timeoutRef.current)
    }
  }, [])

  async function handleRoll() {
    if (!guess || !bet || phase === 'rolling') return

    setPhase('rolling')
    setResult(null)
    setGameResult(null)
    setWonAmount(0)
    setError(null)

    // Rapid cycling (cosmetic only — the real roll comes from the server).
    intervalRef.current = setInterval(() => {
      setDisplayNumber(Math.floor(Math.random() * 6) + 1)
    }, 80)

    // Ask the server for the outcome; animate toward it. Fail-closed on error.
    let o
    try {
      o = await play('dice', { p_bet: bet, p_guess: guess })
    } catch (e) {
      clearInterval(intervalRef.current)
      console.error('[DiceGame] play error:', e)
      setError('Roll failed — try again.')
      setPhase('idle')
      return
    }

    timeoutRef.current = setTimeout(() => {
      clearInterval(intervalRef.current)

      const rolled = o.roll
      const won    = o.win

      setResult(rolled)
      setDisplayNumber(rolled)
      setPhase('result')

      setGameResult(won ? 'win' : 'loss')
      setWonAmount(won ? bet * 4 : bet)
    }, 1500)
  }

  function handleNewGame() {
    setPhase('idle')
    setResult(null)
    setGameResult(null)
    setWonAmount(0)
    setError(null)
  }

  const isRolling = phase === 'rolling'
  const isResult  = phase === 'result'

  return (
    <GameLayout title="Dice Roll">
      <div className="flex flex-col items-center gap-8">

        {/* ── Dice visual ── */}
        <div className="flex flex-col items-center gap-3">
          <div
            style={{
              transform: isRolling ? `rotate(${Math.random() * 20 - 10}deg)` : 'rotate(0deg)',
              transition: 'transform 0.08s',
            }}
          >
            <DiceFace number={displayNumber} size={160} />
          </div>

          {isResult && (
            <p className="text-sm font-semibold text-cp-muted uppercase tracking-widest">
              Rolled: <span className="text-cp-text">{result}</span>
            </p>
          )}
          {isRolling && (
            <p className="text-sm text-cp-muted animate-pulse">Rolling…</p>
          )}
        </div>

        {/* ── Number picker ── */}
        <div className="w-full max-w-sm">
          <p className="text-sm text-cp-muted font-medium mb-3">Pick a number:</p>
          <div className="flex gap-2 justify-between">
            {[1, 2, 3, 4, 5, 6].map((n) => {
              const selected = guess === n
              return (
                <button
                  key={n}
                  onClick={() => {
                    if (isRolling) return
                    if (isResult) handleNewGame()
                    setGuess(n)
                  }}
                  disabled={isRolling}
                  className={`flex-1 aspect-square flex items-center justify-center rounded-xl border-2 font-bold text-lg transition-all
                    ${selected
                      ? 'border-amber-400 bg-amber-400/15 text-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.2)]'
                      : 'border-cp-border bg-cp-card text-cp-muted hover:border-amber-400/40 hover:text-cp-text'
                    }
                    ${isRolling ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  {n}
                </button>
              )
            })}
          </div>
          {guess && (
            <p className="text-center text-xs text-cp-muted mt-2">
              Guessing <span className="text-amber-400 font-semibold">{guess}</span> — payout 5x if correct
            </p>
          )}
        </div>

        {/* ── Bet chips ── */}
        <div className="w-full max-w-sm bg-cp-card border border-cp-border rounded-2xl p-4">
          <BetChips
            bet={bet}
            onBet={setBet}
            balance={balance ?? 0}
            disabled={isRolling}
          />
        </div>

        {/* ── Roll / Play Again button ── */}
        {phase !== 'result' ? (
          <button
            onClick={handleRoll}
            disabled={!guess || !bet || isRolling || (balance ?? 0) < bet}
            className={`w-full max-w-sm py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
              ${(!guess || !bet || isRolling || (balance ?? 0) < bet)
                ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                : 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_24px_rgba(251,191,36,0.3)] hover:shadow-[0_0_32px_rgba(251,191,36,0.45)] active:scale-95'
              }
            `}
          >
            {isRolling ? 'Rolling…' : 'Roll!'}
          </button>
        ) : (
          <button
            onClick={handleNewGame}
            className="w-full max-w-sm py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95"
          >
            Roll Again
          </button>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="w-full max-w-sm text-center rounded-xl border border-red-400/30 bg-red-400/10 py-2.5 px-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* ── Result banner ── */}
        <div className="w-full max-w-sm">
          <ResultBanner
            result={gameResult}
            amount={wonAmount}
            message={gameResult === 'win'
              ? `Rolled ${result} — jackpot! (5x)`
              : result !== null ? `Rolled ${result}, you guessed ${guess}` : null}
          />
        </div>

      </div>
    </GameLayout>
  )
}
