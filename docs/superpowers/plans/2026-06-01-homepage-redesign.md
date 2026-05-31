# Homepage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the profile-gallery homepage with an animated, interactive intro page that pitches the Earn → Gamble → Conquer loop, and remove the profile/photo feature entirely.

**Architecture:** Client-only React SPA (Vite + Tailwind), no app server. `/` stays behind `ProtectedRoute`. The new `HomePage` composes a hero (cursor-reactive coin background), an animated how-it-works loop, a live-stats band (read-only `wallets` query), a three-card sections row, and a footer CTA. A small isolated `CoinField` component owns the ambient background. All animation is pure CSS + light React (rAF + IntersectionObserver) — **no new dependencies**.

**Tech Stack:** React 18, react-router-dom, Tailwind (`cp-*` palette + `amber-*`), Supabase JS client, inline SVG icons. No test runner exists in this repo — **verification is `npm run build` (must pass with zero errors) plus manual `npm run dev` checks**, per `CLAUDE.md`.

**Spec:** `docs/superpowers/specs/2026-06-01-homepage-redesign-design.md`

**Conventions to honor (from `CLAUDE.md`):**
- Tailwind utility classes only; dark `cp-*` palette + `amber-*` for gold/coin accent. No new ad-hoc hex.
- `font-display` (Playfair) for headings, `font-sans` (DM Sans) for body.
- Inline SVG functional icon components at top of file — no icon package.
- Reuse / extend shared keyframes in `src/index.css`.
- Read names/balances from `wallets` directly — never reintroduce a `profiles` join.
- `localStorage` keys namespaced `cp-studios:...` (not needed here, but keep the rule in mind).

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/pages/CreateProfilePage.jsx` | **Delete** | (removed feature) |
| `src/pages/ProfilePage.jsx` | **Delete** | (removed feature) |
| `src/components/UploadModal.jsx` | **Delete** | (removed feature) |
| `src/components/PhotoCard.jsx` | **Delete** | (removed feature) |
| `src/components/Lightbox.jsx` | **Delete** | (removed feature) |
| `src/App.jsx` | Modify | Drop profile/create imports + routes |
| `src/components/Navbar.jsx` | Modify | Drop the `Upload` nav entry |
| `src/index.css` | Modify | Add `coin-drift` / `coin-float` keyframes + utility classes |
| `src/components/CoinField.jsx` | **Create** | Ambient cursor-reactive coin/glow background, reduced-motion + touch aware |
| `src/pages/HomePage.jsx` | **Rewrite** | Compose hero + loop + stats + sections + footer CTA |

**Do NOT touch:** the `profiles` Supabase table, `profiles`/`loadProfiles` in `AppContext` (leave in place — Navbar's username-uniqueness check and DM flows depend on the table; the context list just goes unused). No migrations. No Supabase data deletion.

---

## Task 1: Remove the profile/photo feature

**Files:**
- Delete: `src/pages/CreateProfilePage.jsx`, `src/pages/ProfilePage.jsx`, `src/components/UploadModal.jsx`, `src/components/PhotoCard.jsx`, `src/components/Lightbox.jsx`
- Modify: `src/App.jsx`, `src/components/Navbar.jsx`

- [ ] **Step 1: Delete the five feature files**

```bash
cd "/Users/jonaswedam/Desktop/Organizer AI/cp-studios"
git rm src/pages/CreateProfilePage.jsx src/pages/ProfilePage.jsx \
       src/components/UploadModal.jsx src/components/PhotoCard.jsx src/components/Lightbox.jsx
```

- [ ] **Step 2: Remove profile/create imports + routes from `src/App.jsx`**

Delete these two import lines (currently lines 8–9):

```jsx
import ProfilePage from './pages/ProfilePage'
import CreateProfilePage from './pages/CreateProfilePage'
```

Delete these two `<Route>` blocks (currently lines 76–86):

```jsx
      <Route path="/profile/:id" element={
        <ProtectedRoute>
          <WithNav><ProfilePage /></WithNav>
        </ProtectedRoute>
      } />

      <Route path="/create" element={
        <ProtectedRoute>
          <WithNav><CreateProfilePage /></WithNav>
        </ProtectedRoute>
      } />
```

The existing catch-all `<Route path="*" element={<Navigate to="/" replace />} />` makes old `/create` and `/profile/:id` links redirect to the homepage — no extra handling needed.

- [ ] **Step 3: Remove the `Upload` entry from `src/components/Navbar.jsx`**

In the nav array (currently lines 335–341), delete the `/create` object so it reads:

```jsx
            {[
              { to: '/',        label: 'Home',   icon: null                          },
              { to: '/casino',  label: 'Casino', icon: <DiceIcon />                  },
              ...(currentUser.isAdmin
                ? [{ to: '/admin', label: 'Admin', badge: hasNewRequests, icon: null }]
                : []),
            ].map(({ to, label, badge, icon }) => (
```

Leave everything else in Navbar (War span, Chat button, avatar panel, username editing) untouched.

- [ ] **Step 4: Verify the build passes (HomePage still imports the old gallery — that's fine; it's rewritten in Task 4. Confirm no dangling imports to the deleted files.)**

Run:
```bash
npm run build
```
Expected: build **fails only** if something still imports a deleted file. Search to confirm nothing does:
```bash
grep -rn "ProfilePage\|CreateProfilePage\|UploadModal\|PhotoCard\|Lightbox" src --include="*.jsx"
```
Expected: **no output**. If `npm run build` still errors for another reason, stop and investigate before continuing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: remove profile gallery + photo upload feature

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Add coin animation keyframes to `src/index.css`

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Append two keyframes after the existing `slideUp` block (after current line 51)**

```css
@keyframes coinFloat {
  0%   { transform: translateY(0)    rotate(0deg); }
  50%  { transform: translateY(-12px) rotate(8deg); }
  100% { transform: translateY(0)    rotate(0deg); }
}

@keyframes coinDrift {
  0%   { transform: translateY(0)     translateX(0); opacity: 0.0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { transform: translateY(-120px) translateX(20px); opacity: 0; }
}
```

- [ ] **Step 2: Append two utility classes to the utility-classes block (after current line 58)**

```css
.coin-float   { animation: coinFloat 6s ease-in-out infinite; }
.coin-drift   { animation: coinDrift 9s linear infinite; }
```

- [ ] **Step 3: Verify build passes**

Run:
```bash
npm run build
```
Expected: PASS (CSS additions never break the build; this confirms no typo broke the file).

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat: add coin float/drift keyframes for homepage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Create the `CoinField` ambient background component

**Files:**
- Create: `src/components/CoinField.jsx`

This component renders an absolutely-positioned layer of gold coins behind the hero. On
pointer-capable, non-reduced-motion devices, a `requestAnimationFrame` loop applies a small
parallax transform toward the cursor. Otherwise the coins fall back to the CSS `coin-float`
auto-animation. The component is self-contained: it takes no props and cleans up its own
listeners/rAF on unmount.

- [ ] **Step 1: Create `src/components/CoinField.jsx` with the full component**

```jsx
import { useEffect, useRef, useState } from 'react'

// Inline gold-coin SVG — matches the casino "coins/gold" amber accent.
function Coin({ size }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#d4956a" stroke="#c4845c" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="7.5" fill="none" stroke="#0c0c0c" strokeOpacity="0.25" strokeWidth="1.2" />
      <text x="12" y="16" textAnchor="middle" fontSize="9" fontWeight="700" fill="#0c0c0c" fillOpacity="0.45">C</text>
    </svg>
  )
}

// Deterministic-ish scattered coins so layout doesn't reshuffle every render.
const COINS = [
  { left: '8%',  top: '18%', size: 30, depth: 0.9, delay: '0s'   },
  { left: '20%', top: '64%', size: 20, depth: 0.5, delay: '1.4s' },
  { left: '34%', top: '32%', size: 16, depth: 0.35, delay: '0.7s' },
  { left: '52%', top: '72%', size: 26, depth: 0.7, delay: '2.1s' },
  { left: '66%', top: '22%', size: 22, depth: 0.6, delay: '0.3s' },
  { left: '78%', top: '58%', size: 34, depth: 1.0, delay: '1.1s' },
  { left: '88%', top: '30%', size: 18, depth: 0.45, delay: '1.8s' },
  { left: '44%', top: '12%', size: 14, depth: 0.3, delay: '2.6s' },
]

export default function CoinField() {
  const layerRef = useRef(null)
  const rafRef   = useRef(0)
  const target   = useRef({ x: 0, y: 0 })
  const current  = useRef({ x: 0, y: 0 })
  const [interactive, setInteractive] = useState(false)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const fine    = window.matchMedia('(pointer: fine)').matches
    if (reduced || !fine) return        // fall back to CSS coin-float
    setInteractive(true)

    const onMove = (e) => {
      // Normalize cursor to [-1, 1] from viewport center.
      target.current.x = (e.clientX / window.innerWidth  - 0.5) * 2
      target.current.y = (e.clientY / window.innerHeight - 0.5) * 2
    }

    const tick = () => {
      // Ease current toward target for smooth drift.
      current.current.x += (target.current.x - current.current.x) * 0.05
      current.current.y += (target.current.y - current.current.y) * 0.05
      const layer = layerRef.current
      if (layer) {
        for (const el of layer.children) {
          const d = Number(el.dataset.depth)
          el.style.transform =
            `translate(${current.current.x * 22 * d}px, ${current.current.y * 22 * d}px)`
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    window.addEventListener('mousemove', onMove)
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <div ref={layerRef} className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {/* Soft radial glow center */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[60vw] max-w-[700px] max-h-[700px] rounded-full bg-cp-accent/10 blur-[120px]" />
      {COINS.map((c, i) => (
        <div
          key={i}
          data-depth={c.depth}
          style={{ left: c.left, top: c.top, transition: 'transform 0.2s ease-out' }}
          className="absolute"
        >
          <span
            className={interactive ? '' : 'coin-float inline-block'}
            style={interactive ? undefined : { animationDelay: c.delay }}
          >
            <span className="opacity-70"><Coin size={c.size} /></span>
          </span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Verify build passes**

Run:
```bash
npm run build
```
Expected: PASS (component is not imported anywhere yet; this confirms it compiles).

- [ ] **Step 3: Commit**

```bash
git add src/components/CoinField.jsx
git commit -m "feat: add cursor-reactive CoinField background component

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Rewrite `HomePage.jsx` as the intro page

**Files:**
- Rewrite: `src/pages/HomePage.jsx`

> **During execution of this task, also invoke the `frontend-design` skill** to refine the
> visual polish (spacing, motion easing, copy). The code below is a complete, working baseline
> that satisfies the spec — frontend-design tightens the aesthetics on top of it.

This single file composes all sections. It includes: a `useCountUp` hook, a `useInView` hook
(IntersectionObserver), inline SVG icons for the three stages, the live-stats fetch from
`wallets`, and the section markup. It reads aggregate stats with one read-only query.

- [ ] **Step 1: Replace the entire contents of `src/pages/HomePage.jsx` with the baseline below**

```jsx
import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'
import CoinField from '../components/CoinField'

// ── Icons ──────────────────────────────────────────────────
function SurveyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
      <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  )
}
function ReelIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
      <rect x="3" y="4" width="18" height="16" rx="2" /><line x1="9" y1="4" x2="9" y2="20" /><line x1="15" y1="4" x2="15" y2="20" />
    </svg>
  )
}
function SwordIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
      <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" /><line x1="13" y1="19" x2="19" y2="13" /><line x1="16" y1="16" x2="20" y2="20" /><line x1="19" y1="21" x2="21" y2="19" />
    </svg>
  )
}

// ── Hooks ──────────────────────────────────────────────────
// Fire `onEnter` once when the ref scrolls into view.
function useInView(onEnter) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { onEnter(); obs.disconnect() } },
      { threshold: 0.3 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [onEnter])
  return ref
}

// Animate from 0 to `target` over `duration` ms once `active` is true.
function useCountUp(target, active, duration = 1400) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!active || target == null) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) { setValue(target); return }
    let raf = 0
    const start = performance.now()
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)   // easeOutCubic
      setValue(Math.round(target * eased))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, active, duration])
  return value
}

// ── Stage card for the "loop" diagram ──────────────────────
function LoopStage({ icon, step, title, desc }) {
  return (
    <div className="flex-1 group rounded-2xl border border-cp-border bg-cp-card p-6 text-center transition-all duration-300 hover:border-cp-accent/40 hover:-translate-y-1">
      <div className="mx-auto mb-4 w-14 h-14 rounded-full flex items-center justify-center bg-cp-elevated text-amber-400 group-hover:scale-110 transition-transform duration-300">
        {icon}
      </div>
      <p className="text-[11px] uppercase tracking-widest text-cp-muted mb-1">{step}</p>
      <h3 className="font-display text-xl text-cp-text mb-2">{title}</h3>
      <p className="text-sm text-cp-muted leading-relaxed">{desc}</p>
    </div>
  )
}

// Arrow with a traveling coin pip between stages.
function LoopArrow() {
  return (
    <div className="hidden md:flex items-center justify-center px-2 self-center">
      <div className="relative w-12 h-px bg-cp-border-soft">
        <span className="absolute -top-[3px] left-0 w-1.5 h-1.5 rounded-full bg-amber-400 coin-drift" style={{ animationName: 'none' }} />
      </div>
      <svg viewBox="0 0 24 24" className="w-4 h-4 text-cp-border-soft -ml-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </div>
  )
}

// ── Stat tile ──────────────────────────────────────────────
function Stat({ value, label, loading }) {
  return (
    <div className="text-center">
      <p className="font-display text-3xl md:text-4xl text-amber-400 tabular-nums">
        {loading ? '—' : value.toLocaleString()}
      </p>
      <p className="text-xs uppercase tracking-widest text-cp-muted mt-1.5">{label}</p>
    </div>
  )
}

// ── Section card (Earn / Casino / War) ─────────────────────
function SectionCard({ to, anchor, eyebrow, title, desc }) {
  const inner = (
    <div className="h-full rounded-2xl border border-cp-border bg-cp-card p-7 transition-all duration-300 hover:border-cp-accent/40 hover:bg-cp-elevated hover:-translate-y-1">
      <p className="text-[11px] uppercase tracking-widest text-amber-400/80 mb-2">{eyebrow}</p>
      <h3 className="font-display text-2xl text-cp-text mb-2">{title}</h3>
      <p className="text-sm text-cp-muted leading-relaxed">{desc}</p>
    </div>
  )
  if (to)     return <Link to={to} className="block h-full">{inner}</Link>
  return <a href={anchor} className="block h-full">{inner}</a>
}

// ── Page ───────────────────────────────────────────────────
export default function HomePage() {
  const [stats, setStats]     = useState({ coins: 0, members: 0, biggest: 0 })
  const [loaded, setLoaded]   = useState(false)
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

  const statsRef = useInView(() => setCounting(true))
  const coins   = useCountUp(stats.coins,   counting)
  const members = useCountUp(stats.members, counting)
  const biggest = useCountUp(stats.biggest, counting)

  return (
    <div className="page-in">
      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <CoinField />
        <div className="relative max-w-4xl mx-auto px-6 pt-28 pb-24 text-center">
          <h1 className="font-display text-5xl md:text-6xl tracking-tight">
            <span className="italic text-cp-accent">CP</span>
            <span className="font-light text-cp-text"> Studios</span>
          </h1>
          <p className="mt-5 text-lg md:text-xl text-cp-muted max-w-xl mx-auto leading-relaxed">
            Earn it. Gamble it. Conquer with it. One currency, three ways to play.
          </p>
          <div className="mt-9 flex items-center justify-center gap-4">
            <Link
              to="/casino"
              className="px-7 py-3 rounded-xl bg-cp-accent hover:bg-cp-accent-hover text-cp-bg font-medium transition-colors duration-150"
            >
              Enter the Casino
            </Link>
          </div>
          <p className="mt-4 text-sm text-cp-muted/70">
            Claim your free daily bonus inside the casino to get started.
          </p>
        </div>
      </section>

      {/* ── The Loop ── */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="font-display text-3xl md:text-4xl text-cp-text">How it works</h2>
          <p className="text-cp-muted mt-2">Your coins flow through one simple loop.</p>
        </div>
        <div className="flex flex-col md:flex-row gap-4 md:gap-0 items-stretch">
          <LoopStage icon={<SurveyIcon />} step="Step 1 · Earn"    title="Earn coins"    desc="Watch ads and fill out quick surveys to stack up free coins — no spending required." />
          <LoopArrow />
          <LoopStage icon={<ReelIcon />}   step="Step 2 · Gamble"  title="Hit the casino" desc="Put your coins on the line across slots, dice, roulette and more to multiply your stash." />
          <LoopArrow />
          <LoopStage icon={<SwordIcon />}  step="Step 3 · Conquer" title="Wage war"       desc="Spend winnings on troops, buildings and defenses to dominate the CP War map." />
        </div>
      </section>

      {/* ── Live stats ── */}
      <section ref={statsRef} className="border-y border-cp-border bg-cp-card/40">
        <div className="max-w-4xl mx-auto px-6 py-14 grid grid-cols-3 gap-6">
          <Stat value={coins}   label="Coins in circulation" loading={!loaded} />
          <Stat value={members} label="Members"              loading={!loaded} />
          <Stat value={biggest} label="Biggest stash"        loading={!loaded} />
        </div>
      </section>

      {/* ── Sections trio ── */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <SectionCard anchor="#top" eyebrow="Earn"    title="Free coins"   desc="Rack up coins through ads and surveys — your stake costs you nothing." />
          <SectionCard to="/casino"  eyebrow="Casino"  title="Play & win"   desc="Ten games and counting. Multiply your coins or lose it all trying." />
          <SectionCard to="/war"     eyebrow="War"     title="Build & raid" desc="Turn coins into an army and battle other members for territory." />
        </div>
      </section>

      {/* ── Footer CTA ── */}
      <section className="max-w-4xl mx-auto px-6 pb-24 text-center">
        <h2 className="font-display text-3xl text-cp-text mb-6">Ready to play?</h2>
        <Link
          to="/casino"
          className="inline-block px-8 py-3.5 rounded-xl bg-cp-accent hover:bg-cp-accent-hover text-cp-bg font-medium transition-colors duration-150"
        >
          Enter the Casino
        </Link>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Verify the build passes**

Run:
```bash
npm run build
```
Expected: PASS, no errors. If it fails, the most likely cause is a leftover import — re-check Task 1 Step 2/4.

- [ ] **Step 3: Manual verification with the dev server**

Run:
```bash
npm run dev
```
Then in the browser (logged in), confirm:
- `/` shows the new intro page: hero with drifting coins, "How it works" loop, stats band, three cards, footer CTA.
- Moving the mouse over the hero subtly shifts the coins (on a desktop/fine-pointer device).
- The three stat numbers count up from 0 when the stats band scrolls into view, landing on real values.
- Navbar shows **Home, Casino, War, Chat, Admin** — **no Upload**.
- Visiting `/create` and `/profile/anything` redirects to `/`.
- Casino link works; username editing in the avatar panel still works.
- (Optional) Toggle "Reduce motion" in OS settings → reload → coins use the gentle float, stats appear at final value with no count-up.

- [ ] **Step 4: Commit**

```bash
git add src/pages/HomePage.jsx
git commit -m "feat: animated intro homepage (hero, loop, live stats, sections)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Update documentation

**Files:**
- Modify: `CLAUDE.md`

The "Where to make common changes" / realtime tables / architecture notes reference the
profile + photo feature. Update the docs so they match reality.

- [ ] **Step 1: In `CLAUDE.md`, update the `profile-rt-<id>` realtime row**

The `profile-rt-<id>` channel lived in `ProfilePage`, which is now deleted. Remove that row
from the "Realtime channels in use" table.

- [ ] **Step 2: In `CLAUDE.md` "Where to make common changes" table, remove/adjust photo rows**

There is no longer a profile gallery or upload flow. Remove references that point at the
deleted pages. Add a row:

```
| Edit the homepage / intro page         | `src/pages/HomePage.jsx` (+ `src/components/CoinField.jsx`) |
```

- [ ] **Step 3: Add a short note about the denormalized display-name guidance still applying**

Under the relevant section, confirm the homepage stats read `wallets.balance` directly (no
`profiles` join) — consistent with §3. (One sentence; no structural change needed.)

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md after homepage redesign + feature removal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Remove profile gallery + upload, delete 5 files, drop routes, drop Upload nav → Task 1. ✓
- Keep `profiles` table + `AppContext` list untouched → stated in File Structure + Task 1 note. ✓
- Post-login intro page at protected `/` → Task 4 (no route guard change). ✓
- Hero with cursor-reactive coins + reduced-motion/touch fallback → Tasks 2 & 3 & 4. ✓
- Animated Earn→Gamble→Conquer loop → Task 4 (`LoopStage`/`LoopArrow`). ✓
- Live count-up stats from `wallets` (coins/members/biggest) → Task 4 (`useCountUp`/`useInView`, read-only query). ✓
- Three section cards (Casino→/casino, War→/war, Earn→anchor), all live, no "coming soon" → Task 4 (`SectionCard`). ✓
- No new dependencies; Tailwind + `cp-*`/`amber-*`; Playfair headings; inline SVG icons → all tasks. ✓
- No schema change / migration → confirmed; only read-only `wallets` select. ✓
- Docs updated → Task 5. ✓

**Placeholder scan:** All code steps contain complete, runnable code. No TBD/TODO. ✓

**Type/name consistency:** `CoinField` (default export) imported in HomePage; `useInView`/`useCountUp`/`LoopStage`/`LoopArrow`/`Stat`/`SectionCard` all defined and used within HomePage; keyframe class names `coin-float`/`coin-drift` match `index.css` additions. ✓

**Note on `LoopArrow` coin pip:** it uses `animationName: 'none'` inline to keep the arrow static by default; frontend-design may enable a traveling-pip animation during Task 4 polish. This is intentional, not a placeholder.
