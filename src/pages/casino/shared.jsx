import { useNavigate } from 'react-router-dom'
import { useCasino } from '../../context/CasinoContext'

// ── Helper ────────────────────────────────────────────────────────────────────
export function formatCoins(n) {
  return n.toLocaleString()
}

// ── DailyBonusToast ───────────────────────────────────────────────────────────
function DailyBonusToast({ amount }) {
  if (!amount) return null
  return (
    <div
      className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5
        bg-amber-400 text-black font-bold text-sm px-5 py-3 rounded-2xl
        shadow-[0_4px_24px_rgba(251,191,36,0.45)]"
      style={{ animation: 'bonusSlideIn 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards' }}
    >
      <span className="text-lg">🎁</span>
      Daily bonus: +{formatCoins(amount)} coins!
      <style>{`
        @keyframes bonusSlideIn {
          from { opacity: 0; transform: translateX(-50%) translateY(-12px) scale(0.92); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0)      scale(1);    }
        }
      `}</style>
    </div>
  )
}

// ── GameLayout ────────────────────────────────────────────────────────────────
export function GameLayout({ title, children }) {
  const navigate = useNavigate()
  const { balance, dailyBonusAmount } = useCasino()

  return (
    <div className="min-h-screen bg-cp-bg">
      <DailyBonusToast amount={dailyBonusAmount} />

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/casino')}
              className="flex items-center justify-center w-9 h-9 rounded-xl border border-cp-border bg-cp-card hover:bg-cp-elevated transition-colors text-cp-muted hover:text-cp-text"
              aria-label="Back to Casino"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-5 h-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            <h1 className="text-xl font-bold text-cp-text">{title}</h1>
          </div>

          {/* Balance display */}
          <div className="flex items-center gap-2 bg-cp-card border border-cp-border rounded-xl px-3 py-1.5">
            <span className="text-amber-400 text-base">🪙</span>
            <span className="text-amber-400 font-semibold text-sm">
              {balance !== null ? formatCoins(balance) : '—'} coins
            </span>
          </div>
        </div>

        {/* Page content */}
        {children}
      </div>
    </div>
  )
}

// ── BetChips ──────────────────────────────────────────────────────────────────
const PRESET_AMOUNTS = [10, 25, 50, 100, 250]

export function BetChips({ bet, onBet, balance, disabled }) {
  const validPresets = PRESET_AMOUNTS.filter((p) => p <= balance)

  function handleCustom(e) {
    const raw = parseInt(e.target.value, 10)
    if (isNaN(raw)) return
    const clamped = Math.min(Math.max(1, raw), balance)
    onBet(clamped)
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-cp-muted font-medium">
        Bet:{' '}
        <span className="text-amber-400 font-semibold">{formatCoins(bet)} coins</span>
      </p>

      {/* Chip buttons */}
      <div className="flex flex-wrap gap-2">
        {validPresets.map((preset) => (
          <button
            key={preset}
            onClick={() => onBet(preset)}
            disabled={disabled}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all
              ${bet === preset
                ? 'bg-amber-400 border-amber-400 text-black'
                : 'bg-cp-card border-cp-border text-cp-muted hover:border-amber-400/50 hover:text-cp-text'
              }
              ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            {formatCoins(preset)}
          </button>
        ))}

        {/* MAX button */}
        {balance > 0 && (
          <button
            onClick={() => onBet(balance)}
            disabled={disabled}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all
              ${bet === balance
                ? 'bg-amber-400 border-amber-400 text-black'
                : 'bg-cp-card border-cp-border text-cp-muted hover:border-amber-400/50 hover:text-cp-text'
              }
              ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            MAX
          </button>
        )}
      </div>

      {/* Custom amount input */}
      <input
        type="number"
        min={1}
        max={balance}
        value={bet}
        onChange={handleCustom}
        disabled={disabled}
        className={`w-full bg-cp-card border border-cp-border rounded-xl px-4 py-2.5 text-sm text-cp-text
          placeholder:text-cp-muted focus:border-amber-400/60 focus:ring-0 transition-colors
          [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
          ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
        `}
        placeholder="Custom amount…"
      />
    </div>
  )
}

// ── ResultBanner ──────────────────────────────────────────────────────────────
export function ResultBanner({ result, amount, message }) {
  if (!result) return null

  const config = {
    win: {
      color: 'text-emerald-400',
      bg: 'bg-emerald-400/10 border-emerald-400/25',
      label: `+${formatCoins(amount)} coins 🎉`,
    },
    loss: {
      color: 'text-red-400',
      bg: 'bg-red-400/10 border-red-400/25',
      label: `-${formatCoins(amount)} coins`,
    },
    push: {
      color: 'text-cp-muted',
      bg: 'bg-cp-elevated border-cp-border',
      label: 'Push — bet returned',
    },
  }

  const { color, bg, label } = config[result] ?? config.push

  return (
    <div
      className={`mt-4 rounded-xl border px-5 py-3 text-center transition-opacity duration-300 ${bg}`}
      style={{ animation: 'fadeInResult 0.3s ease forwards' }}
    >
      <p className={`text-lg font-bold ${color}`}>{label}</p>
      {message && <p className="text-sm text-cp-muted mt-0.5">{message}</p>}

      <style>{`
        @keyframes fadeInResult {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
