import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../supabase'
import { useApp } from './AppContext'

const CasinoContext = createContext(null)
export const useCasino = () => useContext(CasinoContext)

const DAILY_BONUS_AMOUNT = 100

export function CasinoProvider({ children }) {
  const { session } = useApp()
  const userId = session?.user?.id ?? null

  const [balance, setBalance]               = useState(null)
  const [loading, setLoading]               = useState(false)
  const [dailyBonusAmount, setDailyBonusAmount] = useState(0)

  const bonusTimerRef = useRef(null)

  // ── Load (or create) the wallet row ───────────────────────────────────────
  const loadBalance = useCallback(async () => {
    if (!userId) return
    setLoading(true)

    const { data, error } = await supabase
      .from('wallets')
      .select('balance, last_daily_bonus, display_name')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      console.error('[CasinoContext] loadBalance error:', error)
      setLoading(false)
      return
    }

    if (data) {
      // Opportunistically backfill display_name for wallets created before migration 012
      if (!data.display_name) {
        const name = session?.user?.user_metadata?.full_name
        if (name) {
          supabase.from('wallets').update({ display_name: name }).eq('user_id', userId)
            .then(({ error: e }) => { if (e) console.error('[CasinoContext] display_name backfill error:', e) })
        }
      }

      let newBalance = data.balance

      // Check if daily bonus is due
      const lastBonus = data.last_daily_bonus ? new Date(data.last_daily_bonus) : null
      const now = new Date()
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const isDue = !lastBonus || lastBonus < twentyFourHoursAgo

      if (isDue) {
        newBalance = newBalance + DAILY_BONUS_AMOUNT
        const { error: updateError } = await supabase
          .from('wallets')
          .update({ balance: newBalance, last_daily_bonus: now.toISOString() })
          .eq('user_id', userId)

        if (updateError) {
          console.error('[CasinoContext] daily bonus update error:', updateError)
          newBalance = data.balance  // revert on error
        } else {
          // Show toast for 5 seconds
          setDailyBonusAmount(DAILY_BONUS_AMOUNT)
          clearTimeout(bonusTimerRef.current)
          bonusTimerRef.current = setTimeout(() => setDailyBonusAmount(0), 5000)
        }
      }

      setBalance(newBalance)
    } else {
      // First visit — create wallet with 1000 starting coins + first daily bonus.
      // Store the user's display name so the leaderboard never needs a profiles join.
      const startBalance  = 1000 + DAILY_BONUS_AMOUNT
      const displayName   = session?.user?.user_metadata?.full_name || null
      const { data: created, error: insertError } = await supabase
        .from('wallets')
        .insert({
          user_id:          userId,
          balance:          startBalance,
          last_daily_bonus: new Date().toISOString(),
          display_name:     displayName,
        })
        .select('balance')
        .single()

      if (insertError) {
        console.error('[CasinoContext] wallet insert error:', insertError)
      } else {
        setBalance(created.balance)
        setDailyBonusAmount(DAILY_BONUS_AMOUNT)
        clearTimeout(bonusTimerRef.current)
        bonusTimerRef.current = setTimeout(() => setDailyBonusAmount(0), 5000)
      }
    }

    setLoading(false)
  }, [userId])

  useEffect(() => {
    if (!userId) {
      setBalance(null)
      setDailyBonusAmount(0)
      return
    }
    loadBalance()
  }, [userId, loadBalance])

  // Cleanup bonus timer on unmount
  useEffect(() => {
    return () => clearTimeout(bonusTimerRef.current)
  }, [])

  // ── Place a bet ───────────────────────────────────────────────────────────
  // winAmount: net change (positive = won, negative = lost, 0 = push)
  const placeBet = useCallback(async (game, bet, winAmount) => {
    if (!userId) throw new Error('Not authenticated')

    const newBalance = Math.max(0, (balance ?? 0) + winAmount)
    const result     = winAmount > 0 ? 'win' : winAmount === 0 ? 'push' : 'loss'
    const payout     = winAmount >= 0 ? bet + winAmount : 0

    const [walletRes, historyRes] = await Promise.all([
      supabase
        .from('wallets')
        .update({ balance: newBalance })
        .eq('user_id', userId),
      supabase
        .from('game_history')
        .insert({ user_id: userId, game, bet, result, payout }),
    ])

    if (walletRes.error) console.error('[CasinoContext] wallet update error:', walletRes.error)
    if (historyRes.error) console.error('[CasinoContext] history insert error:', historyRes.error)

    setBalance(newBalance)
    return newBalance
  }, [userId, balance])

  // ── Daily refill (emergency, when broke) ─────────────────────────────────
  const _refillKey = userId ? `cp-studios:casino-refill:${userId}` : null
  const _todayStr  = new Date().toISOString().slice(0, 10) // "YYYY-MM-DD"

  const claimRefill = useCallback(async () => {
    if (!userId || !_refillKey) return

    const { error } = await supabase
      .from('wallets')
      .update({ balance: 100 })
      .eq('user_id', userId)

    if (error) {
      console.error('[CasinoContext] claimRefill error:', error)
      return
    }

    localStorage.setItem(_refillKey, _todayStr)
    setBalance(100)
  }, [userId, _refillKey, _todayStr])

  const canClaimRefill = useCallback(() => {
    if (balance !== 0) return false
    if (!_refillKey) return false
    return localStorage.getItem(_refillKey) !== _todayStr
  }, [balance, _refillKey, _todayStr])

  // ── Context value ─────────────────────────────────────────────────────────
  return (
    <CasinoContext.Provider
      value={{
        balance,
        loading,
        loadBalance,
        placeBet,
        claimRefill,
        canClaimRefill,
        dailyBonusAmount,
      }}
    >
      {children}
    </CasinoContext.Provider>
  )
}
