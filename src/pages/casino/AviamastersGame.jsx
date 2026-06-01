import { useState, useEffect, useRef } from 'react'
import { GameLayout, BetChips, ResultBanner, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'
import {
  generateRound, SPEEDS, MAX_MULT, WIN_TIERS, applyBooster,
} from './aviamastersEngine'

// ── Bezier helpers ─────────────────────────────────────────────────────────────
// All coordinates are in a 0-100 viewBox space.
const P0 = { x: 8,  y: 82 }  // start (bottom-left)
const P1 = { x: 55, y: 30 }  // control point
const P2 = { x: 92, y: 18 }  // end (top-right, near carrier)

function bezierPoint(t) {
  const mt = 1 - t
  return {
    x: mt * mt * P0.x + 2 * mt * t * P1.x + t * t * P2.x,
    y: mt * mt * P0.y + 2 * mt * t * P1.y + t * t * P2.y,
  }
}

function bezierTrailPoints(tEnd) {
  if (tEnd <= 0) return ''
  return Array.from({ length: 41 }, (_, i) => {
    const { x, y } = bezierPoint((i / 40) * tEnd)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

// ── Static star field (deterministic, no Math.random) ─────────────────────────
const STARS = Array.from({ length: 22 }, (_, i) => ({
  x:  ((i * 97 + 13) * 31) % 100,
  y:  ((i * 61 + 7)  * 17) % 50,
  r:  i % 4 === 0 ? 1 : 0.5,
  op: 0.2 + (i % 6) * 0.07,
}))

// ── Multiplier colour ──────────────────────────────────────────────────────────
function multColor(m, splashed) {
  if (splashed) return '#f87171'
  if (m < 2)    return '#86efac'
  if (m < 5)    return '#fde68a'
  return '#fdba74'
}

// ── GameBoard ──────────────────────────────────────────────────────────────────
// Pure display component — no state, no side-effects.
function GameBoard({ phase, planeT, badges, multiplier, flashKind, bet }) {
  const isSplashed = phase === 'splashed'
  const isLanded   = phase === 'landed'
  const isFlying   = phase === 'flying'
  const isActive   = isFlying || isLanded || isSplashed

  const { x: planeX, y: planeY } = bezierPoint(Math.min(1, planeT))
  const color = multColor(multiplier, isSplashed)

  return (
    <div style={{
      width: '100%', maxWidth: 448, height: 360,
      borderRadius: 16, overflow: 'hidden', position: 'relative',
      border: '1px solid #1f2937',
      background: 'linear-gradient(180deg, #030712 0%, #0f172a 78%, #0c1425 100%)',
    }}>

      {/* Stars */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        viewBox="0 0 100 100" preserveAspectRatio="none">
        {STARS.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="white" opacity={s.op} />
        ))}
      </svg>

      {/* Bezier track (dashed guide line) */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        viewBox="0 0 100 100" preserveAspectRatio="none">
        <path
          d={`M ${P0.x},${P0.y} Q ${P1.x},${P1.y} ${P2.x},${P2.y}`}
          stroke="#ffffff10" strokeWidth="0.7" strokeDasharray="2,2.5" fill="none"
        />
      </svg>

      {/* Trail (coloured polyline up to current planeT) */}
      {isActive && (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="amTrail3" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor={color} stopOpacity="0"   />
              <stop offset="100%" stopColor={color} stopOpacity="0.6" />
            </linearGradient>
          </defs>
          <polyline
            points={bezierTrailPoints(Math.min(1, planeT))}
            stroke="url(#amTrail3)" strokeWidth="1.4" fill="none" strokeLinecap="round"
          />
        </svg>
      )}

      {/* Collectible badges (SVG rect+text for add/mult; absolute div for rockets) */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        viewBox="0 0 100 100" preserveAspectRatio="none">
        {isActive && badges.filter(b => b.kind !== 'rocket').map((b, i) => {
          const { x, y } = bezierPoint(b.t)
          const fill  = b.kind === 'mult' ? '#fbbf24' : '#86efac'
          const label = b.kind === 'mult' ? `×${b.value}` : `+${b.value}`
          return (
            <g key={b.idx} opacity={b.collected ? 0.2 : 1} style={{ transition: 'opacity 0.3s' }}>
              <rect x={x - 5.5} y={y - 3.2} width={11} height={6.4} rx={1.5} fill={fill} />
              <text x={x} y={y + 1.3} textAnchor="middle"
                fontSize="3.2" fontWeight="800" fill="#000">{label}</text>
            </g>
          )
        })}
      </svg>

      {/* Rocket emoji badges (absolute-positioned divs — SVG can't render emoji reliably) */}
      {isActive && badges.filter(b => b.kind === 'rocket').map((b, i) => {
        const { x, y } = bezierPoint(b.t)
        return (
          <div key={b.idx} style={{
            position: 'absolute', left: `${x}%`, top: `${y}%`,
            transform: 'translate(-50%, -50%)',
            fontSize: 13, lineHeight: 1,
            opacity: b.collected ? 0.15 : b.skipped ? 0.35 : 1,
            filter: b.skipped ? 'grayscale(1)' : undefined,
            transition: 'opacity 0.3s',
          }}>
            🚀
          </div>
        )
      })}

      {/* Ocean strip */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: '18%',
        background: 'linear-gradient(180deg, rgba(14,165,233,0.18) 0%, rgba(2,6,23,0.9) 100%)',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 4,
          background: 'repeating-linear-gradient(90deg, transparent 0px, transparent 18px, rgba(56,189,248,0.22) 18px, rgba(56,189,248,0.22) 36px)',
          animation: 'amWave 3s ease-in-out infinite',
        }} />
      </div>

      {/* Aircraft carrier */}
      <div style={{
        position: 'absolute', right: '3%', bottom: '17%',
        fontSize: 22, lineHeight: 1,
        filter: isLanded ? 'drop-shadow(0 0 10px #fbbf24)' : undefined,
        transition: 'filter 0.4s',
      }}>
        🚢
      </div>

      {/* Plane */}
      <div style={{
        position: 'absolute', left: `${planeX}%`, top: `${planeY}%`,
        transform: 'translate(-50%, -50%)',
        fontSize: 24, lineHeight: 1,
        animation:  isFlying   ? 'amPlaneFly 0.8s ease-in-out infinite' : 'none',
        filter:     isSplashed ? undefined : `drop-shadow(0 0 8px ${color})`,
        transition: isFlying   ? 'left 0.18s linear, top 0.18s linear' : 'none',
      }}>
        {isSplashed ? '🌊' : isLanded ? '🛬' : '🛩️'}
      </div>

      {/* Counter Balance readout */}
      <div style={{
        position: 'absolute', top: '38%', left: '50%',
        transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none',
      }}>
        <div
          key={`${multiplier}-${flashKind}`}
          style={{
            fontSize: 54, fontWeight: 900, color, lineHeight: 1,
            textShadow: `0 0 28px ${color}80`, letterSpacing: '-2px',
            animation: flashKind && isFlying ? 'amBump 0.28s ease-out' : 'none',
          }}>
          {multiplier.toFixed(2)}×
        </div>
        {isFlying && bet != null && (
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
            Bet: {bet.toLocaleString()} coins
          </div>
        )}
        {isSplashed && (
          <div style={{ fontSize: 11, fontWeight: 700, color: '#f87171', letterSpacing: 3, marginTop: 4, textTransform: 'uppercase' }}>
            SPLASH
          </div>
        )}
      </div>
    </div>
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
function BettingPanel({ bet, onBet, balance, speed, onSpeed, safeLanding, onSafeLanding }) {
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
      <label className={`flex items-center justify-between gap-3 cursor-pointer select-none
        rounded-xl px-3 py-2.5 border transition-all
        ${safeLanding ? 'border-sky-400/40 bg-sky-400/5' : 'border-cp-border bg-cp-elevated'}
        ${!canAfford ? 'opacity-40 cursor-not-allowed' : ''}`}>
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
          className="w-4 h-4 accent-sky-400 cursor-pointer"
        />
      </label>
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

// ── AviamastersGame ────────────────────────────────────────────────────────────
export default function AviamastersGame() {
  const { balance, placeBet } = useCasino()

  const [phase,      setPhase]      = useState('betting')
  const [bet,        setBet]        = useState(50)
  const [speed,      setSpeed]      = useState('walking')
  const [multiplier, setMultiplier] = useState(1.00)
  const [eventIdx,   setEventIdx]   = useState(-1)
  const [flashKind,  setFlashKind]  = useState(null)
  const [gameResult, setGameResult] = useState(null)
  const [wonAmount,  setWonAmount]  = useState(0)

  const [usedBoosters, setUsedBoosters] = useState(INITIAL_BOOSTERS)
  const [nitroActive,  setNitroActive]  = useState(false)

  const [safeLanding, setSafeLanding] = useState(false)
  const safeLandingRef = useRef(false)
  useEffect(() => { safeLandingRef.current = safeLanding }, [safeLanding])

  const roundRef       = useRef(null)
  const idxRef         = useRef(-1)
  const multRef        = useRef(1.0)      // running multiplier — avoids stale closure in setInterval
  const totalEvtsRef   = useRef(0)
  const betRef         = useRef(bet)
  const balanceRef     = useRef(balance)
  const speedRef       = useRef(speed)
  const placeBetRef    = useRef(placeBet)
  const intervalRef    = useRef(null)

  useEffect(() => { betRef.current     = bet     }, [bet])
  useEffect(() => { balanceRef.current = balance }, [balance])
  useEffect(() => { speedRef.current   = speed   }, [speed])
  useEffect(() => { placeBetRef.current = placeBet }, [placeBet])

  // Inject keyframes once
  useEffect(() => {
    const id = 'aviamasters-kf2'
    if (document.getElementById(id)) return
    const s = document.createElement('style')
    s.id = id
    s.textContent = `
      @keyframes amPlaneFly {
        0%,100% { transform: translate(-50%,-50%) translateY(0) rotate(-8deg); }
        50%     { transform: translate(-50%,-50%) translateY(-4px) rotate(-13deg); }
      }
      @keyframes amBump {
        0%   { transform: translate(-50%,-50%) scale(1); }
        40%  { transform: translate(-50%,-50%) scale(1.18); }
        100% { transform: translate(-50%,-50%) scale(1); }
      }
      @keyframes amWave {
        0%,100% { transform: translateX(0); }
        50%     { transform: translateX(-18px); }
      }
    `
    document.head.appendChild(s)
  }, [])

  // Flight loop — reads from roundRef so it stays current after booster mutations
  useEffect(() => {
    if (phase !== 'flying') return
    const baseTick = SPEEDS[speedRef.current] ?? SPEEDS.walking
    const tick     = nitroActive ? Math.floor(baseTick / 2) : baseTick

    intervalRef.current = setInterval(() => {
      const round   = roundRef.current        // fresh read each tick
      const nextIdx = idxRef.current + 1

      if (nextIdx >= round.events.length) {
        clearInterval(intervalRef.current)
        resolveRound(round)
        return
      }

      const ev = round.events[nextIdx]
      idxRef.current = nextIdx
      setEventIdx(nextIdx)

      if (!ev.skipped) {
        let m = multRef.current
        if      (ev.kind === 'rocket') m = m / 2
        else if (ev.kind === 'mult')   m = Math.min(MAX_MULT, m * ev.value)
        else if (ev.kind === 'add')    m = Math.min(MAX_MULT, m + ev.value)
        m = Math.round(m * 100) / 100
        multRef.current = m
        setMultiplier(m)
        setFlashKind(ev.kind)
      }
    }, tick)

    return () => clearInterval(intervalRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, nitroActive])

  useEffect(() => () => clearInterval(intervalRef.current), [])

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
    } else {
      setGameResult('loss')
      setWonAmount(totalBet)
      setPhase('splashed')
      placeBetRef.current('aviamasters', totalBet, -totalBet)
    }
  }

  function startFlight() {
    const totalBet = betRef.current + (safeLandingRef.current ? betRef.current * 50 : 0)
    if ((balanceRef.current ?? 0) < totalBet) return
    const round = generateRound()
    roundRef.current     = round
    idxRef.current       = -1
    multRef.current      = 1.0
    totalEvtsRef.current = round.events.length
    setEventIdx(-1)
    setMultiplier(1.00)
    setFlashKind(null)
    setGameResult(null)
    setWonAmount(0)
    setUsedBoosters(INITIAL_BOOSTERS)
    setNitroActive(false)
    setPhase('flying')
  }

  function handlePlayAgain() {
    clearInterval(intervalRef.current)
    idxRef.current  = -1
    multRef.current = 1.0
    setPhase('betting')
    setMultiplier(1.00)
    setEventIdx(-1)
    setFlashKind(null)
    setGameResult(null)
    setWonAmount(0)
    setUsedBoosters(INITIAL_BOOSTERS)
    setNitroActive(false)
  }

  function handleBoosterActivate(kind) {
    if (!roundRef.current || usedBoosters[kind]) return
    const { events, outcome } = roundRef.current
    const result = applyBooster(events, idxRef.current, kind, outcome)
    roundRef.current = { ...roundRef.current, events: result.events, outcome: result.outcome }
    setUsedBoosters(prev => ({ ...prev, [kind]: true }))
    if (kind === 'nitro') setNitroActive(true)
  }

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

  const total  = totalEvtsRef.current || 1
  const planeT = isResult ? 1 : isFlying ? Math.min(1, (eventIdx + 1) / total) : 0

  const round  = roundRef.current
  const badges = (round?.events ?? []).map((ev, i) => ({
    ...ev,
    idx:       i,
    t:         (i + 1) / (round.events.length || 1),
    collected: i <= eventIdx,
  }))

  return (
    <GameLayout title="Aviamasters">
      <div className="flex flex-col items-center gap-5">

        <GameBoard
          phase={phase}
          planeT={planeT}
          badges={badges}
          multiplier={multiplier}
          flashKind={flashKind}
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
            />
          )}

          {isBetting && (
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
          )}

          {isFlying && (
            <div className="w-full py-3.5 rounded-2xl font-bold text-center bg-cp-elevated border border-cp-border flex items-center justify-center gap-2">
              <span className="text-cp-muted">In flight…</span>
              <span className="text-amber-400">{multiplier.toFixed(2)}×</span>
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
    </GameLayout>
  )
}
