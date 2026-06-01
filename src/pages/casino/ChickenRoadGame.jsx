import { useState, useEffect, useRef, useCallback } from 'react'
import { GameLayout, BetChips, ResultBanner, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'

// ── Constants ─────────────────────────────────────────────────────────────────
// Lane 1/2 were player-favored (RTP 108% / 101%). Lowered so every cashout point
// keeps a positive house edge: lane1 0.72*1.3=93.6%, lane2 0.4608*2.0=92.2%.
const LANE_MULTIPLIERS = [1.3, 2.0, 3.2, 4.8, 7.2, 11.0, 18.0]
const SAFE_PROBS       = [0.72, 0.64, 0.56, 0.48, 0.40, 0.32, 0.25]
const NUM_LANES        = 7

// Speed config per lane (ms) — deeper = faster (more dangerous feeling)
const LANE_SPEEDS = [3800, 3200, 2700, 2200, 1800, 1400, 1100]

// Number of cars per lane
const LANE_CARS = [1, 2, 1, 2, 2, 3, 3]

// ── Lane strip ────────────────────────────────────────────────────────────────
function LaneStrip({ laneIndex, isActive, isCrossed, isDead, isHit, chickenHere }) {
  const speed = LANE_SPEEDS[laneIndex]
  const carCount = LANE_CARS[laneIndex]

  let bg = '#111827'
  let border = '#1f2937'
  if (isCrossed) { bg = 'rgba(16,185,129,0.08)'; border = 'rgba(52,211,153,0.25)' }
  if (isDead && isHit) { bg = 'rgba(239,68,68,0.12)'; border = 'rgba(248,113,113,0.35)' }
  if (isActive) { border = 'rgba(251,191,36,0.3)' }

  return (
    <div
      style={{
        height: 56,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 8,
        position: 'relative',
        overflow: 'hidden',
        transition: 'background 0.3s, border-color 0.3s',
        marginBottom: 4,
      }}
    >
      {/* Road lines */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: 0,
          right: 0,
          height: 1,
          background: 'repeating-linear-gradient(90deg, transparent, transparent 16px, #374151 16px, #374151 30px)',
          transform: 'translateY(-50%)',
          opacity: 0.5,
        }}
      />

      {/* Cars */}
      {Array.from({ length: carCount }).map((_, ci) => (
        <div
          key={ci}
          style={{
            position: 'absolute',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 22,
            lineHeight: 1,
            animation: `carDrive${laneIndex} ${speed + ci * 700}ms linear infinite`,
            animationDelay: `${-ci * ((speed + ci * 700) / carCount)}ms`,
            willChange: 'transform',
          }}
        >
          🚗
        </div>
      ))}

      {/* Multiplier label */}
      <div
        style={{
          position: 'absolute',
          right: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: 11,
          fontWeight: 700,
          color: isCrossed ? '#34d399' : '#6b7280',
          letterSpacing: 0.5,
        }}
      >
        {LANE_MULTIPLIERS[laneIndex]}×
      </div>

      {/* Lane number */}
      <div
        style={{
          position: 'absolute',
          left: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: 10,
          fontWeight: 600,
          color: '#4b5563',
        }}
      >
        {laneIndex + 1}
      </div>

      {/* Hit explosion */}
      {isHit && isDead && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%,-50%)',
            fontSize: 26,
            animation: 'hitFlash 0.4s ease',
            zIndex: 10,
          }}
        >
          💥
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ChickenRoadGame() {
  const { balance, placeBet } = useCasino()

  const [phase, setPhase]         = useState('betting')  // 'betting'|'crossing'|'dead'|'safe'|'cashedout'
  const [currentLane, setCurrentLane] = useState(0)      // 0 = start, 1-7 = lanes crossed
  const [bet, setBet]             = useState(50)
  const [gameResult, setGameResult] = useState(null)
  const [wonAmount, setWonAmount] = useState(0)
  const [hitLane, setHitLane]     = useState(null)
  const [isAnimating, setIsAnimating] = useState(false)

  // Inject keyframes for each lane's car animation once
  useEffect(() => {
    const id = 'chicken-road-kf'
    if (!document.getElementById(id)) {
      const s = document.createElement('style')
      s.id = id
      s.textContent = Array.from({ length: NUM_LANES }, (_, i) => `
        @keyframes carDrive${i} {
          from { transform: translateY(-50%) translateX(-60px); }
          to   { transform: translateY(-50%) translateX(calc(100vw + 60px)); }
        }
      `).join('\n') + `
        @keyframes chickenBounce {
          0%, 100% { transform: translateX(-50%) translateY(0); }
          50%       { transform: translateX(-50%) translateY(-4px); }
        }
        @keyframes hitFlash {
          0%   { opacity: 1; transform: translate(-50%,-50%) scale(0.5); }
          50%  { opacity: 1; transform: translate(-50%,-50%) scale(1.4); }
          100% { opacity: 1; transform: translate(-50%,-50%) scale(1); }
        }
      `
      document.head.appendChild(s)
    }
  }, [])

  function handleStart() {
    if ((balance ?? 0) < bet) return
    setPhase('crossing')
    setCurrentLane(0)
    setHitLane(null)
    setGameResult(null)
    setWonAmount(0)
  }

  function handleCross() {
    if (phase !== 'crossing' || isAnimating) return
    const targetLane = currentLane  // 0-indexed lane to cross (currentLane = lanes already crossed)
    if (targetLane >= NUM_LANES) return

    setIsAnimating(true)
    const safe = Math.random() < SAFE_PROBS[targetLane]

    setTimeout(() => {
      if (safe) {
        const newLane = currentLane + 1
        setCurrentLane(newLane)
        setIsAnimating(false)

        if (newLane === NUM_LANES) {
          // All lanes crossed — auto cash out
          const win = Math.floor(bet * (LANE_MULTIPLIERS[NUM_LANES - 1] - 1))
          setPhase('cashedout')
          setGameResult('win')
          setWonAmount(win)
          placeBet('chicken-road', bet, win)
        }
      } else {
        setHitLane(targetLane)
        setPhase('dead')
        setGameResult('loss')
        setWonAmount(bet)
        setIsAnimating(false)
        placeBet('chicken-road', bet, -bet)
      }
    }, 350)
  }

  function handleCashOut() {
    if (phase !== 'crossing' || currentLane === 0) return
    const win = Math.floor(bet * (LANE_MULTIPLIERS[currentLane - 1] - 1))
    setPhase('cashedout')
    setGameResult('win')
    setWonAmount(win)
    placeBet('chicken-road', bet, win)
  }

  function handlePlayAgain() {
    setPhase('betting')
    setCurrentLane(0)
    setHitLane(null)
    setGameResult(null)
    setWonAmount(0)
    setIsAnimating(false)
  }

  const isBetting   = phase === 'betting'
  const isCrossing  = phase === 'crossing'
  const isDead      = phase === 'dead'
  const isCashedOut = phase === 'cashedout'
  const isResult    = isDead || isCashedOut

  // Chicken vertical position — moves up as lanes are crossed
  // Road container is NUM_LANES * 60px tall + gaps
  const laneH = 60 // 56 + 4 margin
  const totalRoadH = NUM_LANES * laneH
  // currentLane=0 → bottom (start), currentLane=7 → top (finished)
  const chickenBottom = 8 + currentLane * laneH  // px from bottom of road container

  const currentMult = currentLane > 0 ? LANE_MULTIPLIERS[currentLane - 1] : null
  const nextMult = currentLane < NUM_LANES ? LANE_MULTIPLIERS[currentLane] : null

  return (
    <GameLayout title="Chicken Road">
      <div className="flex flex-col items-center gap-6">

        {/* ── Info bar ── */}
        {isCrossing && (
          <div className="w-full max-w-sm flex items-center justify-between bg-cp-card border border-cp-border rounded-xl px-4 py-2.5">
            <div className="text-sm text-cp-muted">
              {currentLane > 0 ? (
                <>
                  <span className="text-cp-text font-semibold">Safe: </span>
                  <span className="text-emerald-400 font-bold">{currentMult}×</span>
                </>
              ) : (
                <span className="text-cp-muted">Bet: <span className="text-amber-400 font-semibold">{formatCoins(bet)}</span></span>
              )}
            </div>
            {nextMult && (
              <div className="text-sm text-cp-muted">
                Next: <span className="text-amber-400 font-bold">{nextMult}×</span>
                <span className="text-cp-muted ml-1">({Math.round(SAFE_PROBS[currentLane] * 100)}% safe)</span>
              </div>
            )}
          </div>
        )}

        {/* ── Road + Chicken ── */}
        <div className="w-full max-w-sm">
          <div
            style={{
              position: 'relative',
              width: '100%',
            }}
          >
            {/* Lanes rendered top-to-bottom (lane 6 at top = highest multiplier) */}
            {Array.from({ length: NUM_LANES }, (_, i) => {
              const laneIdx = NUM_LANES - 1 - i  // render high lanes at top
              const lanesCrossed = currentLane
              const isCrossed = laneIdx < lanesCrossed
              const isActive = isCrossing && laneIdx === currentLane
              const isHit = hitLane === laneIdx

              return (
                <LaneStrip
                  key={laneIdx}
                  laneIndex={laneIdx}
                  isActive={isActive}
                  isCrossed={isCrossed}
                  isDead={isDead}
                  isHit={isHit}
                  chickenHere={false}
                />
              )
            })}

            {/* Chicken — positioned absolutely over the road */}
            {(isCrossing || isDead || isCashedOut) && (
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  // bottom of container minus lanes crossed * lane height, from bottom
                  bottom: chickenBottom,
                  transform: 'translateX(-50%)',
                  fontSize: 26,
                  zIndex: 20,
                  transition: 'bottom 0.3s cubic-bezier(0.34,1.56,0.64,1)',
                  animation: isCrossing && !isAnimating ? 'chickenBounce 0.8s ease-in-out infinite' : 'none',
                  filter: isDead ? 'grayscale(1)' : 'none',
                  lineHeight: 1,
                }}
              >
                {isDead ? '🪦' : '🐔'}
              </div>
            )}

            {/* Start area below road */}
            <div
              style={{
                height: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 4,
              }}
            >
              {isBetting && (
                <span style={{ fontSize: 28 }}>🐔</span>
              )}
            </div>
          </div>
        </div>

        {/* ── Bet chips (betting phase) ── */}
        {isBetting && (
          <div className="w-full max-w-sm bg-cp-card border border-cp-border rounded-2xl p-4">
            <BetChips
              bet={bet}
              onBet={setBet}
              balance={balance ?? 0}
              disabled={false}
            />
          </div>
        )}

        {/* ── Action buttons ── */}
        <div className="w-full max-w-sm flex flex-col gap-3">
          {isBetting && (
            <button
              onClick={handleStart}
              disabled={(balance ?? 0) < bet}
              className={`w-full py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
                ${(balance ?? 0) < bet
                  ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                  : 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_24px_rgba(251,191,36,0.3)] hover:shadow-[0_0_32px_rgba(251,191,36,0.45)] active:scale-95'
                }
              `}
            >
              Start 🐔
            </button>
          )}

          {isCrossing && (
            <div className="flex gap-3">
              <button
                onClick={handleCross}
                disabled={isAnimating || currentLane >= NUM_LANES}
                className={`flex-1 py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
                  ${isAnimating
                    ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                    : 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_16px_rgba(251,191,36,0.25)] active:scale-95'
                  }
                `}
              >
                {isAnimating ? '…' : 'Cross!'}
              </button>
              <button
                onClick={handleCashOut}
                disabled={currentLane === 0 || isAnimating}
                className={`flex-1 py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
                  ${currentLane === 0 || isAnimating
                    ? 'bg-cp-elevated border border-cp-border text-cp-muted cursor-not-allowed opacity-40'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_16px_rgba(52,211,153,0.25)] active:scale-95'
                  }
                `}
              >
                {currentLane > 0 ? `Cash Out\n${formatCoins(Math.floor(bet * (LANE_MULTIPLIERS[currentLane-1] - 1)))}` : 'Cash Out'}
              </button>
            </div>
          )}

          {isDead && (
            <div className="flex flex-col gap-3">
              <div className="text-center rounded-xl border border-red-400/30 bg-red-400/10 py-3 px-4">
                <p className="text-red-400 font-bold text-lg">Ran over! 🚗💥</p>
                <p className="text-cp-muted text-sm mt-0.5">Lost {formatCoins(bet)} coins at lane {(hitLane ?? 0) + 1}</p>
              </div>
              <button
                onClick={handlePlayAgain}
                className="w-full py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95"
              >
                Play Again
              </button>
            </div>
          )}

          {isCashedOut && (
            <div className="flex flex-col gap-3">
              <div className="text-center rounded-xl border border-emerald-400/30 bg-emerald-400/10 py-3 px-4">
                <p className="text-emerald-400 font-bold text-lg">
                  Cashed out at {currentMult ?? LANE_MULTIPLIERS[NUM_LANES-1]}× 🎉
                </p>
                <p className="text-emerald-300 text-sm font-semibold mt-0.5">
                  +{formatCoins(wonAmount)} coins
                </p>
              </div>
              <button
                onClick={handlePlayAgain}
                className="w-full py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95"
              >
                Play Again
              </button>
            </div>
          )}
        </div>

        {/* ── Result banner ── */}
        {isResult && (
          <div className="w-full max-w-sm">
            <ResultBanner
              result={gameResult}
              amount={wonAmount}
              message={
                isDead
                  ? `Hit at lane ${(hitLane ?? 0) + 1}`
                  : currentLane === NUM_LANES
                  ? 'All 7 lanes crossed!'
                  : `Stopped at lane ${currentLane}`
              }
            />
          </div>
        )}

      </div>
    </GameLayout>
  )
}
