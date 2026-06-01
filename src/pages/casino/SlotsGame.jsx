import { useState, useEffect, useRef } from 'react'
import { GameLayout, BetChips, ResultBanner } from './shared'
import { useCasino } from '../../context/CasinoContext'
import {
  SYMBOLS, PAYTABLE, REELS, ROWS,
  drawSymbol, spinGrid, evaluateGrid, netForBet,
} from './slotsEngine'

// Per-column stop times (ms), left → right.
const STOP_TIMES = [1000, 1300, 1600, 1900, 2200]

const cellKey = (r, c) => `${r}-${c}`

// A calm, non-winning starting grid.
function initialGrid() {
  return Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: REELS }, (_, c) => (r + c) % SYMBOLS.length)
  )
}

function describe(lines, totalReturn) {
  if (lines.length === 0) return 'No win'
  // 1× is the minimum payout (cherry/lemon ×3), so totalReturn === 1 is exactly one push line.
  if (totalReturn === 1) return 'Push — 3 of a kind, bet returned'
  if (lines.length === 1) {
    const l = lines[0]
    return `${SYMBOLS[l.symbol]} ×${l.runLength} — ${l.multiplier}× line`
  }
  return `${lines.length} winning lines · ${totalReturn}× total`
}

function Cell({ symbolIdx, spinning, highlight }) {
  return (
    <div
      className="flex items-center justify-center border bg-cp-bg rounded-lg overflow-hidden"
      style={{
        height: 56,
        borderColor: highlight ? 'rgba(52,211,153,0.7)' : 'rgba(251,191,36,0.2)',
        boxShadow: highlight
          ? '0 0 14px rgba(52,211,153,0.55) inset, 0 0 8px rgba(52,211,153,0.5)'
          : spinning
            ? '0 0 10px rgba(251,191,36,0.2) inset'
            : '0 0 6px rgba(0,0,0,0.4) inset',
        transition: 'box-shadow 0.25s, border-color 0.25s',
      }}
    >
      <span
        style={{
          fontSize: 32,
          lineHeight: 1,
          display: 'block',
          animation: spinning ? 'slotReelBlur 0.08s linear infinite' : 'none',
          filter: spinning ? 'blur(1px)' : 'none',
          transition: spinning ? 'none' : 'filter 0.2s',
          userSelect: 'none',
        }}
      >
        {SYMBOLS[symbolIdx]}
      </span>
    </div>
  )
}

export default function SlotsGame() {
  const { balance, placeBet } = useCasino()

  const [grid, setGrid] = useState(initialGrid)
  const [spinningCols, setSpinningCols] = useState(Array(REELS).fill(false))
  const [phase, setPhase] = useState('idle') // 'idle' | 'spinning' | 'result'
  const [bet, setBet] = useState(50)
  const [gameResult, setGameResult] = useState(null) // 'win' | 'loss' | 'push' | null
  const [resultAmount, setResultAmount] = useState(0)
  const [resultLabel, setResultLabel] = useState('')
  const [winCells, setWinCells] = useState(() => new Set())

  const intervalRefs = useRef(Array(REELS).fill(null))
  const timeoutRefs = useRef([])

  // Inject the reel-blur keyframes once.
  useEffect(() => {
    const id = 'slots-reel-keyframes'
    if (!document.getElementById(id)) {
      const style = document.createElement('style')
      style.id = id
      style.textContent =
        '@keyframes slotReelBlur {0%{transform:translateY(-5px)}50%{transform:translateY(5px)}100%{transform:translateY(-5px)}}'
      document.head.appendChild(style)
    }
  }, [])

  // Cleanup on unmount.
  useEffect(() => () => {
    intervalRefs.current.forEach((id) => id && clearInterval(id))
    timeoutRefs.current.forEach((id) => clearTimeout(id))
  }, [])

  function resolveSpin(finalGrid) {
    const { totalReturn, lines } = evaluateGrid(finalGrid)
    const net = netForBet(totalReturn, bet)
    const result = totalReturn === 0 ? 'loss' : totalReturn === 1 ? 'push' : 'win'

    const cells = new Set()
    lines.forEach((l) => l.cells.forEach(([r, c]) => cells.add(cellKey(r, c))))
    setWinCells(cells)

    setGameResult(result)
    setResultAmount(result === 'loss' ? bet : net)
    setResultLabel(describe(lines, totalReturn))
    setPhase('result')
    placeBet('slots', bet, net)
  }

  function handleSpin() {
    if (phase === 'spinning') return

    setPhase('spinning')
    setGameResult(null)
    setResultAmount(0)
    setResultLabel('')
    setWinCells(new Set())
    timeoutRefs.current = [] // prior spin's timeouts have all fired by now

    const finalGrid = spinGrid()
    setSpinningCols(Array(REELS).fill(true))

    // Each column cycles its 3 cells with random symbols.
    for (let col = 0; col < REELS; col++) {
      intervalRefs.current[col] = setInterval(() => {
        setGrid((prev) => {
          const next = prev.map((row) => [...row])
          for (let r = 0; r < ROWS; r++) next[r][col] = drawSymbol()
          return next
        })
      }, 80)
    }

    // Stop columns left → right, then resolve after the last one.
    STOP_TIMES.forEach((stopTime, col) => {
      const t = setTimeout(() => {
        clearInterval(intervalRefs.current[col])
        intervalRefs.current[col] = null
        setGrid((prev) => {
          const next = prev.map((row) => [...row])
          for (let r = 0; r < ROWS; r++) next[r][col] = finalGrid[r][col]
          return next
        })
        setSpinningCols((prev) => {
          const next = [...prev]
          next[col] = false
          return next
        })
        if (col === REELS - 1) {
          const t2 = setTimeout(() => resolveSpin(finalGrid), 250)
          timeoutRefs.current.push(t2)
        }
      }, stopTime)
      timeoutRefs.current.push(t)
    })
  }

  function handleNewGame() {
    setPhase('idle')
    setGameResult(null)
    setResultAmount(0)
    setResultLabel('')
    setWinCells(new Set())
  }

  const isSpinning = phase === 'spinning'

  return (
    <GameLayout title="Slots">
      <div className="flex flex-col items-center gap-8">

        {/* ── Slot machine frame ── */}
        <div
          className="w-full max-w-xl rounded-2xl border-2 border-amber-400/30 bg-cp-card p-5"
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

          {/* 5 reels × 3 rows */}
          <div className="flex gap-2">
            {Array.from({ length: REELS }, (_, col) => (
              <div key={col} className="flex-1 flex flex-col gap-2">
                {Array.from({ length: ROWS }, (_, row) => (
                  <Cell
                    key={row}
                    symbolIdx={grid[row][col]}
                    spinning={spinningCols[col]}
                    highlight={winCells.has(cellKey(row, col))}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* Payline hint */}
          <div className="flex items-center justify-center mt-4 gap-2">
            <div className="h-px flex-1 bg-amber-400/15" />
            <span className="text-cp-muted text-xs">5 PAYLINES · 3+ FROM LEFT</span>
            <div className="h-px flex-1 bg-amber-400/15" />
          </div>
        </div>

        {/* ── Paytable ── */}
        <div className="w-full max-w-xl bg-cp-card border border-cp-border rounded-2xl p-4">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs text-cp-muted font-semibold uppercase tracking-wider">Paytable</p>
            <p className="text-xs text-cp-muted">× your bet · wins stack</p>
          </div>
          <div className="grid grid-cols-4 gap-x-2 gap-y-1 text-xs">
            <span className="text-cp-muted/70 font-semibold">Symbol</span>
            <span className="text-cp-muted/70 font-semibold text-right">3×</span>
            <span className="text-cp-muted/70 font-semibold text-right">4×</span>
            <span className="text-cp-muted/70 font-semibold text-right">5×</span>
            {SYMBOLS.map((sym, i) => (
              <Row key={i} sym={sym} pay={PAYTABLE[i]} />
            ))}
          </div>
          <p className="mt-3 pt-3 border-t border-cp-border text-xs text-cp-muted">
            3 🍒/🍋 returns your bet (push). 💎 is the rarest — biggest payouts.
          </p>
        </div>

        {/* ── Bet chips ── */}
        <div className="w-full max-w-xl bg-cp-card border border-cp-border rounded-2xl p-4">
          <BetChips bet={bet} onBet={setBet} balance={balance ?? 0} disabled={isSpinning} />
        </div>

        {/* ── Spin / Play Again ── */}
        {phase !== 'result' ? (
          <button
            onClick={handleSpin}
            disabled={!bet || isSpinning || (balance ?? 0) < bet}
            className={`w-full max-w-xl py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
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
            className="w-full max-w-xl py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95"
          >
            Spin Again
          </button>
        )}

        {/* ── Result banner ── */}
        <div className="w-full max-w-xl">
          <ResultBanner result={gameResult} amount={resultAmount} message={resultLabel || null} />
        </div>

      </div>
    </GameLayout>
  )
}

function Row({ sym, pay }) {
  return (
    <>
      <span className="text-cp-text">{sym}</span>
      <span className="text-amber-400 text-right">{pay[3]}×</span>
      <span className="text-amber-400 text-right">{pay[4]}×</span>
      <span className="text-amber-400 text-right">{pay[5]}×</span>
    </>
  )
}
