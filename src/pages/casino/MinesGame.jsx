import { useState, useEffect, useRef, useCallback } from 'react'
import { GameLayout, BetChips, ResultBanner, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'

// ── Multiplier formula (5% house edge) ───────────────────────────────────────
function getMult(revealed, mines) {
  let m = 1.0
  for (let i = 0; i < revealed; i++) {
    m *= (25 - i) / (25 - mines - i)
  }
  // Floor at 1.01 so even 1-mine games always show a positive multiplier
  return +Math.max(1.01, m * 0.95).toFixed(2)
}

// ── Empty grid ────────────────────────────────────────────────────────────────
// Mine positions are hidden server-side; the client starts with an all-unknown
// grid and only learns cells as the server reveals them (safe on click, all mines
// on a bust/cash-out).
function emptyGrid() {
  return Array.from({ length: 25 }, () => ({ revealed: false, isMine: false }))
}

// ── Tile component ────────────────────────────────────────────────────────────
function Tile({ cell, index, onClick, disabled, revealDelay = 0 }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (cell.revealed) {
      const t = setTimeout(() => setVisible(true), revealDelay)
      return () => clearTimeout(t)
    } else {
      setVisible(false)
    }
  }, [cell.revealed, revealDelay])

  const isRevealedSafe = cell.revealed && !cell.isMine
  const isRevealedMine = cell.revealed && cell.isMine

  let bg, border, content, textColor

  if (!cell.revealed) {
    bg = 'bg-cp-elevated'
    border = 'border-cp-border hover:border-amber-400/40'
    content = null
    textColor = ''
  } else if (isRevealedSafe) {
    bg = 'bg-emerald-900/50'
    border = 'border-emerald-500/30'
    content = '💎'
    textColor = 'text-emerald-400'
  } else {
    bg = 'bg-red-900/50'
    border = 'border-red-500/30'
    content = '💣'
    textColor = 'text-red-400'
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled || cell.revealed}
      style={{
        width: 52,
        height: 52,
        transition: 'all 0.15s ease',
        opacity: cell.revealed && !visible ? 0 : 1,
        transform: cell.revealed && visible ? 'scale(1)' : cell.revealed ? 'scale(0.7)' : 'scale(1)',
      }}
      className={`
        rounded-lg border-2 flex items-center justify-center text-xl font-bold
        ${bg} ${border} ${textColor}
        ${!cell.revealed && !disabled ? 'hover:scale-105 active:scale-95 cursor-pointer hover:bg-cp-card' : ''}
        ${disabled && !cell.revealed ? 'cursor-not-allowed' : ''}
        transition-all duration-150
      `}
    >
      {cell.revealed && visible ? content : null}
    </button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function MinesGame() {
  const { balance, openRound, roundAction, cashoutRound } = useCasino()

  const [phase, setPhase]             = useState('setup')    // 'setup'|'playing'|'dead'|'cashedout'
  const [grid, setGrid]               = useState(emptyGrid)
  const [mineCount, setMineCount]     = useState(3)
  const [bet, setBet]                 = useState(50)
  const [safeRevealed, setSafeRevealed] = useState(0)
  const [gameResult, setGameResult]   = useState(null)
  const [wonAmount, setWonAmount]     = useState(0)
  const [roundId, setRoundId]         = useState(null)
  const [busy, setBusy]               = useState(false)
  const [error, setError]             = useState(null)

  const isSetup     = phase === 'setup'
  const isPlaying   = phase === 'playing'
  const isDead      = phase === 'dead'
  const isCashedOut = phase === 'cashedout'
  const isResult    = isDead || isCashedOut

  const safeTilesTotal = 25 - mineCount

  // Reveal every mine using the layout the server returns on a terminal event.
  function revealMineLayout(mines) {
    setGrid((prev) =>
      prev.map((cell, i) => (mines.includes(i) ? { ...cell, isMine: true, revealed: true } : cell))
    )
  }

  async function handleStart() {
    if ((balance ?? 0) < bet || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await openRound('mines', { p_bet: bet, p_mines: mineCount })
      setRoundId(r.round_id)
      setGrid(emptyGrid())
      setSafeRevealed(0)
      setGameResult(null)
      setWonAmount(0)
      setPhase('playing')
    } catch (e) {
      console.error('[MinesGame] open error:', e)
      setError('Could not start — try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleTileClick(index) {
    if (phase !== 'playing' || busy) return
    const cell = grid[index]
    if (cell.revealed) return

    setBusy(true)
    setError(null)
    try {
      const r = await roundAction('mines_reveal', { p_round: roundId, p_cell: index })

      if (r.hit) {
        // Hit a mine — mark the clicked cell, then reveal the full layout.
        setGrid((prev) => prev.map((c, i) => (i === index ? { ...c, isMine: true, revealed: true } : c)))
        setTimeout(() => revealMineLayout(r.mines), 300)
        setPhase('dead')
        setGameResult('loss')
        setWonAmount(bet)
      } else {
        // Safe tile.
        setGrid((prev) => prev.map((c, i) => (i === index ? { ...c, revealed: true } : c)))
        const newSafe = safeRevealed + 1
        setSafeRevealed(newSafe)

        if (newSafe === safeTilesTotal) {
          // Server auto-cashes when all safe tiles are revealed.
          const win = Math.floor(bet * (r.mult - 1))
          setPhase('cashedout')
          setGameResult('win')
          setWonAmount(win)
        }
      }
    } catch (e) {
      console.error('[MinesGame] reveal error:', e)
      setError('Reveal failed — try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleCashOut() {
    if (phase !== 'playing' || safeRevealed === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await cashoutRound('mines', roundId)
      const mult = r?.mult ?? getMult(safeRevealed, mineCount)
      const win = r?.payout != null
        ? Math.max(0, r.payout - bet)
        : Math.floor(bet * (mult - 1))
      if (r?.mines) revealMineLayout(r.mines)
      setPhase('cashedout')
      setGameResult('win')
      setWonAmount(win)
    } catch (e) {
      console.error('[MinesGame] cashout error:', e)
      setError('Cash out failed — try again.')
    } finally {
      setBusy(false)
    }
  }

  function handlePlayAgain() {
    setGrid(emptyGrid())
    setSafeRevealed(0)
    setGameResult(null)
    setWonAmount(0)
    setRoundId(null)
    setError(null)
    setPhase('setup')
  }

  const currentMult   = getMult(safeRevealed, mineCount)
  const nextMult      = getMult(safeRevealed + 1, mineCount)
  const cashoutCoins  = Math.floor(bet * (currentMult - 1))

  return (
    <GameLayout title="Mines">
      <div className="flex flex-col items-center gap-6">

        {/* ── Mine count & bet (setup) ── */}
        {isSetup && (
          <div className="w-full max-w-sm bg-cp-card border border-cp-border rounded-2xl p-4 flex flex-col gap-4">
            {/* Mine count selector */}
            <div>
              <p className="text-sm text-cp-muted font-medium mb-2">
                Mines: <span className="text-red-400 font-bold">{mineCount}</span>
              </p>
              <div className="flex gap-2">
                {[1, 3, 5, 7, 10].map((n) => (
                  <button
                    key={n}
                    onClick={() => setMineCount(n)}
                    className={`flex-1 py-2 rounded-lg border text-sm font-bold transition-all
                      ${mineCount === n
                        ? 'bg-red-400/20 border-red-400/60 text-red-400'
                        : 'bg-cp-elevated border-cp-border text-cp-muted hover:border-red-400/30 hover:text-cp-text'
                      }
                    `}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Bet chips */}
            <BetChips
              bet={bet}
              onBet={setBet}
              balance={balance ?? 0}
              disabled={false}
            />
          </div>
        )}

        {/* ── Multiplier info bar (playing) ── */}
        {isPlaying && (
          <div className="w-full max-w-sm flex items-center justify-between bg-cp-card border border-cp-border rounded-xl px-4 py-2.5 gap-4">
            <div className="text-sm">
              <span className="text-cp-muted">Next: </span>
              <span className="text-amber-400 font-bold">{nextMult}×</span>
            </div>
            <div className="text-sm text-center">
              <span className="text-cp-muted">
                {safeRevealed}/{safeTilesTotal} safe
              </span>
            </div>
            {safeRevealed > 0 && (
              <div className="text-sm text-right">
                <span className="text-emerald-400 font-bold">{formatCoins(cashoutCoins)}</span>
                <span className="text-cp-muted"> coins</span>
              </div>
            )}
          </div>
        )}

        {/* ── 5x5 Grid ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 52px)',
            gap: 8,
          }}
        >
          {grid.map((cell, i) => {
            // Stagger reveal delay for end-of-game mine reveal
            const isEndReveal = isResult && cell.isMine
            const delayMs = isEndReveal ? (i * 30) : 0

            return (
              <Tile
                key={i}
                cell={cell}
                index={i}
                onClick={() => handleTileClick(i)}
                disabled={!isPlaying || busy}
                revealDelay={delayMs}
              />
            )
          })}
        </div>

        {/* ── Mine count badge (playing) ── */}
        {isPlaying && (
          <div className="flex items-center gap-2 text-sm text-cp-muted">
            <span>💣</span>
            <span>
              <span className="text-red-400 font-bold">{mineCount}</span> mines hidden
            </span>
          </div>
        )}

        {/* ── Action buttons ── */}
        <div className="w-full max-w-sm flex flex-col gap-3">
          {isSetup && (
            <button
              onClick={handleStart}
              disabled={(balance ?? 0) < bet || busy}
              className={`w-full py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
                ${(balance ?? 0) < bet || busy
                  ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                  : 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_24px_rgba(251,191,36,0.3)] hover:shadow-[0_0_32px_rgba(251,191,36,0.45)] active:scale-95'
                }
              `}
            >
              {busy ? 'Starting…' : 'Start Game'}
            </button>
          )}

          {isPlaying && (
            <button
              onClick={handleCashOut}
              disabled={safeRevealed === 0 || busy}
              className={`w-full py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
                ${safeRevealed === 0 || busy
                  ? 'bg-cp-elevated border border-cp-border text-cp-muted cursor-not-allowed opacity-40'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_16px_rgba(52,211,153,0.25)] hover:shadow-[0_0_24px_rgba(52,211,153,0.4)] active:scale-95'
                }
              `}
            >
              {safeRevealed > 0
                ? `Cash Out — ${formatCoins(cashoutCoins)} coins (${currentMult}×)`
                : 'Reveal a tile first'
              }
            </button>
          )}

          {isResult && (
            <button
              onClick={handlePlayAgain}
              className="w-full py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95"
            >
              Play Again
            </button>
          )}

          {error && (
            <div className="text-center rounded-xl border border-red-400/30 bg-red-400/10 py-2.5 px-4 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* ── Result banner ── */}
        {isResult && (
          <div className="w-full max-w-sm">
            <ResultBanner
              result={gameResult}
              amount={wonAmount}
              message={
                isDead
                  ? `Hit a mine with ${safeRevealed} safe tiles revealed`
                  : safeRevealed === safeTilesTotal
                  ? 'All safe tiles found!'
                  : `Cashed out at ${currentMult}× (${safeRevealed} tiles)`
              }
            />
          </div>
        )}

      </div>
    </GameLayout>
  )
}
