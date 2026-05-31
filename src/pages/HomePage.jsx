import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'
import CoinField from '../components/CoinField'

// ── Icons ──────────────────────────────────────────────────
function SurveyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  )
}

function ReelIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </svg>
  )
}

function SwordIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
      <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
      <line x1="13" y1="19" x2="19" y2="13" />
      <line x1="16" y1="16" x2="20" y2="20" />
      <line x1="19" y1="21" x2="21" y2="19" />
    </svg>
  )
}

// ── Hooks ──────────────────────────────────────────────────
// Fire `onEnter` once when the ref element scrolls into view.
function useInView(onEnter, threshold = 0.25) {
  const ref = useRef(null)
  const fired = useRef(false)
  const cb = useRef(onEnter)
  useEffect(() => { cb.current = onEnter }, [onEnter])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !fired.current) {
          fired.current = true
          cb.current()
          obs.disconnect()
        }
      },
      { threshold }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])

  return ref
}

// Returns a boolean that flips to true once the ref scrolls into view.
// Used for scroll-reveal on sections.
function useVisible(threshold = 0.15) {
  const [visible, setVisible] = useState(false)
  const ref = useInView(
    useCallback(() => setVisible(true), []),
    threshold
  )
  return [ref, visible]
}

// Animate from 0 to `target` over `duration` ms once `active` is true.
function useCountUp(target, active, duration = 1500) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!active || target == null) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) { setValue(target); return }
    let raf = 0
    const start = performance.now()
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration)
      // easeOutCubic — quick start, gentle landing
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(Math.round(target * eased))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, active, duration])
  return value
}

// ── Scroll-reveal wrapper ──────────────────────────────────
// Children fade + slide up when they enter the viewport.
function Reveal({ children, className = '', delay = 0 }) {
  const [ref, visible] = useVisible()
  const reduced = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity:    reduced || visible ? 1 : 0,
        transform:  reduced || visible ? 'translateY(0)' : 'translateY(20px)',
        transition: reduced
          ? 'none'
          : `opacity 0.55s cubic-bezier(0.16,1,0.3,1) ${delay}ms,
             transform 0.55s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  )
}

// ── Stage card for the "loop" diagram ──────────────────────
function LoopStage({ icon, step, title, desc, accentClass = 'text-amber-400' }) {
  return (
    <div className="flex-1 group relative rounded-2xl border border-cp-border bg-cp-card p-7 text-center transition-all duration-300 ease-out hover:border-cp-accent/50 hover:-translate-y-1.5 hover:shadow-[0_8px_32px_rgba(196,132,92,0.08)]">
      {/* Icon circle */}
      <div className={`mx-auto mb-5 w-14 h-14 rounded-full flex items-center justify-center bg-cp-elevated ${accentClass} group-hover:scale-110 transition-transform duration-300`}>
        {icon}
      </div>
      <p className="text-[10px] uppercase tracking-[0.18em] text-cp-muted mb-1.5">{step}</p>
      <h3 className="font-display text-xl text-cp-text mb-2.5">{title}</h3>
      <p className="text-sm text-cp-muted leading-relaxed">{desc}</p>
    </div>
  )
}

// Animated arrow connector between loop stages — shows a traveling coin pip on hover.
function LoopArrow() {
  return (
    <div className="hidden md:flex items-center justify-center px-1 self-center" aria-hidden="true">
      <div className="relative flex items-center gap-0.5">
        {/* Static chevron */}
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5 text-cp-border-soft"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </div>
  )
}

// ── Stat tile ──────────────────────────────────────────────
function Stat({ value, label, loading, prefix = '' }) {
  return (
    <div className="text-center px-4">
      <p className="font-display text-3xl md:text-4xl text-amber-400 tabular-nums leading-none">
        {loading ? (
          <span className="inline-block w-16 h-8 rounded-md bg-cp-elevated animate-pulse align-middle" />
        ) : (
          `${prefix}${value.toLocaleString()}`
        )}
      </p>
      <p className="text-[10px] uppercase tracking-[0.16em] text-cp-muted mt-2.5">{label}</p>
    </div>
  )
}

// ── Section card (Earn / Casino / War) ─────────────────────
const EYEBROW_COLORS = {
  Earn:   'text-emerald-400/80',
  Casino: 'text-amber-400/80',
  War:    'text-red-400/80',
}

function SectionCard({ to, anchor, eyebrow, title, desc }) {
  const eyebrowColor = EYEBROW_COLORS[eyebrow] ?? 'text-amber-400/80'

  const inner = (
    <div className="h-full rounded-2xl border border-cp-border bg-cp-card p-7 transition-all duration-300 ease-out hover:border-cp-accent/40 hover:bg-cp-elevated hover:-translate-y-1.5 hover:shadow-[0_8px_32px_rgba(196,132,92,0.07)] flex flex-col">
      <p className={`text-[10px] uppercase tracking-[0.18em] ${eyebrowColor} mb-2`}>{eyebrow}</p>
      <h3 className="font-display text-2xl text-cp-text mb-3">{title}</h3>
      <p className="text-sm text-cp-muted leading-relaxed flex-1">{desc}</p>
      {/* Subtle arrow affordance */}
      <p className="mt-5 text-xs text-cp-muted/60 flex items-center gap-1 group-hover:text-cp-accent transition-colors">
        <span>Explore</span>
        <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="5 12 10 8 5 4" />
        </svg>
      </p>
    </div>
  )

  const linkClass = 'block h-full group'
  if (to) return <Link to={to} className={linkClass}>{inner}</Link>
  return <a href={anchor} className={linkClass}>{inner}</a>
}

// ── Page ───────────────────────────────────────────────────
export default function HomePage() {
  const [stats, setStats]       = useState({ coins: 0, members: 0, biggest: 0 })
  const [loaded, setLoaded]     = useState(false)
  const [counting, setCounting] = useState(false)

  // One read-only aggregate query — read balances straight from wallets (no profiles join).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.from('wallets').select('balance')
      if (cancelled) return
      if (error || !data) { setLoaded(true); return }
      const coins   = data.reduce((sum, w) => sum + (w.balance ?? 0), 0)
      const members = data.length
      const biggest = data.reduce((max, w) => Math.max(max, w.balance ?? 0), 0)
      setStats({ coins, members, biggest })
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [])

  const statsRef = useInView(useCallback(() => setCounting(true), []))
  const coins    = useCountUp(stats.coins,   counting)
  const members  = useCountUp(stats.members, counting, 1200)
  const biggest  = useCountUp(stats.biggest, counting, 1700)

  return (
    <div className="page-in min-h-screen" id="top">

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <CoinField />

        {/* Bottom gradient bleed into next section */}
        <div className="absolute bottom-0 inset-x-0 h-32 bg-gradient-to-t from-cp-bg to-transparent pointer-events-none" aria-hidden="true" />

        <div className="relative max-w-4xl mx-auto px-6 pt-32 pb-28 text-center">
          {/* Eyebrow badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-cp-border-soft bg-cp-card/60 backdrop-blur-sm mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[11px] uppercase tracking-[0.16em] text-cp-muted">Members only</span>
          </div>

          <h1 className="font-display text-5xl md:text-7xl tracking-tight leading-[1.05]">
            <span className="italic text-cp-accent">CP</span>
            <span className="font-light text-cp-text"> Studios</span>
          </h1>

          <p className="mt-6 text-lg md:text-xl text-cp-muted max-w-lg mx-auto leading-relaxed">
            Earn it. Gamble it. Conquer with it.
            <br className="hidden sm:block" />
            <span className="text-cp-text/80"> One currency. Three ways to play.</span>
          </p>

          <div className="mt-10 flex items-center justify-center gap-4">
            <Link
              to="/casino"
              className="px-8 py-3.5 rounded-xl bg-cp-accent hover:bg-cp-accent-hover text-cp-bg font-medium transition-all duration-200 hover:shadow-[0_4px_20px_rgba(196,132,92,0.35)] hover:-translate-y-0.5 active:translate-y-0"
            >
              Enter the Casino
            </Link>
          </div>

          <p className="mt-4 text-sm text-cp-muted/60">
            Claim your free daily bonus to get started — no purchase needed.
          </p>
        </div>
      </section>

      {/* ── The Loop ── */}
      <section className="max-w-5xl mx-auto px-6 py-24">
        <Reveal className="text-center mb-14">
          <p className="text-[11px] uppercase tracking-[0.18em] text-cp-accent mb-3">How it works</p>
          <h2 className="font-display text-3xl md:text-4xl text-cp-text">One simple loop</h2>
          <p className="text-cp-muted mt-3 max-w-sm mx-auto">
            Your coins flow through three stages — earn, bet, and battle.
          </p>
        </Reveal>

        <div className="flex flex-col md:flex-row gap-4 md:gap-0 items-stretch">
          <Reveal delay={0} className="flex-1">
            <LoopStage
              icon={<SurveyIcon />}
              step="Step 1 · Earn"
              title="Stack free coins"
              desc="Watch ads and fill out quick surveys to build your starting stash — no spending required."
              accentClass="text-emerald-400"
            />
          </Reveal>

          <LoopArrow />

          <Reveal delay={80} className="flex-1">
            <LoopStage
              icon={<ReelIcon />}
              step="Step 2 · Gamble"
              title="Hit the casino"
              desc="Put your coins on the line across slots, dice, roulette and more to multiply your stash."
              accentClass="text-amber-400"
            />
          </Reveal>

          <LoopArrow />

          <Reveal delay={160} className="flex-1">
            <LoopStage
              icon={<SwordIcon />}
              step="Step 3 · Conquer"
              title="Wage war"
              desc="Spend winnings on troops, buildings and defenses to dominate the CP War map."
              accentClass="text-red-400"
            />
          </Reveal>
        </div>
      </section>

      {/* ── Live stats ── */}
      <section
        ref={statsRef}
        className="border-y border-cp-border bg-cp-card/50"
      >
        <div className="max-w-4xl mx-auto px-6 py-16">
          <p className="text-center text-[10px] uppercase tracking-[0.18em] text-cp-muted mb-10">
            Live across the community
          </p>
          <div className="grid grid-cols-3 gap-6 md:gap-0 md:divide-x md:divide-cp-border">
            <Stat value={coins}   label="Coins in circulation" loading={!loaded} />
            <Stat value={members} label="Members"              loading={!loaded} />
            <Stat value={biggest} label="Biggest stash"        loading={!loaded} />
          </div>
        </div>
      </section>

      {/* ── Sections trio ── */}
      <section className="max-w-5xl mx-auto px-6 py-24">
        <Reveal className="text-center mb-14">
          <p className="text-[11px] uppercase tracking-[0.18em] text-cp-accent mb-3">Explore</p>
          <h2 className="font-display text-3xl md:text-4xl text-cp-text">Everything in one place</h2>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Reveal delay={0}>
            <SectionCard
              anchor="#top"
              eyebrow="Earn"
              title="Free coins"
              desc="Rack up coins through ads and surveys — your stake costs you nothing. The more you earn, the more you can risk."
            />
          </Reveal>
          <Reveal delay={80}>
            <SectionCard
              to="/casino"
              eyebrow="Casino"
              title="Play & win"
              desc="Ten games and counting. Multiply your coins or lose it all trying — the house edge is real."
            />
          </Reveal>
          <Reveal delay={160}>
            <SectionCard
              to="/war"
              eyebrow="War"
              title="Build & raid"
              desc="Turn coins into an army and battle other members for territory, resources, and dominance."
            />
          </Reveal>
        </div>
      </section>

      {/* ── Footer CTA ── */}
      <section className="max-w-4xl mx-auto px-6 pb-28 text-center">
        <Reveal>
          {/* Decorative divider */}
          <div className="flex items-center gap-4 mb-12 max-w-xs mx-auto">
            <div className="flex-1 h-px bg-cp-border" />
            <span className="text-amber-400/60 text-lg">✦</span>
            <div className="flex-1 h-px bg-cp-border" />
          </div>

          <h2 className="font-display text-3xl md:text-4xl text-cp-text mb-4">Ready to play?</h2>
          <p className="text-cp-muted text-sm mb-8 max-w-xs mx-auto">
            Your daily bonus is waiting — collect it free inside the casino.
          </p>
          <Link
            to="/casino"
            className="inline-block px-9 py-4 rounded-xl bg-cp-accent hover:bg-cp-accent-hover text-cp-bg font-medium transition-all duration-200 hover:shadow-[0_4px_24px_rgba(196,132,92,0.35)] hover:-translate-y-0.5 active:translate-y-0"
          >
            Enter the Casino
          </Link>
        </Reveal>
      </section>

    </div>
  )
}
