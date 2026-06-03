import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { GameLayout, BetChips, ResultBanner, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'

// ── Constants (server contract is unchanged; see 042_casino_chicken.sql) ───────
// Every cashout point keeps a positive house edge: lane1 0.72*1.3=93.6%, etc.
const LANE_MULTIPLIERS = [1.3, 2.0, 3.2, 4.8, 7.2, 11.0, 18.0]
const SAFE_PROBS       = [0.72, 0.64, 0.56, 0.48, 0.40, 0.32, 0.25]
const NUM_LANES        = 7
// Per-lane traffic feel (ms) — deeper = faster. Cars per lane.
const LANE_SPEEDS = [3800, 3200, 2700, 2200, 1800, 1400, 1100]
const LANE_CARS   = [1, 2, 1, 2, 2, 3, 3]

// Stage geometry — kept in sync with the CSS custom props below.
const LANE_W  = 114
const WALK_W  = 96
const STAGE_H = 420

// Car paint pairs (body top / bottom).
const CAR_PAINT = [
  ['#e2554f', '#b8332e'], ['#f0b54a', '#c98a1a'], ['#5f9bdc', '#2f6aa6'],
  ['#7bd389', '#3f9a55'], ['#c98ae0', '#8a4eb0'], ['#e8e2d4', '#b4ac98'],
  ['#ef8b5b', '#c2592c'], ['#6fd0c4', '#2f9588'],
]

const HISTORY_KEY = 'cp-studios:chicken-history'
const HISTORY_MAX = 8

const fmtMult = (m) => m.toFixed(2).replace(/0$/, '')

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.slice(0, HISTORY_MAX) : []
  } catch {
    return []
  }
}

// Inner markup shared by ambient cars (JSX) and the death "slam" car (string).
const CAR_INNER_HTML =
  '<div class="shadow"></div><div class="cbody"></div><div class="roof"></div>' +
  '<div class="glass"></div><div class="glass rear"></div>' +
  '<span class="tail l"></span><span class="tail r"></span>' +
  '<span class="head l"></span><span class="head r"></span><span class="beam"></span>'

function CarArt() {
  return (
    <>
      <div className="shadow" />
      <div className="cbody" />
      <div className="roof" />
      <div className="glass" />
      <div className="glass rear" />
      <span className="tail l" />
      <span className="tail r" />
      <span className="head l" />
      <span className="head r" />
      <span className="beam" />
    </>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ChickenRoadGame() {
  const { balance, roundAction, loadBalance } = useCasino()

  const [phase, setPhase]     = useState('betting') // betting | crossing | dead | cashedout
  const [bet, setBet]         = useState(50)
  const [pos, setPos]         = useState(-1)        // highest safely-crossed lane (-1 = sidewalk)
  const [curMult, setCurMult] = useState(1.0)
  const [roundId, setRoundId] = useState(null)
  const [busy, setBusy]       = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const [error, setError]     = useState(null)
  const [hitLane, setHitLane] = useState(null)
  const [gameResult, setGameResult] = useState(null)
  const [wonAmount, setWonAmount]   = useState(0)
  const [history, setHistory] = useState(loadHistory)

  // One-shot / persisted animation flags (state-driven so React re-renders don't wipe them)
  const [chookAnim, setChookAnim] = useState('') // '' | hopping | squashed | cheer
  const [shaking, setShaking]     = useState(false)
  const [flashGo, setFlashGo]     = useState(false)
  const [pop, setPop]             = useState(false)
  const [frozen, setFrozen]       = useState(false)

  const stageRef       = useRef(null)
  const worldRef       = useRef(null)
  const chookHostRef   = useRef(null)
  const chookShadowRef = useRef(null)
  const fxLayerRef     = useRef(null)
  const impactFlashRef = useRef(null)
  const visualPosRef   = useRef(-1) // the lane the chicken is *drawn* on (may lead pos mid-hop)
  const aliveRef       = useRef(true)

  const isBetting   = phase === 'betting'
  const isCrossing  = phase === 'crossing'
  const isDead      = phase === 'dead'
  const isCashedOut = phase === 'cashedout'
  const isResult    = isDead || isCashedOut

  const nextIdx  = pos + 1
  const nextMult = nextIdx < NUM_LANES ? LANE_MULTIPLIERS[nextIdx] : null
  const nextSafe = nextIdx < NUM_LANES ? SAFE_PROBS[nextIdx] : null
  const cashPayout = pos >= 0 ? bet * curMult : 0

  // ── Geometry / camera ───────────────────────────────────────────────────────
  const laneCenterX = (i) => WALK_W + i * LANE_W + LANE_W / 2
  const SIDEWALK_X = WALK_W / 2

  function cameraTx(p) {
    const stageEl = stageRef.current
    if (!stageEl) return 0
    const viewW = stageEl.clientWidth
    const worldW = WALK_W + NUM_LANES * LANE_W
    const focusX = (p < 0 ? SIDEWALK_X : laneCenterX(p)) + LANE_W * 0.55
    const minTx = Math.min(0, viewW - worldW)
    return Math.max(minTx, Math.min(0, viewW * 0.42 - focusX))
  }

  function placeChicken(p, animated) {
    visualPosRef.current = p
    const host = chookHostRef.current
    const sh = chookShadowRef.current
    const world = worldRef.current
    if (!host || !sh || !world) return
    const tx = cameraTx(p)
    const worldX = p < 0 ? SIDEWALK_X : laneCenterX(p)
    const screenX = worldX + tx
    const y = STAGE_H * 0.5
    if (!animated) {
      world.style.transition = 'none'; host.style.transition = 'none'; sh.style.transition = 'none'
    }
    world.style.transform = `translateX(${tx}px)`
    host.style.transform = `translate(${screenX - 27}px, ${y - 32}px)`
    sh.style.transform = `translate(${screenX}px, ${y + 30}px) translateX(-50%)`
    if (!animated) {
      void world.offsetWidth
      world.style.transition = ''; host.style.transition = ''; sh.style.transition = ''
    }
  }

  // Initial placement + keep the chicken anchored on resize.
  useLayoutEffect(() => {
    placeChicken(-1, false)
    const onResize = () => placeChicken(visualPosRef.current, false)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => { aliveRef.current = false }, [])

  // ── FX helpers (imperative particle bursts over the stage) ───────────────────
  function featherBurst(x, y, count) {
    const layer = fxLayerRef.current
    if (!layer) return
    for (let i = 0; i < count; i++) {
      const f = document.createElement('div')
      f.className = Math.random() < 0.35 ? 'dust' : 'feather'
      f.style.left = x + 'px'; f.style.top = y + 'px'
      layer.appendChild(f)
      const ang = Math.random() * Math.PI * 2
      const dist = 40 + Math.random() * 90
      const dx = Math.cos(ang) * dist
      const dy = Math.sin(ang) * dist - 30
      const rot = Math.random() * 720 - 360
      f.animate([
        { transform: 'translate(-50%,-50%) rotate(0) scale(1)', opacity: 1 },
        { transform: `translate(${dx - 20}px,${dy - 10}px) rotate(${rot}deg) scale(.9)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${dx}px,${dy + 70}px) rotate(${rot * 1.4}deg) scale(.5)`, opacity: 0 },
      ], { duration: 700 + Math.random() * 500, easing: 'cubic-bezier(.2,.6,.3,1)' }).onfinish = () => f.remove()
    }
  }

  function coinBurst(x, y, count) {
    const layer = fxLayerRef.current
    if (!layer) return
    for (let i = 0; i < count; i++) {
      const c = document.createElement('div')
      c.className = 'coin-fx'
      c.style.left = x + 'px'; c.style.top = y + 'px'
      layer.appendChild(c)
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1
      const dist = 60 + Math.random() * 120
      const dx = Math.cos(ang) * dist
      const peak = -(50 + Math.random() * 120)
      setTimeout(() => {
        c.animate([
          { transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
          { transform: `translate(${dx * 0.5}px,${peak}px) scale(1.1)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${dx}px,120px) scale(.8)`, opacity: 0 },
        ], { duration: 900 + Math.random() * 300, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => c.remove()
      }, i * 18)
    }
  }

  function coinSpark(p) {
    const layer = fxLayerRef.current
    if (!layer) return
    const tx = cameraTx(p)
    const x = laneCenterX(p) + tx
    const y = STAGE_H * 0.5 - 10
    for (let i = 0; i < 2; i++) {
      const c = document.createElement('div')
      c.className = 'coin-fx'
      c.style.left = x + 'px'; c.style.top = y + 'px'; c.style.width = '13px'; c.style.height = '13px'
      layer.appendChild(c)
      const dx = (Math.random() - 0.5) * 50
      c.animate([
        { transform: 'translate(-50%,-50%) scale(.4)', opacity: 0.9 },
        { transform: `translate(${dx}px,-40px) scale(1)`, opacity: 0 },
      ], { duration: 560, easing: 'ease-out' }).onfinish = () => c.remove()
    }
  }

  function floatText(txt, cls) {
    const layer = fxLayerRef.current
    if (!layer) return
    const el = document.createElement('div')
    el.className = 'floattext ' + cls
    el.textContent = txt
    layer.appendChild(el)
    el.animate([
      { transform: 'translateX(-50%) translateY(10px) scale(.6)', opacity: 0 },
      { transform: 'translateX(-50%) translateY(-14px) scale(1.1)', opacity: 1, offset: 0.4 },
      { transform: 'translateX(-50%) translateY(-46px) scale(1)', opacity: 0 },
    ], { duration: 1100, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => el.remove()
  }

  function addHistory(mult, won) {
    setHistory((prev) => {
      const next = [{ mult, won }, ...prev].slice(0, HISTORY_MAX)
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  // ── Death sequence (a specific car slams the chicken in the failed lane) ─────
  function runDeath(target) {
    setIsAnimating(false)
    setPhase('dead')
    setHitLane(target)
    setGameResult('loss')
    setWonAmount(bet)
    setFrozen(true)
    addHistory(LANE_MULTIPLIERS[target], false)

    const lane = worldRef.current?.querySelector(`[data-carlane="${target}"]`)
    if (!lane) { impact(target, null); return }
    const car = document.createElement('div')
    car.className = 'car slam'
    const paint = CAR_PAINT[(target + 2) % CAR_PAINT.length]
    car.style.setProperty('--c1', paint[0])
    car.style.setProperty('--c2', paint[1])
    car.innerHTML = CAR_INNER_HTML
    lane.appendChild(car)

    // Slam the car down onto the chicken. setTimeout (not rAF) sequencing so the
    // impact still lands if frames are throttled (hidden tab etc.).
    const slamY = STAGE_H * 0.5 + 6
    car.style.transform = `translateX(-50%) translateY(${slamY}px)`
    car.animate(
      [
        { transform: 'translateX(-50%) translateY(-120px)' },
        { transform: `translateX(-50%) translateY(${slamY}px)` },
      ],
      { duration: 230, easing: 'cubic-bezier(.5,0,.9,.6)' }
    )
    setTimeout(() => impact(target, car), 230)
  }

  function impact(target, car) {
    if (!aliveRef.current) return
    setChookAnim('squashed')
    setShaking(true)
    setTimeout(() => aliveRef.current && setShaking(false), 460)

    const tx = cameraTx(visualPosRef.current)
    const fxX = laneCenterX(target) + tx
    if (impactFlashRef.current) impactFlashRef.current.style.setProperty('--fx', fxX + 'px')
    setFlashGo(true)
    featherBurst(fxX, STAGE_H * 0.5, 16)

    if (car) {
      setTimeout(() => {
        const fromY = STAGE_H * 0.5 + 6
        car.style.transform = `translateX(-50%) translateY(${STAGE_H + 140}px)`
        const a = car.animate(
          [
            { transform: `translateX(-50%) translateY(${fromY}px)` },
            { transform: `translateX(-50%) translateY(${STAGE_H + 140}px)` },
          ],
          { duration: 420, easing: 'ease-in' }
        )
        a.onfinish = () => car.remove()
        setTimeout(() => car.remove(), 900) // safety net if onfinish never fires
      }, 180)
    }
  }

  // ── Flow: start ──────────────────────────────────────────────────────────────
  async function handleStart() {
    if ((balance ?? 0) < bet || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await roundAction('chicken_open', { p_bet: bet })
      setRoundId(r.round_id)
      setPhase('crossing')
      setPos(-1)
      setCurMult(1.0)
      setHitLane(null)
      setGameResult(null)
      setWonAmount(0)
      setChookAnim('')
      setFlashGo(false)
      setShaking(false)
      setFrozen(false)
      worldRef.current?.querySelectorAll('.car.slam').forEach((n) => n.remove())
      placeChicken(-1, false)
    } catch (e) {
      console.error('[ChickenRoadGame] open error:', e)
      setError('Could not start — try again.')
    } finally {
      setBusy(false)
    }
  }

  // ── Flow: cross one lane (outcome decided by the server) ─────────────────────
  async function handleCross() {
    if (phase !== 'crossing' || isAnimating || busy) return
    const target = pos + 1
    if (target >= NUM_LANES) return

    setIsAnimating(true)
    setError(null)

    // Optimistic hop: the chicken leaps into the target lane while we ask the server.
    setChookAnim('hopping')
    setTimeout(() => aliveRef.current && setChookAnim((a) => (a === 'hopping' ? '' : a)), 500)
    placeChicken(target, true)

    let r
    try {
      const [res] = await Promise.all([
        roundAction('chicken_step', { p_round: roundId }),
        new Promise((resolve) => setTimeout(resolve, 420)),
      ])
      r = res
    } catch (e) {
      console.error('[ChickenRoadGame] step error:', e)
      placeChicken(pos, true) // hop back to the last safe lane
      setError('Cross failed — try again.')
      setIsAnimating(false)
      return
    }

    if (r.safe) {
      setPos(target)
      setCurMult(LANE_MULTIPLIERS[target])
      setPop(true)
      setTimeout(() => aliveRef.current && setPop(false), 460)
      coinSpark(target)

      if (target === NUM_LANES - 1) {
        // Crossed all 7 — the server auto-cashed at 18×.
        const win = Math.floor(bet * (LANE_MULTIPLIERS[NUM_LANES - 1] - 1))
        finishCashout(LANE_MULTIPLIERS[NUM_LANES - 1], win, target, true)
        return
      }
      setIsAnimating(false)
    } else {
      runDeath(target)
    }
  }

  // ── Flow: cash out ───────────────────────────────────────────────────────────
  async function handleCashOut() {
    if (phase !== 'crossing' || pos < 0 || isAnimating || busy) return
    setBusy(true)
    setError(null)
    const mult = curMult
    const win = Math.floor(bet * (mult - 1))
    try {
      await roundAction('chicken_cashout', { p_round: roundId })
      finishCashout(mult, win, pos, false)
      await loadBalance()
    } catch (e) {
      console.error('[ChickenRoadGame] cashout error:', e)
      setError('Cash out failed — try again.')
    } finally {
      setBusy(false)
    }
  }

  function finishCashout(mult, win, lane, full) {
    setPhase('cashedout')
    setGameResult('win')
    setWonAmount(win)
    setCurMult(mult)
    setIsAnimating(false)
    setFrozen(true)
    setChookAnim('cheer')
    addHistory(mult, true)
    const tx = cameraTx(lane)
    const fxX = (lane < 0 ? SIDEWALK_X : laneCenterX(lane)) + tx
    coinBurst(fxX, STAGE_H * 0.5, 26)
    floatText('+' + formatCoins(win + bet), 'win')
    if (full) loadBalance()
  }

  // ── Flow: reset ──────────────────────────────────────────────────────────────
  function handlePlayAgain() {
    setPhase('betting')
    setPos(-1)
    setCurMult(1.0)
    setHitLane(null)
    setGameResult(null)
    setWonAmount(0)
    setRoundId(null)
    setError(null)
    setIsAnimating(false)
    setChookAnim('')
    setShaking(false)
    setFlashGo(false)
    setPop(false)
    setFrozen(false)
    worldRef.current?.querySelectorAll('.car.slam').forEach((n) => n.remove())
    placeChicken(-1, false)
  }

  // ── Derived HUD pieces ───────────────────────────────────────────────────────
  const readoutLbl = isDead
    ? 'Busted'
    : isCashedOut
    ? (pos === NUM_LANES - 1 ? 'Full crossing! Max payout' : 'Cashed out')
    : 'Current multiplier'
  const hot = isCrossing && curMult >= 4.8
  const bigFont = 58 + Math.min(1, (curMult - 1) / 17) * 26

  return (
    <GameLayout title="Chicken Road">
      <style>{CR_CSS}</style>
      <div className={`cr-root flex flex-col items-center gap-5${frozen ? ' frozen' : ''}`}>

        {/* ── Stage ── */}
        <div className="w-full max-w-md">
          <div className={`stage${shaking ? ' shaking' : ''}`} ref={stageRef}>
            <div className="horizon" />
            <svg className="skyline" viewBox="0 0 440 64" preserveAspectRatio="none">
              <g fill="#0c0d10">
                <rect x="0" y="26" width="34" height="38" /><rect x="40" y="12" width="26" height="52" />
                <rect x="72" y="32" width="40" height="32" /><rect x="118" y="18" width="22" height="46" />
                <rect x="146" y="36" width="48" height="28" /><rect x="200" y="8" width="24" height="56" />
                <rect x="230" y="28" width="38" height="36" /><rect x="274" y="20" width="20" height="44" />
                <rect x="300" y="34" width="46" height="30" /><rect x="352" y="14" width="26" height="50" />
                <rect x="384" y="30" width="40" height="34" />
              </g>
            </svg>

            {/* scrolling world: sidewalk + 7 lanes */}
            <div className="world" ref={worldRef}>
              <div className="sidewalk">
                <span className="grass" />
                <span className="grass" style={{ top: 'auto', bottom: 12 }} />
              </div>
              {LANE_MULTIPLIERS.map((m, i) => {
                const cleared = i <= pos
                const isNext = isCrossing && i === pos + 1
                const busted = isDead && i === hitLane
                const cls = ['lane']
                if (cleared) cls.push('cleared')
                if (isNext) cls.push('next', 'armed')
                if (busted) cls.push('busted')
                return (
                  <div
                    key={i}
                    className={cls.join(' ')}
                    style={{ '--heat': (i / (NUM_LANES - 1)).toFixed(2) }}
                  >
                    <div className="heat" />
                    <div className="stepmark" />
                    <div className="carlane" data-carlane={i}>
                      {Array.from({ length: LANE_CARS[i] }).map((_, c) => {
                        const paint = CAR_PAINT[(i + c) % CAR_PAINT.length]
                        return (
                          <div
                            key={c}
                            className="car ambient"
                            style={{
                              animation: `crCarDrive ${LANE_SPEEDS[i]}ms linear infinite`,
                              animationDelay: `${-(LANE_SPEEDS[i] / LANE_CARS[i]) * c}ms`,
                              '--c1': paint[0],
                              '--c2': paint[1],
                            }}
                          >
                            <CarArt />
                          </div>
                        )
                      })}
                    </div>
                    <div className="mult-tab">
                      <div className="pill">{fmtMult(m)}×</div>
                      <div className="pct">{Math.round(SAFE_PROBS[i] * 100)}% safe</div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* chicken + shadow (positioned imperatively) */}
            <div className="chook-shadow" ref={chookShadowRef} />
            <div className="chook-host" ref={chookHostRef}>
              <div className={`chook${chookAnim ? ' ' + chookAnim : ''}`}>
                <div className="tail-f" />
                <div className="body" />
                <div className="wing" />
                <div className="legs"><span className="leg l" /><span className="leg r" /></div>
                <div className="head">
                  <div className="comb"><i /><i /><i /></div>
                  <div className="eye" />
                  <div className="beak" />
                  <div className="wattle" />
                </div>
              </div>
            </div>

            {/* fx + flash + vignette */}
            <div className="fx-layer" ref={fxLayerRef} />
            <div className={`impact-flash${flashGo ? ' go' : ''}`} ref={impactFlashRef} />
            <div className="vignette" />

            {/* big multiplier HUD */}
            <div className="hud-top">
              <div className={`multi-readout${pop ? ' crossing' : ''}${hot ? ' hot' : ''}${isCashedOut ? ' win' : ''}${isDead ? ' dead' : ''}`}>
                <div className="lbl">{readoutLbl}</div>
                <div className="big" style={{ fontSize: bigFont }}>
                  {curMult.toFixed(2)}<span className="x">×</span>
                </div>
                <div className="substat">
                  <div className="chip next"><span className="k">Next lane</span><span className="v">{nextMult ? fmtMult(nextMult) + '×' : '—'}</span></div>
                  <div className="chip safe"><span className="k">Safe odds</span><span className="v">{nextSafe ? Math.round(nextSafe * 100) + '%' : '—'}</span></div>
                  <div className="chip cash"><span className="k">Cash out</span><span className="v">{pos >= 0 ? formatCoins(Math.round(cashPayout)) : '—'}</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Controls ── */}
        <div className="w-full max-w-md flex flex-col gap-3">
          {isBetting && (
            <>
              <div className="bg-cp-card border border-cp-border rounded-2xl p-4">
                <BetChips bet={bet} onBet={setBet} balance={balance ?? 0} disabled={false} />
              </div>
              <button
                onClick={handleStart}
                disabled={(balance ?? 0) < bet || busy}
                className={`w-full py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
                  ${(balance ?? 0) < bet || busy
                    ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                    : 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_24px_rgba(251,191,36,0.3)] hover:shadow-[0_0_32px_rgba(251,191,36,0.45)] active:scale-95'
                  }`}
              >
                {busy ? 'Starting…' : 'Start crossing'}
                <span className="block text-[11px] font-semibold opacity-70 mt-0.5">Hop into lane 1 · 1.3×</span>
              </button>
            </>
          )}

          {isCrossing && (
            <div className="flex gap-3">
              <button
                onClick={handleCross}
                disabled={isAnimating || busy || nextIdx >= NUM_LANES}
                className={`flex-1 py-3 rounded-2xl font-bold text-base tracking-wide transition-all
                  ${isAnimating || busy || nextIdx >= NUM_LANES
                    ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                    : 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_16px_rgba(251,191,36,0.25)] active:scale-95'
                  }`}
              >
                {isAnimating ? 'Crossing…' : 'Step →'}
                <span className="block text-[11px] font-semibold opacity-70 mt-0.5">
                  {nextMult ? `to ${fmtMult(nextMult)}× · ${Math.round(nextSafe * 100)}% safe` : 'final lane reached'}
                </span>
              </button>
              <button
                onClick={handleCashOut}
                disabled={pos < 0 || isAnimating || busy}
                className={`flex-[1.15] py-3 rounded-2xl font-bold text-base tracking-wide transition-all
                  ${pos < 0 || isAnimating || busy
                    ? 'bg-cp-elevated border border-cp-border text-cp-muted cursor-not-allowed opacity-40'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_16px_rgba(52,211,153,0.25)] active:scale-95'
                  }`}
              >
                Cash out
                <span className="block text-[11px] font-semibold opacity-70 mt-0.5">
                  {pos >= 0 ? `+${formatCoins(Math.floor(bet * (curMult - 1)))} net` : 'cross a lane first'}
                </span>
              </button>
            </div>
          )}

          {isResult && (
            <button
              onClick={handlePlayAgain}
              className="w-full py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95"
            >
              Play Again
            </button>
          )}

          {error && (
            <div className="text-center rounded-xl border border-red-400/30 bg-red-400/10 py-2.5 px-4 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* ── Result banner ── */}
        {isResult && (
          <div className="w-full max-w-md">
            <ResultBanner
              result={gameResult}
              amount={wonAmount}
              message={
                isDead
                  ? `Hit in lane ${(hitLane ?? 0) + 1}`
                  : pos === NUM_LANES - 1
                  ? 'All 7 lanes crossed!'
                  : `Cashed out at ${curMult.toFixed(2)}×`
              }
            />
          </div>
        )}

        {/* ── Recent results ── */}
        {history.length > 0 && (
          <div className="w-full max-w-md flex items-center gap-2 pt-1">
            <span className="text-[10px] font-bold tracking-wider uppercase text-cp-muted shrink-0">Recent</span>
            <div className="flex gap-1.5 overflow-hidden">
              {history.map((h, i) => (
                <span
                  key={i}
                  className={`text-[11px] font-bold px-2 py-1 rounded-md border tabular-nums shrink-0
                    ${h.won
                      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25'
                      : 'text-red-400 bg-red-500/10 border-red-500/25'}`}
                >
                  {fmtMult(h.mult)}×
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </GameLayout>
  )
}

// ── Stage styles (scoped under .cr-root; ported from the approved Direction-A mockup) ──
const CR_CSS = `
.cr-root{
  --amber:#fbbf24; --amber-2:#fcd34d; --amber-3:#fde68a;
  --emer:#34d399; --emer-2:#10b981; --red:#f87171; --red-2:#ef4444;
  --text:#ede8e0; --muted:#7a7570; --warm:#c4845c; --soft:#383838;
  --border:#252525; --elev:#1f1f1f; --card:#151515;
  --road-1:#16171a; --road-2:#202225; --road-3:#101113;
  --lane-w:114px; --sidewalk-w:96px; --stage-h:420px;
  --ease:cubic-bezier(.34,1.56,.64,1);
}
.cr-root .stage{
  position:relative; height:var(--stage-h); overflow:hidden; isolation:isolate;
  border-radius:22px; border:1px solid var(--border);
  background:linear-gradient(180deg,#1b1814 0%,#14110d 26%,#0c0b0a 100%);
  box-shadow:0 24px 60px -28px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.02) inset;
}
.cr-root .stage.shaking{animation:crShake .42s cubic-bezier(.36,.07,.19,.97) both;}
@keyframes crShake{
  10%,90%{transform:translate(-2px,1px) rotate(-.3deg);}
  20%,80%{transform:translate(3px,-2px) rotate(.4deg);}
  30%,50%,70%{transform:translate(-5px,2px) rotate(-.5deg);}
  40%,60%{transform:translate(5px,-1px) rotate(.5deg);}
}
.cr-root .horizon{
  position:absolute; inset:0 0 auto 0; height:120px; z-index:1; pointer-events:none;
  background:radial-gradient(140px 60px at 18% 30%, rgba(251,191,36,.10), transparent 70%),
             radial-gradient(220px 80px at 80% 18%, rgba(196,132,92,.12), transparent 70%);
}
.cr-root .skyline{position:absolute; top:42px; left:0; right:0; height:64px; z-index:1; opacity:.5; pointer-events:none;}
.cr-root .world{
  position:absolute; top:0; left:0; bottom:0; width:max-content; z-index:3;
  display:flex; align-items:stretch; will-change:transform;
  transition:transform .52s var(--ease);
}
.cr-root .sidewalk{
  width:var(--sidewalk-w); flex:none; position:relative; align-self:stretch;
  background:repeating-linear-gradient(0deg,#23211d 0 22px,#1d1b17 22px 24px),
             linear-gradient(180deg,#2a2723,#201d19);
  border-right:3px solid #0a0908; box-shadow:inset -14px 0 24px -10px rgba(0,0,0,.7);
}
.cr-root .sidewalk::before{
  content:""; position:absolute; right:-3px; top:0; bottom:0; width:3px;
  background:linear-gradient(180deg,#c9b48f,#7c6a4c); opacity:.55;
}
.cr-root .sidewalk .grass{
  position:absolute; left:8px; right:10px; top:10px; height:7px; border-radius:6px;
  background:linear-gradient(90deg,#3a5a32,#2c4827); opacity:.6;
}
.cr-root .lane{
  width:var(--lane-w); flex:none; position:relative; overflow:hidden; align-self:stretch;
  background:linear-gradient(180deg,var(--road-1) 0%,var(--road-2) 50%,var(--road-3) 100%);
  border-right:2px dashed rgba(255,255,255,.05);
}
.cr-root .lane::before{
  content:""; position:absolute; left:50%; top:-20px; bottom:-20px; width:6px; transform:translateX(-50%);
  background:repeating-linear-gradient(180deg, rgba(251,191,36,0) 0 16px, rgba(253,224,71,.16) 16px 40px);
  opacity:0; transition:opacity .4s;
}
.cr-root .lane .heat{
  position:absolute; inset:0; pointer-events:none; opacity:0; transition:opacity .5s;
  background:linear-gradient(180deg, rgba(239,68,68,0), rgba(239,68,68,calc(.16*var(--heat))) 55%, rgba(239,68,68,0));
}
.cr-root .lane.armed .heat{opacity:1;}
.cr-root .lane.armed::before{opacity:1;}
.cr-root .lane .mult-tab{
  position:absolute; left:50%; bottom:14px; transform:translateX(-50%); z-index:6;
  text-align:center; min-width:74px; pointer-events:none;
  transition:transform .35s var(--ease), opacity .3s;
}
.cr-root .lane .mult-tab .pill{
  font-family:"Playfair Display",Georgia,serif; font-weight:800; font-size:18px; line-height:1; color:var(--text);
  background:linear-gradient(180deg,#222,#161616); border:1px solid var(--soft);
  padding:7px 9px 6px; border-radius:11px;
  box-shadow:0 6px 14px rgba(0,0,0,.5), 0 1px 0 rgba(255,255,255,.05) inset;
}
.cr-root .lane .mult-tab .pct{
  margin-top:5px; font-size:9px; font-weight:700; letter-spacing:.04em; color:var(--muted);
  font-family:"DM Sans",sans-serif;
}
.cr-root .lane.next .mult-tab{transform:translateX(-50%) translateY(-3px) scale(1.06);}
.cr-root .lane.next .mult-tab .pill{
  color:var(--amber-3); border-color:#5a4416;
  background:linear-gradient(180deg,#2a2113,#19130a);
  box-shadow:0 0 0 1px rgba(251,191,36,.25) inset, 0 8px 22px rgba(251,191,36,.18);
  animation:crTabPulse 1.4s ease-in-out infinite;
}
@keyframes crTabPulse{50%{box-shadow:0 0 0 1px rgba(251,191,36,.45) inset, 0 8px 30px rgba(251,191,36,.32);}}
.cr-root .lane.cleared .mult-tab .pill{
  color:var(--emer); border-color:#1d4d3c; background:linear-gradient(180deg,#102a22,#0b1c17);
}
.cr-root .lane.cleared::after{
  content:""; position:absolute; inset:0; pointer-events:none;
  background:linear-gradient(180deg, rgba(52,211,153,.08), transparent 60%);
}
.cr-root .lane.busted{box-shadow:0 0 0 2px rgba(239,68,68,.3) inset;}
.cr-root .lane.busted .heat{opacity:1;}
.cr-root .lane .stepmark{
  position:absolute; left:50%; top:50%; width:62px; height:62px; transform:translate(-50%,-50%);
  border-radius:50%; opacity:.5;
  background:radial-gradient(circle at 50% 40%, rgba(255,255,255,.04), transparent 60%);
  box-shadow:0 0 0 2px rgba(255,255,255,.03) inset;
}
.cr-root .carlane{position:absolute; inset:0; z-index:5; pointer-events:none;}

/* cars */
.cr-root .car{
  position:absolute; left:50%; width:62px; height:96px; z-index:5; will-change:transform;
  transform:translateX(-50%) translateY(-120px);
}
.cr-root.frozen .car.ambient{animation-play-state:paused !important;}
.cr-root .car .cbody{
  position:absolute; inset:0; border-radius:18px 18px 16px 16px;
  background:linear-gradient(180deg, var(--c1,#e2554f) 0%, var(--c2,#b8332e) 100%);
  box-shadow:0 0 0 1px rgba(0,0,0,.45), 0 2px 0 rgba(255,255,255,.18) inset, 0 -8px 14px rgba(0,0,0,.25) inset;
}
.cr-root .car .roof{position:absolute; left:9px; right:9px; top:24px; height:40px; border-radius:12px; background:linear-gradient(180deg, rgba(255,255,255,.10), rgba(0,0,0,.30));}
.cr-root .car .glass{position:absolute; left:13px; right:13px; top:28px; height:14px; border-radius:7px 7px 4px 4px; background:linear-gradient(180deg,#bfe7ff,#5b86a3); opacity:.9; box-shadow:0 1px 0 rgba(255,255,255,.4) inset;}
.cr-root .car .glass.rear{top:auto; bottom:20px; height:13px; border-radius:4px 4px 7px 7px;}
.cr-root .car .head{position:absolute; bottom:5px; width:11px; height:7px; border-radius:4px; background:radial-gradient(circle,#fff7d6,#ffd34d); box-shadow:0 3px 16px 4px rgba(255,224,130,.55);}
.cr-root .car .head.l{left:8px;} .cr-root .car .head.r{right:8px;}
.cr-root .car .beam{position:absolute; bottom:-2px; left:50%; transform:translateX(-50%); width:46px; height:60px; opacity:.7; background:radial-gradient(ellipse 60% 100% at 50% 0%, rgba(255,231,150,.22), transparent 70%);}
.cr-root .car .tail{position:absolute; top:4px; width:10px; height:5px; border-radius:3px; background:radial-gradient(circle,#ff8a8a,#c01515); box-shadow:0 0 10px 2px rgba(248,113,113,.5);}
.cr-root .car .tail.l{left:9px;} .cr-root .car .tail.r{right:9px;}
.cr-root .car .shadow{position:absolute; left:50%; bottom:-10px; transform:translateX(-50%); width:64px; height:18px; border-radius:50%; background:radial-gradient(ellipse,rgba(0,0,0,.5),transparent 70%); z-index:-1;}
@keyframes crCarDrive{from{transform:translateX(-50%) translateY(-120px);} to{transform:translateX(-50%) translateY(550px);}}

/* chicken */
.cr-root .chook-host{position:absolute; z-index:8; left:0; top:0; pointer-events:none; will-change:transform; transition:transform .5s var(--ease);}
.cr-root .chook{position:relative; width:54px; height:64px; transform-origin:50% 92%; animation:crIdleBob 1.6s ease-in-out infinite;}
@keyframes crIdleBob{50%{transform:translateY(-3px);}}
.cr-root .chook.hopping{animation:crHop .5s var(--ease);}
@keyframes crHop{
  0%{transform:translateY(0) scaleX(1) scaleY(1);}
  35%{transform:translateY(-30px) scaleX(.92) scaleY(1.1);}
  70%{transform:translateY(-6px) scaleX(1.08) scaleY(.92);}
  100%{transform:translateY(0) scaleX(1) scaleY(1);}
}
.cr-root .chook.squashed{animation:crSquash .3s forwards;}
@keyframes crSquash{to{transform:translateY(14px) scaleX(1.5) scaleY(.32); filter:brightness(.6);}}
.cr-root .chook.cheer{animation:crCheer .5s ease-in-out infinite;}
@keyframes crCheer{0%,100%{transform:translateY(0) rotate(-3deg);}50%{transform:translateY(-10px) rotate(3deg);}}
.cr-root .chook .legs{position:absolute; left:50%; bottom:0; transform:translateX(-50%); width:24px; height:14px;}
.cr-root .chook .leg{position:absolute; bottom:0; width:3px; height:13px; background:linear-gradient(180deg,#f0a23a,#c87715); border-radius:2px;}
.cr-root .chook .leg.l{left:5px; transform:rotate(-6deg);}
.cr-root .chook .leg.r{right:5px; transform:rotate(6deg);}
.cr-root .chook .leg::after{content:""; position:absolute; bottom:-1px; left:-3px; width:9px; height:3px; background:#c87715; border-radius:2px;}
.cr-root .chook .tail-f{position:absolute; left:-6px; bottom:18px; width:20px; height:22px; border-radius:60% 40% 50% 50%; background:linear-gradient(135deg,#fff,#e9e3d6); transform:rotate(-22deg); box-shadow:0 0 0 1px rgba(0,0,0,.06) inset;}
.cr-root .chook .body{position:absolute; left:50%; bottom:9px; transform:translateX(-50%); width:40px; height:42px; border-radius:50% 50% 48% 48%; background:radial-gradient(circle at 38% 30%, #ffffff, #f3eee2 60%, #e2d8c4 100%); box-shadow:0 4px 10px rgba(0,0,0,.4), 0 -3px 6px rgba(255,255,255,.5) inset;}
.cr-root .chook .wing{position:absolute; right:7px; bottom:20px; width:18px; height:22px; border-radius:60% 40% 60% 50%; background:linear-gradient(180deg,#f6f1e6,#dccfb8); box-shadow:0 1px 2px rgba(0,0,0,.15) inset; transform:rotate(8deg);}
.cr-root .chook .head{position:absolute; left:50%; top:0; transform:translateX(-46%); width:30px; height:30px; border-radius:50%; background:radial-gradient(circle at 40% 32%, #ffffff, #efe9dc); box-shadow:0 3px 6px rgba(0,0,0,.3); z-index:2;}
.cr-root .chook .comb{position:absolute; left:50%; top:-9px; transform:translateX(-60%); width:20px; height:13px; z-index:1;}
.cr-root .chook .comb i{position:absolute; bottom:0; width:8px; height:11px; border-radius:50% 50% 0 0; background:linear-gradient(180deg,#ff6b6b,#e23b3b);}
.cr-root .chook .comb i:nth-child(1){left:0; height:8px;}
.cr-root .chook .comb i:nth-child(2){left:6px; height:12px;}
.cr-root .chook .comb i:nth-child(3){left:12px; height:9px;}
.cr-root .chook .eye{position:absolute; left:50%; top:9px; transform:translateX(2px); width:6px; height:6px; border-radius:50%; background:#181818; z-index:3; box-shadow:0 0 0 2px #fff;}
.cr-root .chook .eye::after{content:""; position:absolute; top:0; right:0; width:2px; height:2px; border-radius:50%; background:#fff;}
.cr-root .chook .beak{position:absolute; left:50%; top:15px; transform:translateX(9px); width:0; height:0; z-index:3; border-top:5px solid transparent; border-bottom:5px solid transparent; border-left:9px solid #f5a623; filter:drop-shadow(0 1px 0 rgba(0,0,0,.2));}
.cr-root .chook .wattle{position:absolute; left:50%; top:21px; transform:translateX(7px); width:6px; height:9px; border-radius:0 0 50% 50%; background:linear-gradient(180deg,#e23b3b,#b71f1f); z-index:2;}
.cr-root .chook-shadow{position:absolute; left:0; top:0; width:42px; height:13px; border-radius:50%; background:radial-gradient(ellipse,rgba(0,0,0,.55),transparent 70%); z-index:7; transition:transform .5s var(--ease);}

/* big multiplier */
.cr-root .hud-top{
  position:absolute; top:0; left:0; right:0; z-index:20; pointer-events:none; padding:14px 16px 22px;
  background:linear-gradient(180deg, rgba(8,8,8,.86) 0%, rgba(8,8,8,.5) 55%, transparent 100%);
}
.cr-root .multi-readout{text-align:center; position:relative;}
.cr-root .multi-readout .lbl{font-size:10px; font-weight:700; letter-spacing:.28em; text-transform:uppercase; color:var(--muted);}
.cr-root .multi-readout .big{
  font-family:"Playfair Display",Georgia,serif; font-weight:900; line-height:.92; letter-spacing:-.01em;
  margin-top:2px; display:inline-block; color:var(--amber-3);
  text-shadow:0 0 30px rgba(251,191,36,.45), 0 0 6px rgba(253,224,71,.6);
  transition:font-size .4s var(--ease), color .3s, text-shadow .3s;
}
.cr-root .multi-readout .big .x{font-size:.5em; font-weight:700; opacity:.7; margin-left:2px; vertical-align:.18em;}
.cr-root .multi-readout.crossing .big{animation:crMultiPop .45s var(--ease);}
@keyframes crMultiPop{0%{transform:scale(.7); filter:brightness(1.7);}60%{transform:scale(1.14);}100%{transform:scale(1);}}
.cr-root .multi-readout.hot .big{color:#ffe9a8; text-shadow:0 0 50px rgba(251,191,36,.8), 0 0 14px rgba(255,255,255,.5);}
.cr-root .multi-readout.win .big{color:var(--emer); text-shadow:0 0 44px rgba(52,211,153,.6);}
.cr-root .multi-readout.dead .big{color:var(--red); text-shadow:0 0 40px rgba(248,113,113,.55);}
.cr-root .substat{margin-top:9px; display:flex; gap:8px; justify-content:center; align-items:stretch; font-size:11px;}
.cr-root .substat .chip{background:rgba(20,20,20,.7); border:1px solid var(--border); border-radius:10px; padding:5px 10px; line-height:1.25; backdrop-filter:blur(4px);}
.cr-root .substat .chip .k{display:block; font-size:8.5px; letter-spacing:.13em; text-transform:uppercase; color:var(--muted);}
.cr-root .substat .chip .v{font-weight:800; font-variant-numeric:tabular-nums;}
.cr-root .substat .chip.next .v{color:var(--amber-3);}
.cr-root .substat .chip.cash .v{color:var(--emer);}
.cr-root .substat .chip.safe .v{color:var(--text);}
.cr-root .vignette{position:absolute; inset:0; z-index:18; pointer-events:none; box-shadow:inset 0 0 90px 24px rgba(0,0,0,.7);}

/* fx */
.cr-root .fx-layer{position:absolute; inset:0; z-index:30; pointer-events:none; overflow:hidden;}
.cr-root .feather{position:absolute; width:11px; height:7px; border-radius:60% 60% 40% 40%; background:linear-gradient(180deg,#fff,#e7ded0); will-change:transform,opacity;}
.cr-root .dust{position:absolute; width:14px; height:14px; border-radius:50%; background:radial-gradient(circle,rgba(120,110,100,.7),transparent 70%);}
.cr-root .coin-fx{position:absolute; width:20px; height:20px; border-radius:50%; background:radial-gradient(circle at 35% 30%,#fde68a,#f59e0b 65%,#b45309); box-shadow:0 0 12px rgba(251,191,36,.6), 0 0 0 1px rgba(180,83,9,.7) inset; will-change:transform,opacity;}
.cr-root .coin-fx::after{content:"$"; position:absolute; inset:0; display:grid; place-items:center; font-weight:900; font-size:11px; color:#92560c;}
.cr-root .floattext{position:absolute; left:50%; top:46%; transform:translateX(-50%); font-family:"Playfair Display",Georgia,serif; font-weight:900; font-size:30px; z-index:34; pointer-events:none; white-space:nowrap;}
.cr-root .floattext.win{color:var(--emer); text-shadow:0 0 24px rgba(52,211,153,.6);}
.cr-root .floattext.dead{color:var(--red); text-shadow:0 0 24px rgba(248,113,113,.6);}
.cr-root .impact-flash{position:absolute; inset:0; z-index:33; pointer-events:none; opacity:0; background:radial-gradient(circle at var(--fx,50%) 50%, rgba(255,90,90,.5), transparent 55%);}
.cr-root .impact-flash.go{animation:crFlash .4s ease-out;}
@keyframes crFlash{0%{opacity:.9;}100%{opacity:0;}}
`
