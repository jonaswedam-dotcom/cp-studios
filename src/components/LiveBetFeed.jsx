import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { useApp } from '../context/AppContext'

// ── Live bet feed ───────────────────────────────────────────────────────────
// A single pill at the top of the casino that shows the latest bet placed across
// all players in real time. Driven entirely by real Supabase data: it subscribes
// to INSERTs on `game_history` (the row every bet already writes via
// CasinoContext.placeBet) and updates the *same* pill in place as new bets land —
// it never stacks a new row, so the feed can't cluster up.
//
// Realtime applies RLS, so this only surfaces other players' bets once Jonas has
// (a) replaced game_history's own-only SELECT policy with a select-all one and
// (b) added the table to the supabase_realtime publication — both in migration
// 032. Before that the channel simply delivers nothing (or only your own bets),
// so the casino keeps working and the feed stays quietly empty. Display names
// come from a one-shot wallets map (the same source the leaderboard reads), not
// a denormalised column, so placeBet stays untouched and nothing breaks if 032
// hasn't been applied yet.

// game string (as passed to placeBet) → emoji + label. Mirrors the CasinoPage
// catalogue; an unknown game falls back to a generic chip so new games still show.
const GAME_META = {
  'coin-flip':    { emoji: '🪙', label: 'Coin Flip' },
  'dice':         { emoji: '🎲', label: 'Dice' },
  'roulette':     { emoji: '🎡', label: 'Roulette' },
  'blackjack':    { emoji: '🃏', label: 'Blackjack' },
  'slots':        { emoji: '🎰', label: 'Slots' },
  'aviator':      { emoji: '✈️', label: 'Aviator' },
  'aviamasters':  { emoji: '🛩️', label: 'Aviamasters' },
  'chicken-road': { emoji: '🐔', label: 'Chicken Road' },
  'mines':        { emoji: '💣', label: 'Mines' },
  'plinko':       { emoji: '🔵', label: 'Plinko' },
}
const metaFor = (game) => GAME_META[game] || { emoji: '🎲', label: game || 'a game' }

const VISIBLE_MS = 4200   // how long the pill lingers after the last bet before fading
const EXIT_MS    = 320    // fade-out duration (keep in sync with the keyframe)

// result → coloured verb + amount
function resultParts(bet) {
  if (bet.result === 'win') {
    return { tone: 'text-emerald-400', verb: 'won',    amount: `+${Math.max(0, bet.payout - bet.bet).toLocaleString()}` }
  }
  if (bet.result === 'push') {
    return { tone: 'text-cp-muted',    verb: 'pushed', amount: bet.bet.toLocaleString() }
  }
  return   { tone: 'text-red-400',     verb: 'lost',   amount: bet.bet.toLocaleString() }
}

export default function LiveBetFeed() {
  const { session, currentUser } = useApp()
  const userId = session?.user?.id ?? null

  const [current, setCurrent] = useState(null) // the single latest bet, or null
  const [leaving, setLeaving] = useState(false) // true while the pill is fading out
  const [names, setNames]     = useState({})    // user_id → display_name (loaded once)
  const hideRef = useRef(null)
  const exitRef = useRef(null)
  const lastKeyRef = useRef(null)

  // One-shot map of every wallet's display name (same select-all policy the
  // leaderboard uses). Kept in state — not a ref — so a pill showing before the
  // map resolved re-renders with the real name once it loads. New players who
  // join mid-session fall back to "Player".
  useEffect(() => {
    if (!userId) { setNames({}); return }
    let active = true
    supabase
      .from('wallets')
      .select('user_id, display_name')
      .then(({ data }) => {
        if (!active || !data) return
        const map = {}
        for (const w of data) map[w.user_id] = w.display_name || 'Player'
        setNames(map)
      })
    return () => { active = false }
  }, [userId])

  // Realtime: each game_history INSERT replaces the single pill in place and
  // resets its linger timer. Depends only on userId so the channel isn't torn
  // down on every render (the name map is resolved at render time). The fixed
  // channel name is safe because exactly one LiveBetFeed is mounted at a time —
  // GameLayout on a game page OR CasinoPage in the lobby, never both.
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel('casino-bet-feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'game_history' },
        ({ new: row }) => {
          if (!row) return
          if (row.result === 'push') return // pushes (ties) don't refresh the pill — wins & losses only
          const key = row.id ?? `${row.user_id}:${row.created_at ?? ''}`
          if (lastKeyRef.current === key) return // ignore duplicate delivery
          lastKeyRef.current = key

          clearTimeout(hideRef.current)
          clearTimeout(exitRef.current)
          setLeaving(false)
          setCurrent({
            key,
            user_id: row.user_id,
            isSelf:  row.user_id === userId,
            game:    row.game,
            bet:     row.bet,
            result:  row.result,
            payout:  row.payout,
          })
          hideRef.current = setTimeout(() => setLeaving(true), VISIBLE_MS)
          exitRef.current = setTimeout(() => setCurrent(null), VISIBLE_MS + EXIT_MS)
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      clearTimeout(hideRef.current)
      clearTimeout(exitRef.current)
    }
  }, [userId])

  if (!userId || !current) return null

  const { emoji, label } = metaFor(current.game)
  const { tone, verb, amount } = resultParts(current)
  const name = current.isSelf ? (currentUser?.name || 'You') : (names[current.user_id] || 'Player')

  return (
    <div className="fixed top-[68px] inset-x-0 z-40 flex justify-center px-3 pointer-events-none">
      <div
        key={current.key}
        className="flex items-center gap-2 max-w-[88vw]
          bg-cp-card/95 backdrop-blur-md border border-cp-border rounded-full
          pl-2.5 pr-3.5 py-1.5 shadow-lg shadow-black/30"
        style={{ animation: `${leaving ? 'betFeedOut' : 'betFeedIn'} ${leaving ? EXIT_MS : 260}ms ease forwards` }}
      >
        <span className="text-base leading-none">{emoji}</span>
        <span className="text-xs sm:text-[13px] text-cp-text whitespace-nowrap truncate">
          <span className={`font-semibold ${current.isSelf ? 'text-amber-400' : 'text-cp-text'}`}>
            {name}
          </span>{' '}
          <span className={`font-bold ${tone}`}>{verb} {amount}</span>{' '}
          <span className="text-cp-muted">on {label}</span>
        </span>
        <style>{`
          @keyframes betFeedIn {
            from { opacity: 0; transform: translateY(-8px) scale(0.96); }
            to   { opacity: 1; transform: translateY(0)    scale(1);    }
          }
          @keyframes betFeedOut {
            from { opacity: 1; transform: translateY(0)    scale(1);    }
            to   { opacity: 0; transform: translateY(-6px) scale(0.97); }
          }
        `}</style>
      </div>
    </div>
  )
}
