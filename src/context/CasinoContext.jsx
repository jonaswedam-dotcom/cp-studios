import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'
import { useApp } from './AppContext'

const CasinoContext = createContext(null)
export const useCasino = () => useContext(CasinoContext)

export function CasinoProvider({ children }) {
  const { session } = useApp()
  const userId = session?.user?.id ?? null

  const [balance, setBalance] = useState(null)
  const [loading, setLoading] = useState(false)

  // ── Load (or create) the wallet row ───────────────────────────────────────
  const loadBalance = useCallback(async () => {
    if (!userId) return
    setLoading(true)

    const { data, error } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      console.error('[CasinoContext] loadBalance error:', error)
      setLoading(false)
      return
    }

    if (data) {
      setBalance(data.balance)
    } else {
      // First visit — create wallet with 1000 starting coins
      const { data: created, error: insertError } = await supabase
        .from('wallets')
        .insert({ user_id: userId, balance: 1000 })
        .select('balance')
        .single()

      if (insertError) {
        console.error('[CasinoContext] wallet insert error:', insertError)
      } else {
        setBalance(created.balance)
      }
    }

    setLoading(false)
  }, [userId])

  useEffect(() => {
    if (!userId) {
      setBalance(null)
      return
    }
    loadBalance()
  }, [userId, loadBalance])

  // ── Place a bet ───────────────────────────────────────────────────────────
  // winAmount: net change (positive = won, negative = lost, 0 = push)
  const placeBet = useCallback(async (game, bet, winAmount) => {
    if (!userId) throw new Error('Not authenticated')

    const newBalance = Math.max(0, balance + winAmount)
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

  // ── Daily refill ──────────────────────────────────────────────────────────
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
      }}
    >
      {children}
    </CasinoContext.Provider>
  )
}
