import { useState, useEffect, useRef, useCallback } from 'react'
import { GameLayout, BetChips, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../supabase'
import FlightBoard from './FlightBoard'
import { GROWTH_RATE } from './aviatorTrajectory'

function pillStyle(m) {
  if (m < 2)  return { color: '#f87171', borderColor: '#7f1d1d', background: '#2a1112' }
  if (m <= 5) return { color: '#fcd34d', borderColor: '#854d0e', background: '#2a210f' }
  return             { color: '#86efac', borderColor: '#14532d', background: '#0f2a18' }
}

export default function AviatorGame() {
  const { balance, loadBalance } = useCasino()
  const { currentUser } = useApp()

  const [round,   setRound]   = useState(undefined)
  const [bets,    setBets]    = useState([])
  const [history, setHistory] = useState([])
  const [myBet,     setMyBet]     = useState(null)
  const [betAmount, setBetAmount] = useState(50)
  const [localMult, setLocalMult] = useState(1.0)
  const [countdown, setCountdown] = useState(15)
  const [placing,        setPlacing]        = useState(false)
  const [cashing,        setCashing]        = useState(false)
  const [error,          setError]          = useState('')
  const [crashAnimating, setCrashAnimating] = useState(false)
  const [cashoutFeed, setCashoutFeed] = useState([])

  const roundRef   = useRef(round)
  const rafRef         = useRef(null)
  const crashTimerRef  = useRef(null)
  roundRef.current = round

  const fetchBets = useCallback(async (roundId) => {
    const { data } = await supabase
      .from('aviator_bets')
      .select('*')
      .eq('round_id', roundId)
    const rows = data ?? []
    setBets(rows)
    setMyBet(rows.find(b => b.user_id === currentUser?.id) ?? null)
  }, [currentUser?.id])
  const fetchBetsRef = useRef(fetchBets)
  fetchBetsRef.current = fetchBets

  const fetchHistory = useCallback(async () => {
    const { data } = await supabase
      .from('aviator_rounds')
      .select('crash_point')
      .eq('status', 'crashed')
      .not('crash_point', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10)
    setHistory((data ?? []).map(r => Number(r.crash_point)))
  }, [])
  const fetchHistoryRef = useRef(fetchHistory)
  fetchHistoryRef.current = fetchHistory

  const fetchCurrentRound = useCallback(async () => {
    const { data } = await supabase
      .from('aviator_rounds')
      .select('*')
      .in('status', ['waiting', 'flying'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setRound(prev => {
      // Don't overwrite if Realtime already gave us a more recent round
      if (prev && data && prev.id !== data.id && prev.status !== 'crashed') return prev
      return data ?? null
    })
    if (data?.id) fetchBetsRef.current(data.id)
  }, [])
  const fetchCurrentRoundRef = useRef(fetchCurrentRound)
  fetchCurrentRoundRef.current = fetchCurrentRound

  useEffect(() => {
    fetchCurrentRound()
    fetchHistory()
  }, [fetchCurrentRound, fetchHistory])

  const handleRoundChange = useCallback((payload) => {
    const updated = payload.new
    if (!updated) return
    if (updated.status === 'waiting') {
      setRound(updated)
      setBets([])
      setMyBet(null)
      setCashoutFeed([])
      setLocalMult(1.0)
      setError('')
      setCrashAnimating(false)
      return
    }
    setRound(prev => (prev?.id === updated.id ? updated : prev))
    if (updated.status === 'flying') {
      fetchBetsRef.current(updated.id)
      setCashoutFeed([])
      setLocalMult(1.0)
    }
    if (updated.status === 'crashed') {
      cancelAnimationFrame(rafRef.current)
      setCrashAnimating(true)
      fetchHistoryRef.current()
      crashTimerRef.current = setTimeout(() => {
        setCrashAnimating(false)
        setMyBet(null)
        fetchCurrentRoundRef.current()
      }, 4000)
    }
  }, [])

  const handleBetChange = useCallback((payload) => {
    const updated = payload.new
    if (!updated) return
    setBets(prev => {
      const idx = prev.findIndex(b => b.id === updated.id)
      if (idx === -1) return [...prev, updated]
      const next = [...prev]; next[idx] = updated; return next
    })
    if (updated.user_id === currentUser?.id) {
      setMyBet(updated)
      if (updated.status === 'cashed_out') loadBalance()
    }
    if (updated.status === 'cashed_out' && updated.cashout_multiplier) {
      setCashoutFeed(prev => [
        { display_name: updated.display_name, mult: updated.cashout_multiplier, payout: updated.payout, id: updated.id },
        ...prev,
      ].slice(0, 20))
    }
  }, [currentUser?.id, loadBalance])

  useEffect(() => {
    const channel = supabase
      .channel('aviator-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aviator_rounds' }, handleRoundChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aviator_bets' }, handleBetChange)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [handleRoundChange, handleBetChange])

  useEffect(() => {
    if (round?.status !== 'flying' || !round.started_at) return
    let active = true
    const tick = () => {
      if (!active) return
      const r = roundRef.current
      if (!r?.started_at) return
      const elapsed = (Date.now() - new Date(r.started_at).getTime()) / 1000
      setLocalMult(+Math.exp(GROWTH_RATE * Math.max(0, elapsed)).toFixed(2))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { active = false; cancelAnimationFrame(rafRef.current) }
  }, [round?.status, round?.started_at])

  useEffect(() => {
    if (round?.status !== 'waiting') { setCountdown(15); return }
    const iv = setInterval(() => {
      const elapsed = (Date.now() - new Date(round.created_at).getTime()) / 1000
      setCountdown(Math.max(0, Math.ceil(15 - elapsed)))
    }, 200)
    return () => clearInterval(iv)
  }, [round?.status, round?.created_at])

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    clearTimeout(crashTimerRef.current)
  }, [])

  if (round === undefined || balance === null) {
    return (
      <GameLayout title="Aviator">
        <div className="flex items-center justify-center h-48">
          <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        </div>
      </GameLayout>
    )
  }

  if (round === null) {
    return (
      <GameLayout title="Aviator">
        <div className="flex flex-col items-center justify-center h-48 gap-3">
          <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-cp-muted text-sm">Starting first round…</p>
        </div>
      </GameLayout>
    )
  }

  // ── Place bet ─────────────────────────────────────────────────────────────
  const handlePlaceBet = async () => {
    if (!round || round.status !== 'waiting') return
    if (!betAmount || betAmount < 1 || betAmount > (balance ?? 0)) return
    setPlacing(true)
    setError('')
    const { error: rpcErr } = await supabase.rpc('place_aviator_bet', {
      p_round_id:     round.id,
      p_amount:       betAmount,
      p_display_name: currentUser?.name ?? 'Player',
    })
    if (rpcErr) {
      setError(rpcErr.message ?? 'Could not place bet')
    } else {
      loadBalance()
    }
    setPlacing(false)
  }

  // ── Cash out ──────────────────────────────────────────────────────────────
  const handleCashOut = async () => {
    if (!myBet || myBet.status !== 'active') return
    if (round?.status !== 'flying') return
    setCashing(true)
    setError('')
    const { data, error: rpcErr } = await supabase.rpc('cashout_aviator', {
      p_bet_id: myBet.id,
    })
    if (rpcErr) {
      setError(rpcErr.message ?? 'Cash out failed')
    } else if (data?.[0]?.success === false) {
      setError('Too late — round crashed before your cashout landed')
    }
    setCashing(false)
  }

  // ── Derived display values ────────────────────────────────────────────────
  const isWaiting  = round?.status === 'waiting'
  const isFlying   = round?.status === 'flying'
  const isCrashed  = round?.status === 'crashed' || crashAnimating
  const hasBet     = myBet !== null
  const cashedOut  = myBet?.status === 'cashed_out'

  const boardPhase = isCrashed ? 'crashed'
                   : cashedOut ? 'cashedout'
                   : isFlying  ? 'flying'
                   :              'betting'

  const displayMult = isCrashed ? (round?.crash_point != null ? Number(round.crash_point) : localMult)
                    : isFlying  ? localMult
                    :              1.0

  const liveWin    = hasBet && isFlying
    ? Math.floor(myBet.bet_amount * displayMult) - myBet.bet_amount
    : 0

  const canBet     = isWaiting && !hasBet && !placing && (balance ?? 0) >= betAmount && betAmount >= 1
  const canCashOut = isFlying && hasBet && myBet.status === 'active' && !cashing

  return (
    <GameLayout title="Aviator" wide>
      <div className="flex flex-col lg:flex-row gap-5 items-start">

        {/* ── Left: game board ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">

          {/* Crash history pills */}
          {history.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {history.map((m, i) => {
                const s = pillStyle(m)
                return (
                  <span key={i} style={{ fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 999, border: `1px solid ${s.borderColor}`, color: s.color, background: s.background, flexShrink: 0 }}>
                    {m >= 100 ? `${Math.round(m)}×` : `${m.toFixed(2)}×`}
                  </span>
                )
              })}
            </div>
          )}

          {/* Flight board */}
          <div style={{ position: 'relative' }}>
            <FlightBoard
              phase={boardPhase}
              multiplier={displayMult}
              crashPoint={round?.crash_point != null ? Number(round.crash_point) : null}
              cashedOutAt={myBet?.cashout_multiplier != null ? Number(myBet.cashout_multiplier) : null}
              bet={myBet?.bet_amount ?? betAmount}
            />

            {/* Waiting overlay: countdown */}
            {isWaiting && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 6, pointerEvents: 'none',
              }}>
                <div style={{ fontSize: 13, color: '#78716c', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  {countdown > 0 ? 'Next round in' : 'Launching…'}
                </div>
                {countdown > 0 && (
                  <div style={{ fontSize: 48, fontWeight: 800, color: '#fde68a', lineHeight: 1, fontFamily: '"Playfair Display", Georgia, serif', textShadow: '0 0 28px rgba(251,191,36,0.4)' }}>
                    {countdown}
                  </div>
                )}
                {hasBet && (
                  <div style={{ fontSize: 13, color: '#34d399', fontWeight: 600 }}>
                    Bet placed — {formatCoins(myBet.bet_amount)} coins
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="px-4 py-2.5 rounded-xl bg-red-400/10 border border-red-400/25 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* ── Controls ── */}
          <div className="bg-cp-card border border-cp-border rounded-2xl p-4 flex flex-col gap-3">

            {/* Waiting: bet chips + place bet */}
            {isWaiting && !hasBet && (
              <>
                <BetChips bet={betAmount} onBet={setBetAmount} balance={balance ?? 0} />
                <button
                  onClick={handlePlaceBet}
                  disabled={!canBet}
                  className={`w-full py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
                    ${canBet
                      ? 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_24px_rgba(251,191,36,0.3)] active:scale-95'
                      : 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                    }`}
                >
                  {placing ? 'Placing…' : `Place Bet — ${formatCoins(betAmount)} coins`}
                </button>
              </>
            )}

            {/* Waiting: bet already placed */}
            {isWaiting && hasBet && (
              <div className="text-center py-3 rounded-xl bg-emerald-400/10 border border-emerald-400/25 text-emerald-400 font-semibold text-sm">
                Bet placed — waiting for takeoff ✈
              </div>
            )}

            {/* Flying: cash out */}
            {isFlying && hasBet && myBet.status === 'active' && (
              <button
                onClick={handleCashOut}
                disabled={!canCashOut}
                className="w-full py-3.5 rounded-2xl font-bold text-black text-lg tracking-wide transition-all active:scale-95"
                style={{
                  background: 'linear-gradient(135deg,#fbbf24,#f59e0b)',
                  boxShadow: '0 0 28px rgba(251,191,36,0.4)',
                  animation: 'aviatorPulse 1.1s ease-out infinite',
                }}
              >
                {cashing ? 'Cashing out…' : `CASH OUT  +${formatCoins(liveWin)}  ·  ${displayMult.toFixed(2)}×`}
              </button>
            )}

            {/* Flying: watching (no bet this round) */}
            {isFlying && !hasBet && (
              <div className="text-center py-3 rounded-xl bg-cp-elevated border border-cp-border text-cp-muted text-sm">
                Watching — place a bet next round
              </div>
            )}

            {/* Flying: already cashed out */}
            {isFlying && cashedOut && (
              <div className="text-center py-3 rounded-xl bg-emerald-400/10 border border-emerald-400/25 text-emerald-400 font-semibold text-sm">
                Cashed out at {Number(myBet.cashout_multiplier).toFixed(2)}× — won {formatCoins(myBet.payout)} coins 🎉
              </div>
            )}

            {/* Crashed: round result */}
            {isCrashed && myBet && (
              <div className={`text-center py-3 rounded-xl font-semibold text-sm ${
                cashedOut
                  ? 'bg-emerald-400/10 border border-emerald-400/25 text-emerald-400'
                  : 'bg-red-400/10 border border-red-400/25 text-red-400'
              }`}>
                {cashedOut
                  ? `Cashed out at ${Number(myBet.cashout_multiplier).toFixed(2)}× · +${formatCoins(myBet.payout)} coins`
                  : `Lost ${formatCoins(myBet.bet_amount)} coins`
                }
              </div>
            )}

            {/* Crashed: no bet placed */}
            {isCrashed && !myBet && (
              <div className="text-center py-2 text-cp-muted text-sm">
                Next round starting soon…
              </div>
            )}
          </div>
        </div>

        {/* ── Right: live feed ── */}
        <div className="w-full lg:w-64 flex-shrink-0">
          <LiveFeed
            round={round}
            bets={bets}
            cashoutFeed={cashoutFeed}
            currentUserId={currentUser?.id}
            isCrashed={isCrashed}
          />
        </div>

      </div>

      <style>{`
        @keyframes aviatorPulse {
          0%   { box-shadow: 0 0 0 0 rgba(251,191,36,0.55) }
          70%  { box-shadow: 0 0 0 14px rgba(251,191,36,0) }
          100% { box-shadow: 0 0 0 0 rgba(251,191,36,0) }
        }
      `}</style>
    </GameLayout>
  )
}

// ── Live Feed Panel ────────────────────────────────────────────────────────────
function LiveFeed({ round, bets, cashoutFeed, currentUserId, isCrashed }) {
  const isWaiting  = round?.status === 'waiting'
  const isFlying   = round?.status === 'flying'
  const showCrash  = isCrashed

  const activeBets    = bets.filter(b => b.status === 'active')
  const cashedOutBets = bets.filter(b => b.status === 'cashed_out')
  const lostBets      = bets.filter(b => b.status === 'lost')

  return (
    <div className="bg-cp-card border border-cp-border rounded-2xl overflow-hidden flex flex-col" style={{ minHeight: 300 }}>
      <div className="px-4 py-3 border-b border-cp-border">
        <span className="text-xs font-semibold text-cp-muted uppercase tracking-wider">
          {isWaiting ? 'Players betting' : (isFlying && !showCrash) ? 'Live cashouts' : 'Round summary'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1" style={{ maxHeight: 400 }}>

        {/* Waiting: bets placed so far */}
        {isWaiting && bets.map(b => (
          <div key={b.id} className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs ${
            b.user_id === currentUserId
              ? 'bg-amber-400/10 border border-amber-400/20'
              : 'bg-cp-elevated'
          }`}>
            <span className="font-semibold text-cp-text truncate max-w-[110px]">{b.display_name}</span>
            <span className="text-cp-muted font-semibold tabular-nums">{b.bet_amount.toLocaleString()} 🪙</span>
          </div>
        ))}
        {isWaiting && bets.length === 0 && (
          <p className="text-cp-muted text-xs text-center py-6">No bets yet — be first!</p>
        )}

        {/* Flying: live cashout events */}
        {isFlying && cashoutFeed.map(e => (
          <div key={e.id} className="flex items-center justify-between px-3 py-2 rounded-lg text-xs"
            style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.15)', animation: 'feedIn 0.3s ease' }}>
            <span className="font-semibold text-emerald-400 truncate max-w-[110px]">{e.display_name}</span>
            <span className="text-cp-muted tabular-nums">{Number(e.mult).toFixed(2)}×</span>
          </div>
        ))}
        {isFlying && activeBets.length > 0 && (
          <div className="px-3 py-2 text-xs text-cp-muted/60 text-center">
            {activeBets.length} still flying…
          </div>
        )}
        {isFlying && cashoutFeed.length === 0 && activeBets.length === 0 && (
          <p className="text-cp-muted text-xs text-center py-6">Watching…</p>
        )}

        {/* Crashed / animating: win/loss summary */}
        {showCrash && (
          <>
            {cashedOutBets.length > 0 && (
              <>
                <div className="px-3 py-1 text-xs text-emerald-400/70 font-semibold uppercase tracking-wider">Won</div>
                {cashedOutBets.map(b => (
                  <div key={b.id} className="flex items-center justify-between px-3 py-2 rounded-lg text-xs"
                    style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.15)' }}>
                    <span className="font-semibold text-emerald-400 truncate max-w-[110px]">{b.display_name}</span>
                    <span className="text-emerald-300 tabular-nums">+{(b.payout ?? 0).toLocaleString()} 🪙</span>
                  </div>
                ))}
              </>
            )}
            {lostBets.length > 0 && (
              <>
                <div className="px-3 py-1 text-xs text-red-400/70 font-semibold uppercase tracking-wider mt-1">Lost</div>
                {lostBets.map(b => (
                  <div key={b.id} className="flex items-center justify-between px-3 py-2 rounded-lg text-xs"
                    style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
                    <span className="font-semibold text-red-400/80 truncate max-w-[110px]">{b.display_name}</span>
                    <span className="text-red-400/60 tabular-nums">-{b.bet_amount.toLocaleString()} 🪙</span>
                  </div>
                ))}
              </>
            )}
            {bets.length === 0 && (
              <p className="text-cp-muted text-xs text-center py-6">No bets this round</p>
            )}
          </>
        )}
      </div>

      <style>{`
        @keyframes feedIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}
