import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../supabase'
import { useApp } from './AppContext'

const CasinoContext = createContext(null)
export const useCasino = () => useContext(CasinoContext)

const DAILY_BONUS_AMOUNT = 100

// ── Rewarded ads (tunable) ──────────────────────────────────────────────────
// Coins per watched ad, the minimum gap between ads, and the daily cap. Pegged to
// the daily bonus (100) so ads top out at 5 * 100 = 500 coins/day. The cooldown +
// cap are persisted on the wallet (migration 031) so they hold across devices.
export const AD_REWARD_AMOUNT = 100
const AD_COOLDOWN_MS = 3 * 60 * 1000 // 3 minutes between ads
const AD_DAILY_CAP   = 5             // max ads/day -> max 500 coins/day

const _adToday = () => new Date().toISOString().slice(0, 10) // "YYYY-MM-DD" (UTC)

export function CasinoProvider({ children }) {
  const { session } = useApp()
  const userId = session?.user?.id ?? null

  const [balance, setBalance]               = useState(null)
  const [loading, setLoading]               = useState(false)
  const [dailyBonusAmount, setDailyBonusAmount] = useState(0)
  // Ad cooldown/cap state, hydrated from the wallet row (best-effort) in loadBalance().
  // adsEnabled stays false until the ad columns (migration 031) are confirmed present, so a
  // frontend deployed before the migration is applied simply hides ads instead of erroring.
  const [adState, setAdState] = useState({ lastAt: null, date: null, count: 0 })
  const [adsEnabled, setAdsEnabled] = useState(false)

  const bonusTimerRef = useRef(null)

  // ── Settlement state for race-free, accumulating bets ──────────────────────
  // balanceRef always holds the latest balance so concurrently-settling bets
  // (e.g. multiple Plinko balls in flight) accumulate off a live value instead
  // of clobbering each other. writeChainRef serializes the wallet writes so the
  // last write carries the fully-accumulated balance (no lost updates).
  const balanceRef    = useRef(balance)
  const writeChainRef = useRef(Promise.resolve())
  useEffect(() => { balanceRef.current = balance }, [balance])

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
      // Opportunistically backfill display_name for wallets that still have none.
      // pending_users.username is the most reliable source (written at sign-up).
      // Auth metadata (user_metadata.full_name) is a secondary fallback because
      // it was null for many accounts created before that field was set.
      if (!data.display_name) {
        ;(async () => {
          const { data: pu } = await supabase
            .from('pending_users')
            .select('username')
            .eq('user_id', userId)
            .maybeSingle()
          const name =
            (pu?.username && pu.username.trim() !== '' ? pu.username.trim() : null) ??
            (session?.user?.user_metadata?.full_name?.trim() || null)
          if (name) {
            const { error: e } = await supabase
              .from('wallets')
              .update({ display_name: name })
              .eq('user_id', userId)
            if (e) console.error('[CasinoContext] display_name backfill error:', e)
          }
        })()
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
      // Resolve display_name: prefer pending_users.username (set at sign-up,
      // always present) then fall back to auth user metadata.
      const startBalance = 1000 + DAILY_BONUS_AMOUNT

      const { data: puRow } = await supabase
        .from('pending_users')
        .select('username')
        .eq('user_id', userId)
        .maybeSingle()
      const displayName =
        (puRow?.username && puRow.username.trim() !== '' ? puRow.username.trim() : null) ??
        (session?.user?.user_metadata?.full_name?.trim() || null)

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

    // Best-effort hydrate of the rewarded-ad cooldown/cap (migration 031). Kept as a
    // separate query so that if the columns don't exist yet (migration not applied), the
    // balance above still loads — ads just stay disabled rather than breaking the casino.
    const { data: adRow, error: adErr } = await supabase
      .from('wallets')
      .select('last_ad_reward, ad_rewards_date, ad_rewards_count')
      .eq('user_id', userId)
      .maybeSingle()
    if (adErr) {
      setAdsEnabled(false)
    } else {
      setAdsEnabled(true)
      if (adRow) {
        setAdState({
          lastAt: adRow.last_ad_reward ?? null,
          date:   adRow.ad_rewards_date ?? null,
          count:  adRow.ad_rewards_count ?? 0,
        })
      }
    }

    setLoading(false)
  }, [userId])

  useEffect(() => {
    if (!userId) {
      setBalance(null)
      setDailyBonusAmount(0)
      setAdState({ lastAt: null, date: null, count: 0 })
      setAdsEnabled(false)
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
  //
  // Settlements accumulate off balanceRef.current (the live balance) and write
  // through a serial chain, so multiple bets resolving close together — e.g.
  // several Plinko balls landing within the same animation frame — each build on
  // the previous result instead of all reading the same stale base and
  // overwriting one another (which silently dropped big wins like a 130× hit).
  const placeBet = useCallback((game, bet, winAmount) => {
    if (!userId) throw new Error('Not authenticated')

    const newBalance = Math.max(0, (balanceRef.current ?? 0) + winAmount)
    const result     = winAmount > 0 ? 'win' : winAmount === 0 ? 'push' : 'loss'
    const payout     = winAmount >= 0 ? bet + winAmount : 0

    // Apply locally now (sync) so the next settlement sees the updated balance.
    balanceRef.current = newBalance
    setBalance(newBalance)

    // Serialize the network writes; each one persists the value it accumulated.
    const run = writeChainRef.current.then(async () => {
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
    })
    writeChainRef.current = run.catch(() => {})
    return run.then(() => newBalance)
  }, [userId])

  // ── Adjust balance directly (used by CP War; no game_history row) ──────────
  const adjustBalance = useCallback(async (delta) => {
    if (!userId) throw new Error('Not authenticated')
    const newBalance = Math.max(0, (balance ?? 0) + delta)
    const { error } = await supabase
      .from('wallets')
      .update({ balance: newBalance })
      .eq('user_id', userId)
    if (error) { console.error('[CasinoContext] adjustBalance error:', error); return balance }
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

  // ── Rewarded ads (watch an ad for coins) ──────────────────────────────────
  const adsLeftToday = useCallback(() => {
    const used = adState.date === _adToday() ? adState.count : 0
    return Math.max(0, AD_DAILY_CAP - used)
  }, [adState])

  const canClaimAd = useCallback(() => {
    if (!userId || !adsEnabled) return false
    if (adsLeftToday() <= 0) return false
    if (adState.lastAt && Date.now() - new Date(adState.lastAt).getTime() < AD_COOLDOWN_MS) return false
    return true
  }, [userId, adsEnabled, adState, adsLeftToday])

  // Grants AD_REWARD_AMOUNT and persists the new cooldown/cap counters. Uses the same
  // balanceRef + serial write chain as placeBet so it can't lose-update against an
  // in-flight bet or war income collect. Returns the granted amount (0 if not allowed).
  const claimAdReward = useCallback(async () => {
    if (!userId || !canClaimAd()) return 0

    const today    = _adToday()
    const usedNow  = adState.date === today ? adState.count : 0
    const newCount = usedNow + 1
    const nowIso   = new Date().toISOString()
    const newBalance = (balanceRef.current ?? 0) + AD_REWARD_AMOUNT

    balanceRef.current = newBalance
    setBalance(newBalance)
    setAdState({ lastAt: nowIso, date: today, count: newCount })

    const run = writeChainRef.current.then(async () => {
      const { error } = await supabase
        .from('wallets')
        .update({
          balance:           newBalance,
          last_ad_reward:    nowIso,
          ad_rewards_date:   today,
          ad_rewards_count:  newCount,
        })
        .eq('user_id', userId)
      if (error) console.error('[CasinoContext] claimAdReward error:', error)
    })
    writeChainRef.current = run.catch(() => {})
    await run
    return AD_REWARD_AMOUNT
  }, [userId, adState, canClaimAd])

  // ── Context value ─────────────────────────────────────────────────────────
  return (
    <CasinoContext.Provider
      value={{
        balance,
        loading,
        loadBalance,
        placeBet,
        adjustBalance,
        claimRefill,
        canClaimRefill,
        dailyBonusAmount,
        adRewardAmount: AD_REWARD_AMOUNT,
        claimAdReward,
        canClaimAd,
        adsLeftToday,
      }}
    >
      {children}
    </CasinoContext.Provider>
  )
}
