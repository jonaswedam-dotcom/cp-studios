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

  return (
    <GameLayout title="Aviator" wide>
      <div className="text-cp-muted text-sm p-4">
        Round: {round?.id?.slice(0, 8) ?? 'none'} | Status: {round?.status ?? '—'} | Mult: {localMult.toFixed(2)}× | Countdown: {countdown}s
      </div>
    </GameLayout>
  )
}
