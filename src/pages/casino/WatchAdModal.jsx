import { useState, useEffect, useRef } from 'react'

const AD_DURATION_S = 15 // simulated ad length

// A simulated "watch an ad for coins" modal. There is no real ad network (not viable
// for a private invite-only app) — this is an honest placeholder timer that, once it
// finishes, lets the player claim a fixed coin reward via the parent's onClaim().
export default function WatchAdModal({ onClose, onClaim, rewardAmount, adsLeft }) {
  const [secondsLeft, setSecondsLeft] = useState(AD_DURATION_S)
  const [claiming, setClaiming]       = useState(false)
  const timerRef = useRef(null)

  // Countdown
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? 0 : s - 1))
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [])

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ready = secondsLeft === 0

  async function handleClaim() {
    if (!ready || claiming) return
    setClaiming(true)
    await onClaim()
    onClose()
  }

  const pct = Math.round(((AD_DURATION_S - secondsLeft) / AD_DURATION_S) * 100)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-in"
      style={{ background: 'rgba(0,0,0,0.72)' }}
    >
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative bg-cp-card border border-cp-border rounded-2xl p-6 w-full max-w-sm shadow-2xl flex flex-col gap-4 modal-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-cp-text">Watch an ad 🎬</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-cp-muted hover:text-cp-text hover:bg-cp-elevated transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Fake ad surface */}
        <div className="rounded-xl bg-cp-elevated border border-cp-border h-40 flex flex-col items-center justify-center gap-3">
          {ready ? (
            <>
              <span className="text-4xl">🎁</span>
              <p className="text-cp-text font-semibold text-sm">Your reward is ready!</p>
            </>
          ) : (
            <>
              <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-cp-muted text-sm">Ad playing… {secondsLeft}s</p>
            </>
          )}
        </div>

        {/* Progress bar */}
        <div className="h-1.5 w-full rounded-full bg-cp-elevated overflow-hidden">
          <div
            className="h-full bg-amber-400 transition-all duration-1000 ease-linear"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Claim button */}
        <button
          onClick={handleClaim}
          disabled={!ready || claiming}
          className={`w-full py-2.5 rounded-xl font-bold text-sm transition-all
            ${!ready || claiming
              ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-60'
              : 'bg-amber-400 hover:bg-amber-300 text-black active:scale-95'
            }`}
        >
          {claiming
            ? 'Claiming…'
            : ready
              ? `Claim ${rewardAmount.toLocaleString()} coins`
              : `Claim ${rewardAmount.toLocaleString()} coins in ${secondsLeft}s`}
        </button>

        <p className="text-center text-[11px] text-cp-muted/70">
          Simulated ad — no real ad network. {adsLeft} left today.
        </p>
      </div>
    </div>
  )
}
