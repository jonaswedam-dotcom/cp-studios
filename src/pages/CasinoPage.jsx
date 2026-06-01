import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'
import { useApp } from '../context/AppContext'
import { useCasino } from '../context/CasinoContext'
import WatchAdModal from './casino/WatchAdModal'
import LiveBetFeed from '../components/LiveBetFeed'

// ── Game catalogue ────────────────────────────────────────────────────────────
const GAMES = [
  {
    route:       '/casino/coin-flip',
    emoji:       '🪙',
    name:        'Coin Flip',
    description: '50/50 shot — win 1.95×',
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
  {
    route:       '/casino/plinko',
    emoji:       '🔵',
    name:        'Plinko',
    description: 'Drop the ball, land a multiplier',
  },
]

// ── Query helpers ─────────────────────────────────────────────────────────────
// Both read display_name directly from wallets — no profiles join needed.

// Send-Coins modal: every wallet except the sender's own, sorted A→Z by name.
async function fetchRecipients(selfId) {
  const q = supabase
    .from('wallets')
    .select('user_id, display_name, balance')
    .order('display_name', { ascending: true, nullsFirst: false })

  // Exclude self in the query when we have a valid id
  if (selfId) q.neq('user_id', selfId)

  const { data, error } = await q
  if (error) {
    console.error('[SendCoins] wallets query failed:', error.message, error)
    return []
  }
  console.log('[SendCoins] wallets rows returned:', data?.length ?? 0)
  return (data ?? []).map(row => ({
    user_id:     row.user_id,
    balance:     row.balance,
    displayName: row.display_name || 'Player',
  }))
}

// Leaderboard: all wallets, richest first, top 10.
async function fetchLeaderboardEntries() {
  const { data, error } = await supabase
    .from('wallets')
    .select('user_id, display_name, balance')
    .order('balance', { ascending: false })
    .limit(10)
  if (error) {
    console.error('[Leaderboard] wallets query failed:', error.message, error)
    return []
  }
  return (data ?? []).map(row => ({
    user_id:     row.user_id,
    balance:     row.balance,
    displayName: row.display_name || 'Player',
  }))
}

// ── SendCoinsModal ─────────────────────────────────────────────────────────────
function SendCoinsModal({ senderBalance, onClose, onDonate }) {
  const { currentUser } = useApp()

  const [players,   setPlayers]   = useState([])        // all wallet holders
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [selected,  setSelected]  = useState(null)      // player entry | null
  const [rawAmount, setRawAmount] = useState('')
  const [error,     setError]     = useState('')
  const [sending,   setSending]   = useState(false)
  const searchRef   = useRef(null)

  // Load all players once on open (self excluded in the query via .neq)
  useEffect(() => {
    fetchRecipients(currentUser?.id).then(rows => {
      setPlayers(rows)
      setLoading(false)
      setTimeout(() => searchRef.current?.focus(), 30)
    })
  }, [currentUser?.id])

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const filtered = search.trim()
    ? players.filter(p =>
        p.displayName.toLowerCase().includes(search.trim().toLowerCase())
      )
    : players

  const parsed  = parseInt(rawAmount, 10)
  const isValid = !isNaN(parsed) && parsed >= 1 && parsed <= senderBalance

  async function handleConfirm() {
    if (!selected) { setError('Select a recipient first'); return }
    if (isNaN(parsed) || parsed < 1) {
      setError('Enter a valid amount (minimum 1 coin)')
      return
    }
    if (parsed > senderBalance) {
      setError(`You only have ${senderBalance.toLocaleString()} coins`)
      return
    }
    setSending(true)
    setError('')
    const { error: rpcErr } = await supabase.rpc('donate_coins', {
      p_recipient_id: selected.user_id,
      p_amount:       parsed,
    })
    if (rpcErr) {
      setError(rpcErr.message || 'Transfer failed — please try again')
      setSending(false)
      return
    }
    onDonate(parsed, selected.displayName)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.72)' }}
    >
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative bg-cp-card border border-cp-border rounded-2xl p-6 w-full max-w-sm shadow-2xl flex flex-col gap-4 max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-cp-text">Send Coins 🪙</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-cp-muted hover:text-cp-text hover:bg-cp-elevated transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Step 1: Pick recipient */}
        {!selected ? (
          <div className="flex flex-col gap-3 overflow-hidden">
            <div>
              <label className="block text-xs font-semibold text-cp-muted uppercase tracking-wider mb-1.5">
                Recipient
              </label>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name…"
                className="w-full bg-cp-elevated border border-cp-border rounded-xl px-4 py-2.5 text-sm text-cp-text
                  placeholder:text-cp-muted/50 focus:border-amber-400/60 focus:outline-none transition-colors"
              />
            </div>

            <div className="overflow-y-auto max-h-52 space-y-1">
              {loading ? (
                <div className="flex justify-center py-6">
                  <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-cp-muted text-sm text-center py-4">
                  {search.trim() ? 'No players match that name' : 'No other players found'}
                </p>
              ) : (
                filtered.map(player => (
                  <button
                    key={player.user_id}
                    onClick={() => setSelected(player)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl
                      bg-cp-elevated border border-cp-border hover:border-amber-400/40 hover:bg-cp-elevated/80
                      text-left transition-all group"
                  >
                    <span className="font-semibold text-sm text-cp-text group-hover:text-amber-400 transition-colors truncate">
                      {player.displayName}
                    </span>
                    <span className="text-xs text-cp-muted tabular-nums ml-2 flex-shrink-0">
                      🪙 {player.balance.toLocaleString()}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          /* Step 2: Enter amount */
          <div className="flex flex-col gap-3">
            {/* Recipient display + change button */}
            <div className="flex items-center justify-between bg-cp-elevated border border-cp-border rounded-xl px-4 py-2.5">
              <div>
                <p className="text-xs text-cp-muted">Sending to</p>
                <p className="font-semibold text-sm text-amber-400">{selected.displayName}</p>
              </div>
              <button
                onClick={() => { setSelected(null); setRawAmount(''); setError('') }}
                className="text-xs text-cp-muted hover:text-cp-text transition-colors"
              >
                Change
              </button>
            </div>

            {/* Amount input */}
            <div>
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

            {error && (
              <div className="px-3 py-2 rounded-lg bg-red-400/10 border border-red-400/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={onClose}
                disabled={sending}
                className="flex-1 py-2.5 rounded-xl border border-cp-border bg-cp-elevated text-cp-muted hover:text-cp-text font-semibold text-sm transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={sending || !rawAmount}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all
                  ${sending || !rawAmount
                    ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                    : 'bg-amber-400 hover:bg-amber-300 text-black active:scale-95'
                  }
                `}
              >
                {sending ? (
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
        )}
      </div>
    </div>
  )
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
function LeaderboardSection({ onRefresh }) {
  const { currentUser }          = useApp()
  const { loadBalance }          = useCasino()
  const [entries, setEntries]    = useState([])
  const [lbLoading, setLbLoading] = useState(true)

  const fetchLeaderboard = useCallback(async () => {
    setLbLoading(true)
    const rows = await fetchLeaderboardEntries()
    setEntries(rows)
    setLbLoading(false)
  }, [])

  useEffect(() => { fetchLeaderboard() }, [fetchLeaderboard])

  // Expose a refresh function so parent can trigger after a donation
  const refresh = useCallback(async () => {
    await Promise.all([loadBalance(), fetchLeaderboard()])
  }, [loadBalance, fetchLeaderboard])

  useEffect(() => {
    if (onRefresh) onRefresh.current = refresh
  })

  const rankMeta = [
    { emoji: '🥇', color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/20' },
    { emoji: '🥈', color: 'text-slate-300',  bg: 'bg-slate-300/10 border-slate-300/20' },
    { emoji: '🥉', color: 'text-amber-600',  bg: 'bg-amber-600/10 border-amber-600/20' },
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
            const meta   = rankMeta[idx]
            const isSelf = entry.user_id === currentUser?.id

            return (
              <div
                key={entry.user_id}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3
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
                <span className={`flex-1 font-semibold text-sm truncate ${meta ? meta.color : 'text-cp-text'}`}>
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
              </div>
            )
          })}
        </div>
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

// ── Ad reward toast ─────────────────────────────────────────────────────────────
function AdRewardToast({ amount }) {
  if (!amount) return null
  return (
    <div
      className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5
        bg-amber-400 text-black font-bold text-sm px-5 py-3 rounded-2xl
        shadow-[0_4px_24px_rgba(251,191,36,0.45)]"
      style={{ animation: 'bonusSlideIn 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards' }}
    >
      <span className="text-lg">🎬</span>
      Ad reward: +{amount.toLocaleString()} coins!
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CasinoPage() {
  const {
    balance, claimRefill, canClaimRefill, dailyBonusAmount,
    claimAdReward, canClaimAd, adsLeftToday, adRewardAmount,
  } = useCasino()

  const [refillClaimed,  setRefillClaimed]  = useState(false)
  const [sendCoinsOpen,  setSendCoinsOpen]  = useState(false)
  const [donateSuccessMsg, setDonateSuccessMsg] = useState('')
  const [adOpen,    setAdOpen]    = useState(false)
  const [adToast,   setAdToast]   = useState(0)
  const adToastRef = useRef(null)
  useEffect(() => () => clearTimeout(adToastRef.current), [])

  // Ref so LeaderboardSection can expose its refresh function
  const lbRefreshRef = useRef(null)

  const donateTimerRef = useRef(null)
  useEffect(() => () => clearTimeout(donateTimerRef.current), [])

  async function handleRefill() {
    await claimRefill()
    setRefillClaimed(true)
  }

  function handleModalDonate(amount, recipientName) {
    setSendCoinsOpen(false)
    clearTimeout(donateTimerRef.current)
    setDonateSuccessMsg(`You sent ${amount.toLocaleString()} coins to ${recipientName}! 🎉`)
    donateTimerRef.current = setTimeout(() => setDonateSuccessMsg(''), 4000)
    // Refresh leaderboard + own balance
    if (lbRefreshRef.current) lbRefreshRef.current()
  }

  async function handleAdClaim() {
    const got = await claimAdReward()
    if (got) {
      clearTimeout(adToastRef.current)
      setAdToast(got)
      adToastRef.current = setTimeout(() => setAdToast(0), 4000)
      if (lbRefreshRef.current) lbRefreshRef.current()
    }
  }

  const showRefillButton = balance === 0 && canClaimRefill()
  const showOutOfRefills  = balance === 0 && !canClaimRefill()

  return (
    <div className="min-h-screen bg-cp-bg page-in">
      <DailyBonusToast amount={dailyBonusAmount} />
      <AdRewardToast amount={adToast} />
      <LiveBetFeed />

      <div className="max-w-4xl mx-auto px-4 py-10">

        {/* ── Header ── */}
        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-cp-text tracking-tight">Casino</h1>
            <p className="text-cp-muted mt-1 text-sm">
              All fun, all fake — play responsibly 🎰
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex-shrink-0 flex items-center gap-2">
            {/* Watch ad for coins */}
            <button
              onClick={() => setAdOpen(true)}
              disabled={!canClaimAd()}
              title={canClaimAd()
                ? `Watch an ad for +${adRewardAmount} coins (${adsLeftToday()} left today)`
                : 'No ads available right now — check back soon'}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all
                ${canClaimAd()
                  ? 'border border-amber-400/30 bg-amber-400/5 text-amber-400 hover:bg-amber-400/15 hover:border-amber-400/60 active:scale-95'
                  : 'border border-cp-border bg-cp-elevated text-cp-muted cursor-not-allowed opacity-60'
                }`}
            >
              <span>🎬</span>
              Watch ad
            </button>

            {/* Send Coins button */}
            <button
              onClick={() => setSendCoinsOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl
                border border-amber-400/30 bg-amber-400/5 text-amber-400
                hover:bg-amber-400/15 hover:border-amber-400/60
                font-semibold text-sm transition-all active:scale-95"
            >
              <span>💸</span>
              Send Coins
            </button>
          </div>
        </div>

        {/* Donate success banner */}
        {donateSuccessMsg && (
          <div
            className="mb-6 flex items-center gap-2 bg-emerald-400/10 border border-emerald-400/25 rounded-xl px-4 py-3 text-emerald-400 font-semibold text-sm"
            style={{ animation: 'fadeInDonate 0.3s ease forwards' }}
          >
            <span>💸</span>
            {donateSuccessMsg}
            <style>{`
              @keyframes fadeInDonate {
                from { opacity: 0; transform: translateY(6px); }
                to   { opacity: 1; transform: translateY(0); }
              }
            `}</style>
          </div>
        )}

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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
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
              <span className="mt-auto text-xs font-semibold text-amber-400 group-hover:text-amber-300 transition-colors">
                Play →
              </span>
            </Link>
          ))}
        </div>

        {/* ── Leaderboard ── */}
        <LeaderboardSection onRefresh={lbRefreshRef} />
      </div>

      {/* ── Send Coins Modal ── */}
      {sendCoinsOpen && (
        <SendCoinsModal
          senderBalance={balance ?? 0}
          onClose={() => setSendCoinsOpen(false)}
          onDonate={handleModalDonate}
        />
      )}

      {/* ── Watch Ad Modal ── */}
      {adOpen && (
        <WatchAdModal
          onClose={() => setAdOpen(false)}
          onClaim={handleAdClaim}
          rewardAmount={adRewardAmount}
          adsLeft={adsLeftToday()}
        />
      )}
    </div>
  )
}
