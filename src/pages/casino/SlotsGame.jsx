import { useState, useEffect, useRef } from 'react'
import { GameLayout, BetChips, ResultBanner, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'

const SYMBOLS  = ['🍒', '🍋', '7️⃣', '⭐', '💎']
const WEIGHTS  = [5, 4, 3, 2, 1]  // sum = 15
const WEIGHT_TOTAL = WEIGHTS.reduce((a, b) => a + b, 0)

function weightedRandom() {
  let r = Math.random() * WEIGHT_TOTAL
  for (let i = 0; i < SYMBOLS.length; i++) {
    r -= WEIGHTS[i]
    if (r <= 0) return SYMBOLS[i]
  }
  return SYMBOLS[0]
}

function calcPayout(reels, bet) {
  const [a, b, c] = reels
  if (a === b && b === c) {
    // 3 match → 10x
    return { type: 'triple', winAmount: bet * 9, gameResult: 'win', label: '3 of a kind! 10×' }
  }
  if (a === b || b === c || a === c) {
    // 2 match → 1.5x (get 0.5x profit)
    const profit = Math.floor(bet * 0.5)
    return { type: 'pair', winAmount: profit, gameResult: 'win', label: '2 of a kind! 1.5×' }
  }
  return { type: 'miss', winAmount: -bet, gameResult: 'loss', label: 'No match' }
}

// Individual reel component
function Reel({ symbol, spinning, idx }) {
  return (
    <div
      className="flex-1 flex items-center justify-center border-2 border-amber-400/30 bg-cp-bg rounded-xl overflow-hidden"
      style={{
        height: 120,
        boxShadow: spinning
          ? '0 0 16px rgba(251,191,36,0.25) inset'
          : '0 0 8px rgba(0,0,0,0.4) inset',
        transition: 'box-shadow 0.3s',
      }}
    >
      <span
        style={{
          fontSize: 56,
          lineHeight: 1,
          display: 'block',
          animation: spinning ? 'reelBlur 0.08s linear infinite' : 'none',
          filter: spinning ? 'blur(1px)' : 'none',
          transition: spinning ? 'none' : 'filter 0.2s',
          userSelect: 'none',
        }}
      >
        {symbol}
      </span>
    </div>
  )
}

export default function SlotsGame() {
  const { balance, placeBet } = useCasino()

  const [reels, setReels]           = useState(['🍒', '🍒', '🍒'])
  const [spinning, setSpinning]     = useState([false, false, false])
  const [phase, setPhase]           = useState('idle') // 'idle' | 'spinning' | 'result'
  const [bet, setBet]               = useState(50)
  const [gameResult, setGameResult] = useState(null)   // 'win' | 'loss' | null
  const [wonAmount, setWonAmount]   = useState(0)
  const [resultLabel, setResultLabel] = useState('')

  const intervalRefs = useRef([null, null, null])
  const timeoutRefs  = useRef([])

  // Inject reel animation keyframes once
  useEffect(() => {
    const styleId = 'slots-reel-keyframes'
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = `
        @keyframes reelBlur {
          0%   { transform: translateY(-4px); }
          50%  { transform: translateY(4px); }
          100% { transform: translateY(-4px); }
        }
      `
      document.head.appendChild(style)
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      intervalRefs.current.forEach((id) => clearInterval(id))
      timeoutRefs.current.forEach((id) => clearTimeout(id))
    }
  }, [])

  function handleSpin() {
    if (phase === 'spinning') return

    setPhase('spinning')
    setGameResult(null)
    setWonAmount(0)
    setResultLabel('')

    // Determine final results upfront
    const finalReels = [weightedRandom(), weightedRandom(), weightedRandom()]

    // Start all three reels spinning
    setSpinning([true, true, true])
    intervalRefs.current.forEach((_, i) => {
      intervalRefs.current[i] = setInterval(() => {
        setReels((prev) => {
          const next = [...prev]
          next[i] = weightedRandom()
          return next
        })
      }, 80)
    })

    // Stop reels one by one
    const stopTimes = [1200, 1800, 2400]

    stopTimes.forEach((stopTime, reelIdx) => {
      const t = setTimeout(() => {
        clearInterval(intervalRefs.current[reelIdx])
        setReels((prev) => {
          const next = [...prev]
          next[reelIdx] = finalReels[reelIdx]
          return next
        })
        setSpinning((prev) => {
          const next = [...prev]
          next[reelIdx] = false
          return next
        })

        // After last reel stops
        if (reelIdx === 2) {
          const t2 = setTimeout(() => {
            const { winAmount, gameResult: gr, label } = calcPayout(finalReels, bet)
            setGameResult(gr)
            setWonAmount(gr === 'win' ? winAmount : bet)
            setResultLabel(label)
            setPhase('result')
            placeBet('slots', bet, winAmount)
          }, 200)
          timeoutRefs.current.push(t2)
        }
      }, stopTime)
      timeoutRefs.current.push(t)
    })
  }

  function handleNewGame() {
    setPhase('idle')
    setGameResult(null)
    setWonAmount(0)
    setResultLabel('')
  }

  const isSpinning = phase === 'spinning'

  return (
    <GameLayout title="Slots">
      <div className="flex flex-col items-center gap-8">

        {/* ── Slot machine frame ── */}
        <div
          className="w-full max-w-sm rounded-2xl border-2 border-amber-400/30 bg-cp-card p-5"
          style={{
            boxShadow: isSpinning
              ? '0 0 40px rgba(251,191,36,0.25), 0 0 80px rgba(251,191,36,0.1)'
              : '0 0 20px rgba(0,0,0,0.4)',
            transition: 'box-shadow 0.4s',
          }}
        >
          {/* Machine top decoration */}
          <div className="flex items-center justify-center mb-4 gap-2">
            <div className="h-px flex-1 bg-amber-400/20" />
            <span className="text-amber-400 text-xs font-bold tracking-[0.2em] uppercase">CP Slots</span>
            <div className="h-px flex-1 bg-amber-400/20" />
          </div>

          {/* Reels */}
          <div className="flex gap-3">
            {reels.map((symbol, i) => (
              <Reel key={i} symbol={symbol} spinning={spinning[i]} idx={i} />
            ))}
          </div>

          {/* Payline indicator */}
          <div className="flex items-center justify-center mt-4 gap-2">
            <div className="h-px flex-1 bg-amber-400/15" />
            <span className="text-cp-muted text-xs">PAYLINE</span>
            <div className="h-px flex-1 bg-amber-400/15" />
          </div>
        </div>

        {/* ── Paytable hint ── */}
        <div className="w-full max-w-sm bg-cp-card border border-cp-border rounded-2xl p-4">
          <p className="text-xs text-cp-muted font-semibold uppercase tracking-wider mb-2">Paytable</p>
          <div className="space-y-1 text-xs text-cp-muted">
            <div className="flex justify-between">
              <span>3 of a kind</span>
              <span className="text-emerald-400 font-semibold">10× payout</span>
            </div>
            <div className="flex justify-between">
              <span>2 of a kind</span>
              <span className="text-amber-400 font-semibold">1.5× payout</span>
            </div>
            <div className="flex justify-between">
              <span>No match</span>
              <span className="text-red-400 font-semibold">Lose bet</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-cp-border flex justify-between items-center text-xs text-cp-muted">
            <span>Rarest symbol</span>
            <span>💎 Diamond</span>
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
            disabled={!bet || isSpinning || (balance ?? 0) < bet}
            className={`w-full max-w-sm py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
              ${(!bet || isSpinning || (balance ?? 0) < bet)
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
            message={resultLabel || null}
          />
        </div>

      </div>
    </GameLayout>
  )
}
