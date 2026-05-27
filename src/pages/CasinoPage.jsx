import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'
import { useApp } from '../context/AppContext'
import { useCasino } from '../context/CasinoContext'

// ── Game catalogue ────────────────────────────────────────────────────────────
const GAMES = [
  {
    route:       '/casino/coin-flip',
    emoji:       '🪙',
    name:        'Coin Flip',
    description: '50/50 shot — double or nothing',
  },
  {
    route:       '/casino/dice',
    emoji:       '🎲',
    name:        'Dice Roll',
    description: 'Pick a number, win 5×',
  },
  {
    route:       '/casino/roulette',
    emoji:       '🎡',
    name:        'Roulette',
    description: 'Red, black, or your lucky number',
  },
  {
    route:       '/casino/blackjack',
    emoji:       '🃏',
    name:        'Blackjack',
    description: 'Beat the dealer to 21',
  },
  {
    route:       '/casino/slots',
    emoji:       '🎰',
    name:        'Slots',
    description: 'Spin for matching symbols',
  },
  {
    route:       '/casino/aviator',
    emoji:       '✈️',
    name:        'Aviator',
    description: 'Cash out before the crash',
  },
  {
    route:       '/casino/chicken-road',
    emoji:       '🐔',
    name:        'Chicken Road',
    description: 'Cross the road, multiply or die',
  },
  {
    route:       '/casino/mines',
    emoji:       '💣',
    name:        'Mines',
    description: 'Avoid the mines, cash out anytime',
  },
]

// ── DonateModal ───────────────────────────────────────────────────────────────
function DonateModal({ recipient, senderBalance, onClose, onDonate }) {
  const [rawAmount, setRawAmount] = useState('')
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)

  const parsed  = parseInt(rawAmount, 10)
  const isValid = !isNaN(parsed) && parsed >= 1 && parsed <= senderBalance

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleConfirm() {
    if (isNaN(parsed) || parsed < 1) {
      setError('Enter a valid amount (minimum 1 coin)')
      return
    }
    if (parsed > senderBalance) {
      setError(`You only have ${senderBalance.toLocaleString()} coins`)
      return
    }

    setLoading(true)
    setError('')

    const { error: rpcErr } = await supabase.rpc('donate_coins', {
      p_recipient_id: recipient.user_id,
      p_amount:       parsed,
    })

    if (rpcErr) {
      setError(rpcErr.message || 'Donation failed — please try again')
      setLoading(false)
      return
    }

    onDonate(parsed)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.72)' }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative bg-cp-card border border-cp-border rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-cp-text">Send Coins 🪙</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-cp-muted hover:text-cp-text hover:bg-cp-elevated transition-colors"
          >
            ✕
          </button>
        </div>

        <p className="text-sm text-cp-muted mb-4">
          Donating to{' '}
          <span className="text-amber-400 font-semibold">{recipient.displayName}</span>
        </p>

        {/* Amount */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-cp-muted uppercase tracking-wider mb-1.5">
            Amount
          </label>
          <input
            type="number"
            min={1}
            max={senderBalance}
            value={rawAmount}
            onChange={e => { setRawAmount(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && isValid && handleConfirm()}
            placeholder="0"
            autoFocus
            className="w-full bg-cp-elevated border border-cp-border rounded-xl px-4 py-2.5 text-base text-cp-text font-semibold
              focus:border-amber-400/60 focus:outline-none transition-colors
              [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <p className="text-xs text-cp-muted mt-1.5">
            Your balance:{' '}
            <span className="text-amber-400 font-semibold">{senderBalance.toLocaleString()} coins</span>
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-red-400/10 border border-red-400/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-cp-border bg-cp-elevated text-cp-muted hover:text-cp-text hover:bg-cp-card font-semibold text-sm transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || !rawAmount}
            className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all
              ${loading || !rawAmount
                ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                : 'bg-amber-400 hover:bg-amber-300 text-black active:scale-95'
              }
            `}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-black/40 border-t-black rounded-full animate-spin inline-block" />
                Sending…
              </span>
            ) : (
              `Send${rawAmount && !isNaN(parsed) ? ` ${parsed.toLocaleString()}` : ''} coins`
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
function LeaderboardSection() {
  const { currentUser }        = useApp()
  const { balance, loadBalance } = useCasino()
  const [entries, setEntries]    = useState([])
  const [lbLoading, setLbLoading] = useState(true)
  const [donateTarget, setDonateTarget] = useState(null)   // entry | null
  const [successMsg, setSuccessMsg]     = useState('')      // '' | "You donated…"
  const successTimerRef = useRef(null)

  // Stable fetch function — re-created only when currentUser changes
  const fetchLeaderboard = useCallback(async () => {
    setLbLoading(true)

    const [walletsRes, profilesRes] = await Promise.all([
      supabase
        .from('wallets')
        .select('user_id, balance')
        .order('balance', { ascending: false })
        .limit(10),
      supabase
        .from('profiles')
        .select('user_id, full_name'),
    ])

    const wallets  = walletsRes.data  ?? []
    const profiles = profilesRes.data ?? []

    const nameMap = {}
    for (const p of profiles) nameMap[p.user_id] = p.full_name

    setEntries(wallets.map(w => ({
      user_id:     w.user_id,
      balance:     w.balance,
      displayName: nameMap[w.user_id]
        ?? (w.user_id === currentUser?.id ? currentUser?.name : null)
        ?? 'Player',
    })))
    setLbLoading(false)
  }, [currentUser?.id, currentUser?.name])

  useEffect(() => {
    fetchLeaderboard()
  }, [fetchLeaderboard])

  // Cleanup success timer on unmount
  useEffect(() => () => clearTimeout(successTimerRef.current), [])

  // Called by DonateModal on successful transfer
  async function handleDonate(amount) {
    const recipientName = donateTarget?.displayName ?? 'player'
    setDonateTarget(null)

    clearTimeout(successTimerRef.current)
    setSuccessMsg(`You sent ${amount.toLocaleString()} coins to ${recipientName}! 🎉`)
    successTimerRef.current = setTimeout(() => setSuccessMsg(''), 4000)

    // Refresh both local balance and leaderboard rankings
    await Promise.all([loadBalance(), fetchLeaderboard()])
  }

  const rankMeta = [
    { emoji: '🥇', color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/20' },
    { emoji: '🥈', color: 'text-slate-300', bg: 'bg-slate-300/10 border-slate-300/20' },
    { emoji: '🥉', color: 'text-amber-600', bg: 'bg-amber-600/10 border-amber-600/20' },
  ]

  return (
    <section className="mt-12">
      <h2 className="text-xl font-bold text-cp-text mb-4">🏆 Leaderboard</h2>

      {/* Donation success banner */}
      {successMsg && (
        <div
          className="mb-4 flex items-center gap-2 bg-emerald-400/10 border border-emerald-400/25 rounded-xl px-4 py-3 text-emerald-400 font-semibold text-sm"
          style={{ animation: 'fadeInResult 0.3s ease forwards' }}
        >
          <span>💸</span>
          {successMsg}
        </div>
      )}

      {lbLoading ? (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-cp-muted text-sm text-center py-8">No players yet — be the first!</p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, idx) => {
            const meta    = rankMeta[idx]
            const isSelf  = entry.user_id === currentUser?.id
            const canDonate = !isSelf && (balance ?? 0) > 0

            return (
              <div
                key={entry.user_id}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors
                  ${meta ? meta.bg : 'bg-cp-card border-cp-border'}
                `}
              >
                {/* Rank badge */}
                <div className="w-8 flex-shrink-0 text-center">
                  {meta ? (
                    <span className="text-xl">{meta.emoji}</span>
                  ) : (
                    <span className="text-sm font-bold text-cp-muted">#{idx + 1}</span>
                  )}
                </div>

                {/* Display name */}
                <span
                  className={`flex-1 font-semibold text-sm truncate
                    ${meta ? meta.color : 'text-cp-text'}
                  `}
                >
                  {entry.displayName}
                  {isSelf && (
                    <span className="ml-1.5 text-xs text-cp-muted font-normal">(you)</span>
                  )}
                </span>

                {/* Balance */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-amber-400 text-sm">🪙</span>
                  <span className={`text-sm font-bold tabular-nums ${meta ? meta.color : 'text-cp-muted'}`}>
                    {entry.balance.toLocaleString()}
                  </span>
                </div>

                {/* Donate button — hidden for self */}
                {canDonate && (
                  <button
                    onClick={() => setDonateTarget(entry)}
                    className="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-lg
                      border border-amber-400/30 text-amber-400
                      hover:bg-amber-400/10 hover:border-amber-400/60
                      transition-all active:scale-95"
                  >
                    Give
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Donate modal */}
      {donateTarget && (
        <DonateModal
          recipient={donateTarget}
          senderBalance={balance ?? 0}
          onClose={() => setDonateTarget(null)}
          onDonate={handleDonate}
        />
      )}
    </section>
  )
}

// ── Daily bonus toast ─────────────────────────────────────────────────────────
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
      Daily bonus: +{amount.toLocaleString()} coins!
      <style>{`
        @keyframes bonusSlideIn {
          from { opacity: 0; transform: translateX(-50%) translateY(-12px) scale(0.92); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0)      scale(1);    }
        }
      `}</style>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CasinoPage() {
  const { balance, claimRefill, canClaimRefill, dailyBonusAmount } = useCasino()
  const [refillClaimed, setRefillClaimed] = useState(false)

  async function handleRefill() {
    await claimRefill()
    setRefillClaimed(true)
  }

  const showRefillButton = balance === 0 && canClaimRefill()
  const showOutOfRefills  = balance === 0 && !canClaimRefill()

  return (
    <div className="min-h-screen bg-cp-bg page-in">
      <DailyBonusToast amount={dailyBonusAmount} />
      <div className="max-w-4xl mx-auto px-4 py-10">

        {/* ── Header ── */}
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-cp-text tracking-tight">Casino</h1>
          <p className="text-cp-muted mt-1 text-sm">
            All fun, all fake — play responsibly 🎰
          </p>
        </div>

        {/* ── Balance card ── */}
        <div className="bg-cp-card border border-cp-border rounded-2xl p-6 mb-8 text-center">
          <p className="text-cp-muted text-sm mb-2 uppercase tracking-widest text-xs font-semibold">
            Your Balance
          </p>
          <div className="flex items-center justify-center gap-3 mb-1">
            <span className="text-4xl">🪙</span>
            <span className="text-5xl font-extrabold text-amber-400 tabular-nums">
              {balance !== null ? balance.toLocaleString() : '—'}
            </span>
          </div>
          <p className="text-cp-muted text-sm">coins</p>

          {/* Broke banner */}
          {balance === 0 && (
            <div className="mt-4 bg-red-400/10 border border-red-400/25 rounded-xl px-4 py-3">
              <p className="text-red-400 font-semibold text-sm mb-3">You're broke! 💸</p>

              {showRefillButton && !refillClaimed && (
                <button
                  onClick={handleRefill}
                  className="px-5 py-2 bg-amber-400 hover:bg-amber-300 text-black text-sm font-bold rounded-xl transition-colors"
                >
                  Claim 100 free coins
                </button>
              )}

              {(showOutOfRefills || refillClaimed) && (
                <p className="text-cp-muted text-xs">Out of refills today — come back tomorrow!</p>
              )}
            </div>
          )}
        </div>

        {/* ── Games grid ── */}
        <h2 className="text-lg font-bold text-cp-text mb-4">Games</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {GAMES.map((game) => (
            <Link
              key={game.route}
              to={game.route}
              className="group rounded-2xl border border-cp-border bg-cp-card
                hover:border-amber-400/30 hover:bg-cp-elevated
                transition-all duration-200 p-4 flex flex-col items-center text-center gap-2 no-underline"
            >
              <span className="text-4xl mb-1">{game.emoji}</span>
              <span className="text-sm font-bold text-cp-text leading-tight">{game.name}</span>
              <span className="text-xs text-cp-muted leading-snug">{game.description}</span>
              <span
                className="mt-auto text-xs font-semibold text-amber-400
                  group-hover:text-amber-300 transition-colors"
              >
                Play →
              </span>
            </Link>
          ))}
        </div>

        {/* ── Leaderboard ── */}
        <LeaderboardSection />
      </div>
    </div>
  )
}
