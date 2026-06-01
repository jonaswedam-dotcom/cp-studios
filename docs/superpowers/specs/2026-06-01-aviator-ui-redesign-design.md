# Aviator — UI Redesign

- **Date:** 2026-06-01
- **Status:** Approved (design); ready for implementation plan
- **Scope:** `src/pages/casino/AviatorGame.jsx` only (Aviamasters and other games untouched)
- **Visual reference:** mockups in the main checkout `.superpowers/brainstorm/95164-1780318095/content/` — `style-direction.html`, `aircraft.html`, `motion-v2.html`, `full-mockup.html`

## Problem

The current Aviator screen feels cheap and static:

- The plane is an `✈️` emoji that **bobs up and down** in place (`planeFly` keyframe) — aimless motion with no relationship to the game.
- The trajectory is a **thin straight line** that, in early iterations, ran *ahead* of the plane. It doesn't read as something the plane creates.
- The board is flat and low-energy; nothing builds tension or rewards a good cash-out.

## Goals

Refactor the Aviator screen into a polished, high-energy crash game that fits CP Studios' look.

- Replace the emoji with a **vector jet** that **banks along the trajectory's tangent** (no bobbing).
- The **gold trail + fill grow in lock-step with the jet**, terminating exactly at its nose — never ahead.
- Add engagement: **history bar, live cash-out button, "flew away" crash moment, ember trail, big-win celebration.**
- Keep the existing **game rules, odds, pacing, and wallet integration** unchanged.

## Non-goals (explicitly out of scope)

- No **auto-cashout / auto-bet**, **sound/haptics**, or **live-bets feed** (deferred; easy to add later).
- No change to the **manual pacing** (press Fly → watch → cash out → play again).
- No change to **odds** (`generateCrash()` distribution) or to **`placeBet`/wallet** semantics. Casino logic stays client-resolved with the balance persisted to Supabase, exactly as today.
- No **shared/server-authoritative rounds**.
- No changes to `Aviamasters`, `shared.jsx`, or any other game.

## Locked design decisions

| Decision | Choice |
|----------|--------|
| Visual direction | **CP Studios Gold** — charcoal board, refined gold curve + fill, ember particles, serif multiplier |
| Aircraft | **Jet** — sleek airliner silhouette (inline SVG vector), gold gradient fill |
| Motion | **Filling curve** — jet banks up its own gold trail; Y-axis rescales for big multipliers |
| Pacing | **Manual** (consistent with the other casino games) |
| Features | history bar · live cash-out button · "flew away" crash · ember trail · **big-win celebration** |

## Component architecture

- **`AviatorGame.jsx`** (orchestrator) — phase state machine (`betting | flying | crashed | cashedout`), `requestAnimationFrame` loop, `generateCrash`, history persistence, `placeBet` calls, big-win trigger. Renders the inline history bar, `FlightBoard`, controls, `ResultBanner`, big-win overlay.
- **`FlightBoard.jsx`** (presentational, no game state) — props `{ phase, multiplier, crashPoint, cashedOutAt, bet }`. Renders the SVG stage from `aviatorTrajectory`.
- **`aviatorTrajectory.js`** (+ **`aviatorTrajectory.test.js`**) — pure math: `progress`, `multiplierForElapsed`, `pointAt`, `tangentDeg`, `buildTrajectory`, `generateCrash`.

**Unchanged integration:** `useCasino()` → `balance`, `placeBet('aviator', bet, win)` / `(…, -bet)`; `balance === null` loading guard; `GameLayout`, `BetChips`, `ResultBanner`, `formatCoins` from `shared.jsx`; casino "gold" = Tailwind `amber-*`; multiplier font = `font-display` (Playfair Display).

## Accessibility & performance

- Respect `prefers-reduced-motion`: drop embers, shake, coin-burst, button pulse.
- Single RAF loop, torn down on phase change and unmount (no leaked timers).
- SVG-only board, fixed `aspect-ratio` so the jet never distorts; no canvas, no new dependencies.

## Testing & verification

- **Unit (`node --test`):** trajectory math (origin, monotonicity, tangent sign, trail ends at plane, crash bounds + ~5% bust rate).
- **Build:** `npm run build` clean.
- **Manual QA (`npm run dev`):** each state renders; trail never leads the jet; cash-out math matches the banner; history persists across reloads; big-win fires at ≥5×; mobile layout holds.
