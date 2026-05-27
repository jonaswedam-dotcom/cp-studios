import { useState, useEffect } from 'react'
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

// ── Leaderboard ───────────────────────────────────────────────────────────────
function LeaderboardSection() {
  const { currentUser } = useApp()
  const [entries, setEntries]   = useState([])
  const [lbLoading, setLbLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function fetchLeaderboard() {
      setLbLoading(true)

      const [walletsRes, usersRes] = await Promise.all([
        supabase
          .from('wallets')
          .select('user_id, balance')
          .order('balance', { ascending: false })
          .limit(10),
        supabase
          .from('pending_users')
          .select('user_id, username'),
      ])

      if (cancelled) return

      const wallets = walletsRes.data ?? []
      const users   = usersRes.data   ?? []

      const usernameMap = {}
      for (const u of users) {
        usernameMap[u.user_id] = u.username
      }

      const combined = wallets.map((w) => ({
        user_id:  w.user_id,
        balance:  w.balance,
        username: usernameMap[w.user_id]
          ?? (w.user_id === currentUser?.id ? currentUser?.name : null)
          ?? 'Player',
      }))

      setEntries(combined)
      setLbLoading(false)
    }

    fetchLeaderboard()
    return () => { cancelled = true }
  }, [currentUser?.id, currentUser?.name])

  const rankMeta = [
    { emoji: '🥇', color: 'text-amber-400',   bg: 'bg-amber-400/10  border-amber-400/20'  },
    { emoji: '🥈', color: 'text-slate-300',   bg: 'bg-slate-300/10  border-slate-300/20'  },
    { emoji: '🥉', color: 'text-amber-600',   bg: 'bg-amber-600/10  border-amber-600/20'  },
  ]

  return (
    <section className="mt-12">
      <h2 className="text-xl font-bold text-cp-text mb-4">🏆 Leaderboard</h2>

      {lbLoading ? (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-cp-muted text-sm text-center py-8">No players yet — be the first!</p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, idx) => {
            const rank = idx + 1
            const meta = rankMeta[idx]

            return (
              <div
                key={entry.user_id}
                className={`flex items-center gap-4 rounded-xl border px-4 py-3 transition-colors
                  ${meta
                    ? `${meta.bg}`
                    : 'bg-cp-card border-cp-border'
                  }
                `}
              >
                {/* Rank badge */}
                <div className="w-8 flex-shrink-0 text-center">
                  {meta ? (
                    <span className="text-xl">{meta.emoji}</span>
                  ) : (
                    <span className="text-sm font-bold text-cp-muted">#{rank}</span>
                  )}
                </div>

                {/* Username */}
                <span
                  className={`flex-1 font-semibold text-sm truncate
                    ${meta ? meta.color : 'text-cp-text'}
                  `}
                >
                  {entry.username}
                  {entry.user_id === currentUser?.id && (
                    <span className="ml-1.5 text-xs text-cp-muted font-normal">(you)</span>
                  )}
                </span>

                {/* Balance */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-amber-400 text-sm">🪙</span>
                  <span className={`text-sm font-bold ${meta ? meta.color : 'text-cp-muted'}`}>
                    {entry.balance.toLocaleString()}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CasinoPage() {
  const { balance, claimRefill, canClaimRefill } = useCasino()
  const [refillClaimed, setRefillClaimed] = useState(false)

  async function handleRefill() {
    await claimRefill()
    setRefillClaimed(true)
  }

  const showRefillButton = balance === 0 && canClaimRefill()
  const showOutOfRefills  = balance === 0 && !canClaimRefill()

  return (
    <div className="min-h-screen bg-cp-bg page-in">
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
