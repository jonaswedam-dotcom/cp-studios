import { useState, useEffect, useRef } from 'react'
import { GameLayout, BetChips, ResultBanner, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'

export default function CoinFlipGame() {
  const { balance, placeBet } = useCasino()

  const [choice, setChoice]         = useState(null)   // 'heads' | 'tails' | null
  const [phase, setPhase]           = useState('idle') // 'idle' | 'flipping' | 'result'
  const [result, setResult]         = useState(null)   // 'heads' | 'tails' | null
  const [bet, setBet]               = useState(50)
  const [gameResult, setGameResult] = useState(null)   // 'win' | 'loss' | null
  const [wonAmount, setWonAmount]   = useState(0)
  const [displayFace, setDisplayFace] = useState('H') // shown on coin during / after flip

  // Inject keyframe animation once
  useEffect(() => {
    const styleId = 'coin-flip-keyframes'
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = `
        @keyframes coinFlip {
          0%   { transform: rotateY(0deg); }
          50%  { transform: rotateY(90deg); }
          100% { transform: rotateY(720deg); }
        }
      `
      document.head.appendChild(style)
    }
    return () => {
      // leave style in DOM — safe to reuse
    }
  }, [])

  function handleFlip() {
    if (!choice || !bet || phase === 'flipping') return

    setPhase('flipping')
    setResult(null)
    setGameResult(null)
    setWonAmount(0)

    setTimeout(() => {
      const flipped = Math.random() > 0.5 ? 'heads' : 'tails'
      const won = flipped === choice

      setResult(flipped)
      setDisplayFace(flipped === 'heads' ? 'H' : 'T')
      setPhase('result')

      const winAmount = won ? bet : -bet
      setGameResult(won ? 'win' : 'loss')
      setWonAmount(won ? bet : bet)

      placeBet('coin-flip', bet, winAmount)
    }, 1100)
  }

  function handleNewGame() {
    setPhase('idle')
    setResult(null)
    setGameResult(null)
    setWonAmount(0)
    // keep choice so user doesn't have to re-select
  }

  const isFlipping = phase === 'flipping'
  const isResult   = phase === 'result'

  const coinFaceLabel = isResult ? (result === 'heads' ? 'H' : 'T') : (choice ? (choice === 'heads' ? 'H' : 'T') : '?')

  return (
    <GameLayout title="Coin Flip">
      <div className="flex flex-col items-center gap-8">

        {/* ── Coin ── */}
        <div className="flex flex-col items-center gap-3">
          <div
            style={{
              width: 160,
              height: 160,
              borderRadius: '50%',
              background: isResult
                ? (result === 'heads'
                    ? 'linear-gradient(135deg, #fbbf24, #d97706)'
                    : 'linear-gradient(135deg, #d1d5db, #9ca3af)')
                : 'linear-gradient(135deg, #fbbf24, #d97706)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 32px rgba(251,191,36,0.35), 0 4px 16px rgba(0,0,0,0.5)',
              animation: isFlipping ? 'coinFlip 1s ease-in-out' : 'none',
              fontSize: 72,
              fontWeight: 900,
              color: isResult && result === 'tails' ? '#374151' : '#78350f',
              userSelect: 'none',
              transformStyle: 'preserve-3d',
            }}
          >
            {coinFaceLabel}
          </div>

          {isResult && (
            <p className="text-sm font-semibold text-cp-muted uppercase tracking-widest">
              {result === 'heads' ? 'Heads' : 'Tails'}
            </p>
          )}
          {isFlipping && (
            <p className="text-sm text-cp-muted animate-pulse">Flipping…</p>
          )}
        </div>

        {/* ── Choice buttons ── */}
        <div className="flex gap-4 w-full max-w-sm">
          {[
            { value: 'heads', label: 'HEADS', icon: 'H' },
            { value: 'tails', label: 'TAILS', icon: 'T' },
          ].map(({ value, label, icon }) => {
            const selected = choice === value
            return (
              <button
                key={value}
                onClick={() => {
                  if (phase === 'idle') setChoice(value)
                  if (phase === 'result') {
                    handleNewGame()
                    setChoice(value)
                  }
                }}
                disabled={isFlipping}
                className={`flex-1 flex flex-col items-center justify-center gap-2 py-4 rounded-2xl border-2 font-bold text-sm tracking-wider transition-all
                  ${selected
                    ? 'border-amber-400 bg-amber-400/15 text-amber-400 shadow-[0_0_16px_rgba(251,191,36,0.2)]'
                    : 'border-cp-border bg-cp-card text-cp-muted hover:border-amber-400/40 hover:text-cp-text'
                  }
                  ${isFlipping ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                <span
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: value === 'heads'
                      ? 'linear-gradient(135deg, #fbbf24, #d97706)'
                      : 'linear-gradient(135deg, #d1d5db, #9ca3af)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 20,
                    fontWeight: 900,
                    color: value === 'heads' ? '#78350f' : '#374151',
                  }}
                >
                  {icon}
                </span>
                {label}
              </button>
            )
          })}
        </div>

        {/* ── Bet chips ── */}
        <div className="w-full max-w-sm bg-cp-card border border-cp-border rounded-2xl p-4">
          <BetChips
            bet={bet}
            onBet={setBet}
            balance={balance ?? 0}
            disabled={isFlipping}
          />
        </div>

        {/* ── Flip button ── */}
        {phase !== 'result' ? (
          <button
            onClick={handleFlip}
            disabled={!choice || !bet || isFlipping || (balance ?? 0) < bet}
            className={`w-full max-w-sm py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
              ${(!choice || !bet || isFlipping || (balance ?? 0) < bet)
                ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                : 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_24px_rgba(251,191,36,0.3)] hover:shadow-[0_0_32px_rgba(251,191,36,0.45)] active:scale-95'
              }
            `}
          >
            {isFlipping ? 'Flipping…' : 'Flip!'}
          </button>
        ) : (
          <button
            onClick={handleNewGame}
            className="w-full max-w-sm py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95"
          >
            Flip Again
          </button>
        )}

        {/* ── Result banner ── */}
        <div className="w-full max-w-sm">
          <ResultBanner
            result={gameResult}
            amount={wonAmount}
            message={gameResult === 'win'
              ? `${result === 'heads' ? 'Heads' : 'Tails'} — you called it!`
              : result ? `${result === 'heads' ? 'Heads' : 'Tails'} — better luck next time`
              : null}
          />
        </div>

      </div>
    </GameLayout>
  )
}
