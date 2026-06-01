import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'
import { useApp } from '../context/AppContext'

// ── Live bet feed ───────────────────────────────────────────────────────────
// Small pill bubbles that pop in at the top of the casino and fade out fast,
// showing every bet placed across all players in real time. Driven entirely by
// real Supabase data: it subscribes to INSERTs on `game_history` (the row every
// bet already writes via CasinoContext.placeBet) and renders a bubble per bet.
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

const VISIBLE_MS = 4600   // how long a bubble sits before it starts fading
const EXIT_MS    = 360    // fade-out duration (keep in sync with the keyframe)
const MAX_BUBBLES = 4     // most bubbles shown at once (newest on top)

// One bubble. Owns its own lifecycle timers so it self-cleans on unmount
// (including when the parent slices it past MAX_BUBBLES). `name` is resolved by
// the parent at render time, so a bubble that arrived before the wallet name-map
// loaded upgrades from "Player" to the real name without its timers resetting.
function BetBubble({ bubble, name, onDone }) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), VISIBLE_MS)
    const t2 = setTimeout(() => onDone(bubble.key), VISIBLE_MS + EXIT_MS)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [bubble.key, onDone])

  const { emoji, label } = metaFor(bubble.game)

  // result → coloured verb + amount
  let tone, verb, amount
  if (bubble.result === 'win') {
    tone   = 'text-emerald-400'
    verb   = 'won'
    amount = `+${Math.max(0, bubble.payout - bubble.bet).toLocaleString()}`
  } else if (bubble.result === 'push') {
    tone   = 'text-cp-muted'
    verb   = 'pushed'
    amount = bubble.bet.toLocaleString()
  } else {
    tone   = 'text-red-400'
    verb   = 'lost'
    amount = bubble.bet.toLocaleString()
  }

  return (
    <div
      className="flex items-center gap-2 max-w-[88vw]
        bg-cp-card/95 backdrop-blur-sm border border-cp-border rounded-full
        pl-2.5 pr-3.5 py-1.5 shadow-lg shadow-black/30"
      style={{ animation: `${leaving ? 'betFeedOut' : 'betFeedIn'} ${leaving ? EXIT_MS : 300}ms ease forwards` }}
    >
      <span className="text-base leading-none">{emoji}</span>
      <span className="text-xs sm:text-[13px] text-cp-text whitespace-nowrap truncate">
        <span className={`font-semibold ${bubble.isSelf ? 'text-amber-400' : 'text-cp-text'}`}>
          {name}
        </span>{' '}
        <span className={`font-bold ${tone}`}>{verb} {amount}</span>{' '}
        <span className="text-cp-muted">on {label}</span>
      </span>
    </div>
  )
}

export default function LiveBetFeed() {
  const { session, currentUser } = useApp()
  const userId = session?.user?.id ?? null

  const [bubbles, setBubbles] = useState([]) // newest-first
  const [names, setNames]     = useState({}) // user_id → display_name (loaded once)

  // One-shot map of every wallet's display name (same select-all policy the
  // leaderboard uses). Kept in state — not a ref — so a bubble that arrived
  // before the map resolved re-renders with the real name once it loads. New
  // players who join mid-session fall back to "Player".
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

  const removeBubble = useCallback((key) => {
    setBubbles(prev => prev.filter(b => b.key !== key))
  }, [])

  // Realtime: one bubble per game_history INSERT. Depends only on userId so the
  // channel isn't torn down on every render (the name map is resolved at render
  // time, so the subscription doesn't need it). The fixed channel name is safe
  // because exactly one LiveBetFeed is mounted at a time — GameLayout on a game
  // page OR CasinoPage in the lobby, never both.
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel('casino-bet-feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'game_history' },
        ({ new: row }) => {
          if (!row) return
          const key = row.id || `${row.user_id}:${row.created_at || ''}:${Math.random()}`
          setBubbles(prev => {
            if (prev.some(b => b.key === key)) return prev
            return [
              {
                key,
                user_id: row.user_id,
                isSelf:  row.user_id === userId,
                game:    row.game,
                bet:     row.bet,
                result:  row.result,
                payout:  row.payout,
              },
              ...prev,
            ].slice(0, MAX_BUBBLES)
          })
        },
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [userId])

  if (!userId || bubbles.length === 0) return null

  const selfName = currentUser?.name || 'You'

  return (
    <div className="fixed top-[68px] inset-x-0 z-40 flex flex-col items-center gap-1.5 px-3 pointer-events-none">
      {bubbles.map(b => (
        <BetBubble
          key={b.key}
          bubble={b}
          name={b.isSelf ? selfName : (names[b.user_id] || 'Player')}
          onDone={removeBubble}
        />
      ))}
      <style>{`
        @keyframes betFeedIn {
          from { opacity: 0; transform: translateY(-10px) scale(0.94); }
          to   { opacity: 1; transform: translateY(0)     scale(1);    }
        }
        @keyframes betFeedOut {
          from { opacity: 1; transform: translateY(0)     scale(1);    }
          to   { opacity: 0; transform: translateY(-8px)  scale(0.96); }
        }
      `}</style>
    </div>
  )
}
