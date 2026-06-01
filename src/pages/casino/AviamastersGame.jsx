import { useState, useEffect, useRef } from 'react'
import { GameLayout, BetChips, ResultBanner, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'
import {
  generateRound, MAX_MULT, WIN_TIERS, applyBooster, assignBadgePositions,
} from './aviamastersEngine'
import {
  CANVAS_W, CANVAS_H,
  splinePoint, splineToCanvas,
  drawBackground, drawIsland, drawPlane, drawTrail,
  drawBadge, drawRocket, drawCounterBalance,
} from './aviamastersCanvas'

const T_SPEEDS = { tortoise: 0.12, walking: 0.20, hare: 0.35, lightning: 0.65 }

// ── GameBoard (canvas) ────────────────────────────────────────────────────────
function GameBoard({ phase, planeTRef, controlPtsRef, badgesRef, multRef, bet }) {
  const canvasRef   = useRef(null)
  const drawRafRef  = useRef(null)

  // Local animation state — all refs so draw loop needs no React re-renders
  const propAngleRef  = useRef(0)
  const trailRef      = useRef([])      // [{cx, cy}], oldest first
  const cloudOffRef   = useRef(0)
  const timeRef       = useRef(0)
  const lastDrawRef   = useRef(null)
  const phaseRef      = useRef(phase)
  const flashRef      = useRef({ kind: null, timer: 0 })
  const flashScaleRef = useRef(1)
  const prevMultRef   = useRef(1)
  const fadeMapRef    = useRef({})      // { badgeIndex: opacity }

  // Sync phase into a ref (draw loop reads it without re-subscribing)
  useEffect(() => {
    if (phase === 'betting') {
      trailRef.current   = []
      fadeMapRef.current = {}
      prevMultRef.current = 1
    }
    phaseRef.current = phase
  }, [phase])

  // Apply HiDPI scaling once on mount
  useEffect(() => {
    const canvas = canvasRef.current
    const dpr    = window.devicePixelRatio || 1
    canvas.width  = CANVAS_W * dpr
    canvas.height = CANVAS_H * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
  }, [])

  // Draw loop — reads all game state from refs, never triggers React renders
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')

    function draw(ts) {
      if (!lastDrawRef.current) lastDrawRef.current = ts
      const dt = Math.min((ts - lastDrawRef.current) / 1000, 0.05)
      lastDrawRef.current = ts

      // Advance local animation timers
      propAngleRef.current += 15 * dt
      cloudOffRef.current  += 8 * dt
      timeRef.current      += dt
      if (flashRef.current.timer > 0) {
        flashRef.current.timer = Math.max(0, flashRef.current.timer - dt)
      }

      const currentPhase = phaseRef.current
      const t            = planeTRef.current
      const controlPts   = controlPtsRef.current ?? []
      const badges       = badgesRef.current ?? []
      const mult         = multRef.current

      // Detect multiplier change → trigger flash
      if (mult !== prevMultRef.current) {
        flashRef.current = {
          kind:  mult > prevMultRef.current ? 'boost' : 'rocket',
          timer: 0.28,
        }
        prevMultRef.current = mult
      }

      // Update badge fade-out map
      badges.forEach((b, i) => {
        if (b.applied) {
          fadeMapRef.current[i] = Math.max(0.12, (fadeMapRef.current[i] ?? 1) - dt * 3)
        } else {
          if (fadeMapRef.current[i] === undefined) fadeMapRef.current[i] = 1
        }
      })

      // Update smoke trail during active flight
      if ((currentPhase === 'flying' || currentPhase === 'landed' || currentPhase === 'splashed')
          && controlPts.length >= 2) {
        const pt = splinePoint(Math.min(1, t), controlPts)
        const { cx, cy } = splineToCanvas(pt)
        trailRef.current.push({ cx, cy })
        if (trailRef.current.length > 45) trailRef.current.shift()
      }

      // ── DRAW ──────────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
      drawBackground(ctx, cloudOffRef.current, timeRef.current)
      drawIsland(ctx, 'left',  false)
      drawIsland(ctx, 'right', currentPhase === 'landed')

      if (currentPhase !== 'betting' && controlPts.length >= 2) {
        drawTrail(ctx, trailRef.current)

        // Badges
        badges.forEach((b, i) => {
          const pt         = splinePoint(b.t, controlPts)
          const { cx, cy } = splineToCanvas(pt)
          const opacity    = fadeMapRef.current[i] ?? 1
          const pulse      = b.applied ? 1 : 1 + 0.04 * Math.sin(timeRef.current * 4.2 + i)

          if (b.kind === 'rocket') {
            drawRocket(ctx, cx, cy, opacity, !b.skipped && !b.applied)
          } else {
            drawBadge(ctx, cx, cy, b.kind, b.value, opacity, pulse)
          }
        })

        // Plane
        const pt1 = splinePoint(Math.min(1, t), controlPts)
        const pt2 = splinePoint(Math.min(1, t + 0.008), controlPts)
        const { cx: x1, cy: y1 } = splineToCanvas(pt1)
        const { cx: x2, cy: y2 } = splineToCanvas(pt2)
        let angle = Math.atan2(y2 - y1, x2 - x1)

        // Nose-down on splash
        if (currentPhase === 'splashed') angle = Math.max(angle, 0.6)

        const flashKind = flashRef.current.timer > 0 ? flashRef.current.kind : null
        drawPlane(ctx, x1, y1, angle, propAngleRef.current, flashKind)
      }

      // Flash scale for counter balance
      flashScaleRef.current = flashRef.current.timer > 0
        ? 1 + 0.18 * (flashRef.current.timer / 0.28)
        : 1
      drawCounterBalance(ctx, mult, currentPhase === 'splashed', flashScaleRef.current, bet)

      drawRafRef.current = requestAnimationFrame(draw)
    }

    drawRafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(drawRafRef.current)
  }, []) // empty — reads everything from refs

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        maxWidth: CANVAS_W,
        height: 'auto',
        borderRadius: 16,
        border: '1px solid #1f2937',
        display: 'block',
      }}
    />
  )
}

// ── Speed options ──────────────────────────────────────────────────────────────
const SPEED_OPTIONS = [
  { key: 'tortoise',  label: '🐢' },
  { key: 'walking',   label: '🚶' },
  { key: 'hare',      label: '🐇' },
  { key: 'lightning', label: '⚡' },
]

// ── BettingPanel ───────────────────────────────────────────────────────────────
function BettingPanel({ bet, onBet, balance, speed, onSpeed, safeLanding, onSafeLanding, onAutoRounds }) {
  const safeCost  = bet * 50
  const canAfford = balance >= bet + safeCost
  return (
    <div className="bg-cp-card border border-cp-border rounded-2xl p-4 flex flex-col gap-4">
      <BetChips bet={bet} onBet={onBet} balance={balance} disabled={false} />

      <div className="flex items-center justify-between">
        <span className="text-cp-muted text-sm font-semibold">Speed</span>
        <div className="flex gap-2">
          {SPEED_OPTIONS.map(opt => (
            <button key={opt.key} onClick={() => onSpeed(opt.key)}
              className={`w-10 h-10 rounded-xl text-lg transition-all active:scale-95 border
                ${speed === opt.key
                  ? 'bg-amber-400 border-amber-300'
                  : 'bg-cp-elevated border-cp-border hover:border-amber-400/40'}`}
              title={opt.key}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Safe Landing toggle */}
      <label className={`flex items-center justify-between gap-3 select-none
        rounded-xl px-3 py-2.5 border transition-all
        ${safeLanding ? 'border-sky-400/40 bg-sky-400/5' : 'border-cp-border bg-cp-elevated'}
        ${!canAfford ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
        <div>
          <p className="text-sm font-semibold text-cp-text">🛡️ Safe Landing</p>
          <p className="text-xs text-cp-muted mt-0.5">
            +{safeCost.toLocaleString()} coins · win guaranteed even on splash
          </p>
        </div>
        <input
          type="checkbox"
          checked={safeLanding}
          disabled={!canAfford}
          onChange={e => onSafeLanding(e.target.checked)}
          className={`w-4 h-4 accent-sky-400 ${canAfford ? 'cursor-pointer' : 'cursor-not-allowed'}`}
        />
      </label>

      {/* Autoplay presets */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-cp-muted">Autoplay</span>
        <div className="flex gap-1.5">
          {[5, 10, 25, 50].map(n => (
            <button key={n} onClick={() => onAutoRounds(n)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold border border-cp-border bg-cp-elevated
                hover:border-amber-400/40 hover:bg-amber-400/8 text-cp-muted hover:text-amber-400 transition-all">
              {n}×
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── ResultPanel ────────────────────────────────────────────────────────────────
function ResultPanel({ phase, multiplier, bet, wonAmount, onPlayAgain }) {
  const isLanded = phase === 'landed'
  return (
    <div className="flex flex-col gap-3">
      <div className={`text-center rounded-xl border py-3 px-4
        ${isLanded ? 'border-emerald-400/30 bg-emerald-400/10' : 'border-red-400/30 bg-red-400/10'}`}>
        {isLanded ? (
          <>
            <p className="text-emerald-400 font-bold text-lg">Landed at {multiplier.toFixed(2)}× 🎉</p>
            <p className="text-emerald-300 text-sm font-semibold mt-0.5">
              {wonAmount >= 0 ? '+' : ''}{formatCoins(wonAmount)} coins
            </p>
          </>
        ) : (
          <>
            <p className="text-red-400 font-bold text-lg">Splashed 🌊 at {multiplier.toFixed(2)}×</p>
            <p className="text-cp-muted text-sm mt-0.5">Lost {formatCoins(bet)} coins</p>
          </>
        )}
      </div>
      <button onClick={onPlayAgain}
        className="w-full py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95">
        Play Again
      </button>
    </div>
  )
}

// ── Booster definitions ────────────────────────────────────────────────────────
const BOOSTER_DEFS = [
  { key: 'laser_gun', icon: '🔫', label: 'Laser' },
  { key: 'magnet',    icon: '🧲', label: 'Magnet' },
  { key: 'nitro',     icon: '⚡',  label: 'Nitro' },
  { key: 'life_buoy', icon: '🛟',  label: 'Life Buoy' },
]

const INITIAL_BOOSTERS = { laser_gun: false, magnet: false, nitro: false, life_buoy: false }

function BoosterBar({ usedBoosters, onActivate, isFlying }) {
  return (
    <div className="w-full max-w-md flex gap-2">
      {BOOSTER_DEFS.map(b => {
        const used = usedBoosters[b.key]
        return (
          <button
            key={b.key}
            onClick={() => isFlying && !used && onActivate(b.key)}
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl border
              text-center transition-all select-none
              ${used
                ? 'bg-cp-elevated border-cp-border opacity-40 cursor-default'
                : isFlying
                  ? 'bg-cp-elevated border-amber-400/40 hover:border-amber-400 hover:bg-amber-400/10 active:scale-95 cursor-pointer'
                  : 'bg-cp-elevated border-cp-border opacity-50 cursor-default'
              }`}
          >
            <span className="text-xl leading-none">{used ? '✓' : b.icon}</span>
            <span className="text-xs text-cp-muted font-semibold">{b.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Win tier metadata ─────────────────────────────────────────────────────────
const WIN_TIER_META = {
  BIG:        { label: 'BIG WIN',        color: '#fbbf24', glow: 'rgba(251,191,36,0.55)',  bg: 'rgba(251,191,36,0.10)' },
  MEGA:       { label: 'MEGA WIN',       color: '#f97316', glow: 'rgba(249,115,22,0.55)',  bg: 'rgba(249,115,22,0.10)' },
  SUPER_MEGA: { label: 'SUPER MEGA WIN', color: '#ef4444', glow: 'rgba(239,68,68,0.55)',   bg: 'rgba(239,68,68,0.10)'  },
}

function WinPopup({ tier, multiplier, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 2500)
    return () => clearTimeout(t)
  }, [onDismiss])

  const meta = WIN_TIER_META[tier]
  if (!meta) return null

  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'amWinIn 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards',
        cursor: 'pointer',
      }}
    >
      <div style={{
        textAlign: 'center', padding: '48px 56px',
        borderRadius: 24, border: `2px solid ${meta.color}40`,
        background: meta.bg,
        boxShadow: `0 0 80px ${meta.glow}`,
        animation: tier === 'SUPER_MEGA' ? 'amShimmer 1.2s ease-in-out infinite' : 'none',
      }}>
        <div style={{ fontSize: 52, marginBottom: 12 }}>🏆</div>
        <div style={{
          fontSize: 34, fontWeight: 900, color: meta.color,
          letterSpacing: 3, textTransform: 'uppercase',
        }}>
          {meta.label}
        </div>
        <div style={{
          fontSize: 52, fontWeight: 900, color: '#fff',
          marginTop: 10, letterSpacing: -1,
        }}>
          {multiplier.toFixed(2)}×
        </div>
        <p style={{ marginTop: 18, fontSize: 11, color: '#6b7280' }}>tap to dismiss</p>
      </div>
      <style>{`
        @keyframes amWinIn {
          from { opacity:0; transform:scale(0.72); }
          to   { opacity:1; transform:scale(1);    }
        }
        @keyframes amShimmer {
          0%,100% { box-shadow: 0 0 80px ${meta.glow}; }
          50%     { box-shadow: 0 0 130px ${meta.glow}, 0 0 180px ${meta.glow}; }
        }
      `}</style>
    </div>
  )
}

// ── AviamastersGame ────────────────────────────────────────────────────────────
export default function AviamastersGame() {
  const { balance, placeBet } = useCasino()

  const [phase,      setPhase]      = useState('betting')
  const [bet,        setBet]        = useState(50)
  const [speed,      setSpeed]      = useState('walking')
  const [multiplier, setMultiplier] = useState(1.00)
  const [flashKind,  setFlashKind]  = useState(null)
  const [gameResult, setGameResult] = useState(null)
  const [wonAmount,  setWonAmount]  = useState(0)

  const [usedBoosters, setUsedBoosters] = useState(INITIAL_BOOSTERS)
  const [nitroActive,  setNitroActive]  = useState(false)
  const [winTier,      setWinTier]      = useState(null)

  const [safeLanding, setSafeLanding] = useState(false)
  const safeLandingRef = useRef(false)
  useEffect(() => { safeLandingRef.current = safeLanding }, [safeLanding])

  const [autoRounds,       setAutoRounds]       = useState(0)   // >0 = autoplay running
  const [autoStartPending, setAutoStartPending] = useState(false)
  const autoRoundsRef = useRef(0)
  useEffect(() => { autoRoundsRef.current = autoRounds }, [autoRounds])

  const roundRef        = useRef(null)
  // Physics refs (replace old idxRef / totalEvtsRef / intervalRef)
  const physicsRafRef   = useRef(null)
  const lastPhysicsRef  = useRef(null)
  const planeTRef       = useRef(0)
  const controlPtsRef   = useRef([])
  const badgesRef       = useRef([])
  const multRef         = useRef(1.0)
  // Stable refs for stale-closure safety
  const betRef          = useRef(bet)
  const balanceRef      = useRef(balance)
  const speedRef        = useRef(speed)
  const placeBetRef     = useRef(placeBet)
  const nitroActiveRef  = useRef(false)

  useEffect(() => { betRef.current       = bet      }, [bet])
  useEffect(() => { balanceRef.current   = balance  }, [balance])
  useEffect(() => { speedRef.current     = speed    }, [speed])
  useEffect(() => { placeBetRef.current  = placeBet }, [placeBet])
  useEffect(() => { nitroActiveRef.current = nitroActive }, [nitroActive])

  // Physics loop — rAF replaces setInterval; nitroActiveRef is read each frame
  useEffect(() => {
    if (phase !== 'flying') return
    lastPhysicsRef.current = null

    function physicsFrame(ts) {
      if (!lastPhysicsRef.current) lastPhysicsRef.current = ts
      const dt = Math.min((ts - lastPhysicsRef.current) / 1000, 0.05)
      lastPhysicsRef.current = ts

      const speed     = T_SPEEDS[speedRef.current] ?? T_SPEEDS.walking
      const effSpeed  = nitroActiveRef.current ? speed * 2 : speed
      planeTRef.current = Math.min(1, planeTRef.current + effSpeed * dt)

      // Trigger badge events by position
      for (const badge of badgesRef.current) {
        if (!badge.applied && planeTRef.current >= badge.t) {
          badge.applied = true
          applyBadgeEvent(badge)
        }
      }

      if (planeTRef.current >= 1) {
        resolveRound(roundRef.current)
        return
      }

      physicsRafRef.current = requestAnimationFrame(physicsFrame)
    }

    physicsRafRef.current = requestAnimationFrame(physicsFrame)
    return () => {
      cancelAnimationFrame(physicsRafRef.current)
      physicsRafRef.current = null
    }
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => () => cancelAnimationFrame(physicsRafRef.current), [])

  function applyBadgeEvent(badge) {
    if (badge.skipped) return
    let m = multRef.current
    if      (badge.kind === 'rocket') m = m / 2
    else if (badge.kind === 'mult')   m = Math.min(MAX_MULT, m * badge.value)
    else if (badge.kind === 'add')    m = Math.min(MAX_MULT, m + badge.value)
    m = Math.round(m * 100) / 100
    multRef.current = m
    setMultiplier(m)
    setFlashKind(badge.kind)
  }

  function resolveRound(round) {
    const finalMult        = multRef.current
    const totalBet         = betRef.current + (safeLandingRef.current ? betRef.current * 50 : 0)
    const effectiveOutcome = (round.outcome === 'splash' && safeLandingRef.current) ? 'land' : round.outcome

    if (effectiveOutcome === 'land') {
      const win    = Math.floor(betRef.current * Math.min(finalMult, MAX_MULT))
      const profit = win - totalBet
      setGameResult('win')
      setWonAmount(profit)
      setPhase('landed')
      placeBetRef.current('aviamasters', totalBet, profit)

      if      (finalMult >= WIN_TIERS.SUPER_MEGA) { setWinTier('SUPER_MEGA'); setAutoRounds(0) }
      else if (finalMult >= WIN_TIERS.MEGA)         setWinTier('MEGA')
      else if (finalMult >= WIN_TIERS.BIG)          setWinTier('BIG')
    } else {
      setGameResult('loss')
      setWonAmount(totalBet)
      setPhase('splashed')
      placeBetRef.current('aviamasters', totalBet, -totalBet)
    }

    const isSuperMega = effectiveOutcome === 'land' && finalMult >= WIN_TIERS.SUPER_MEGA
    if (!isSuperMega && autoRoundsRef.current > 1) {
      setTimeout(() => { setAutoRounds(prev => prev - 1); setAutoStartPending(true) }, 900)
    } else if (!isSuperMega) {
      setAutoRounds(0)
    }
  }

  function startFlight() {
    const totalBet = betRef.current + (safeLandingRef.current ? betRef.current * 50 : 0)
    if ((balanceRef.current ?? 0) < totalBet) return

    const round = generateRound()
    const { controlPts, badges } = assignBadgePositions(round.events, round.outcome)

    roundRef.current       = round
    controlPtsRef.current  = controlPts
    badgesRef.current      = badges
    planeTRef.current      = 0
    multRef.current        = 1.0
    lastPhysicsRef.current = null

    setMultiplier(1.00)
    setFlashKind(null)
    setGameResult(null)
    setWonAmount(0)
    setUsedBoosters(INITIAL_BOOSTERS)
    setNitroActive(false)
    nitroActiveRef.current = false
    setWinTier(null)
    setPhase('flying')
  }

  function handlePlayAgain() {
    cancelAnimationFrame(physicsRafRef.current)
    physicsRafRef.current  = null
    planeTRef.current      = 0
    multRef.current        = 1.0
    controlPtsRef.current  = []
    badgesRef.current      = []
    setPhase('betting')
    setMultiplier(1.00)
    setFlashKind(null)
    setGameResult(null)
    setWonAmount(0)
    setUsedBoosters(INITIAL_BOOSTERS)
    setNitroActive(false)
    nitroActiveRef.current = false
    setWinTier(null)
    setAutoRounds(0)
    setAutoStartPending(false)
  }

  function handleBoosterActivate(kind) {
    if (!roundRef.current || usedBoosters[kind]) return
    const currentIdx = badgesRef.current.reduce((max, b, i) => b.applied ? i : max, -1)
    const { events: newBadges, outcome: newOutcome } =
      applyBooster(badgesRef.current, currentIdx, kind, roundRef.current.outcome)
    badgesRef.current = newBadges
    roundRef.current  = { ...roundRef.current, outcome: newOutcome }
    setUsedBoosters(prev => ({ ...prev, [kind]: true }))
    if (kind === 'nitro') {
      nitroActiveRef.current = true
      setNitroActive(true)
    }
  }

  useEffect(() => {
    if (!autoStartPending) return
    setAutoStartPending(false)
    startFlight()
    // startFlight reads balanceRef/betRef/safeLandingRef — always current via refs
  }, [autoStartPending]) // eslint-disable-line react-hooks/exhaustive-deps

  if (balance === null) {
    return (
      <GameLayout title="Aviamasters">
        <div className="flex items-center justify-center h-48">
          <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        </div>
      </GameLayout>
    )
  }

  const isBetting = phase === 'betting'
  const isFlying  = phase === 'flying'
  const isResult  = phase === 'landed' || phase === 'splashed'

  return (
    <GameLayout title="Aviamasters">
      <div className="flex flex-col items-center gap-5">

        <GameBoard
          phase={phase}
          planeTRef={planeTRef}
          controlPtsRef={controlPtsRef}
          badgesRef={badgesRef}
          multRef={multRef}
          bet={bet}
        />

        <BoosterBar
          usedBoosters={usedBoosters}
          onActivate={handleBoosterActivate}
          isFlying={isFlying}
        />

        <div className="w-full max-w-md flex flex-col gap-4">
          {isBetting && (
            <BettingPanel
              bet={bet} onBet={setBet}
              balance={balance}
              speed={speed} onSpeed={setSpeed}
              safeLanding={safeLanding} onSafeLanding={setSafeLanding}
              onAutoRounds={count => { autoRoundsRef.current = count; setAutoRounds(count); startFlight() }}
            />
          )}

          {isBetting && (
            autoRounds > 0 ? (
              <button
                onClick={() => setAutoRounds(0)}
                className="w-full py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
                  bg-red-400/20 border border-red-400/40 text-red-400 hover:bg-red-400/30 active:scale-95"
              >
                Stop Auto ({autoRounds} left)
              </button>
            ) : (
              <button
                onClick={startFlight}
                disabled={(balance ?? 0) < bet + (safeLanding ? bet * 50 : 0)}
                className={`w-full py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
                  ${(balance ?? 0) < bet + (safeLanding ? bet * 50 : 0)
                    ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                    : 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_24px_rgba(251,191,36,0.3)] hover:shadow-[0_0_32px_rgba(251,191,36,0.45)] active:scale-95'}`}
              >
                Spin! 🛩️
              </button>
            )
          )}

          {isFlying && (
            <div className="w-full py-3.5 rounded-2xl font-bold text-center bg-cp-elevated border border-cp-border flex items-center justify-center gap-2">
              <span className="text-cp-muted">In flight…</span>
              <span className="text-amber-400">{multiplier.toFixed(2)}×</span>
              {autoRounds > 0 && (
                <span className="text-xs text-cp-muted font-normal">· Auto {autoRounds}</span>
              )}
            </div>
          )}

          {isResult && (
            <ResultPanel
              phase={phase}
              multiplier={multiplier}
              bet={bet}
              wonAmount={wonAmount}
              onPlayAgain={handlePlayAgain}
            />
          )}
        </div>

        {isResult && (
          <div className="w-full max-w-md">
            <ResultBanner
              result={gameResult}
              amount={wonAmount}
              message={phase === 'landed'
                ? `Landed at ${multiplier.toFixed(2)}×`
                : `Splashed at ${multiplier.toFixed(2)}×`}
            />
          </div>
        )}
      </div>

      {winTier && (
        <WinPopup
          tier={winTier}
          multiplier={multiplier}
          onDismiss={() => setWinTier(null)}
        />
      )}
    </GameLayout>
  )
}
