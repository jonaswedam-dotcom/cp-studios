# Aviamasters Redesign Spec

**Date:** 2026-06-01  
**Status:** Approved  
**Reference:** https://bgaming.com/games/aviamasters-2

---

## Overview

Full redesign of `AviamastersGame.jsx` and upgrade of `aviamastersEngine.js` to replicate the
BGaming Aviamasters 2 feature set, reskinned to the CP Studios dark aesthetic. The core
pre-rolled engine architecture is preserved; new features are added as pure extensions.

---

## 1. Mechanics

### Counter Balance
The player's wager becomes a "Counter Balance" that grows or shrinks as the plane collects
items along its pre-rolled flight path. Starts at the bet amount (represented as 1.00×); the
final multiplier is applied to the original bet at round resolution.

### Collectible events (unchanged from current engine)
- `add` node — increases multiplier by a small flat amount (+0.1 / +0.2 / +0.5 / +1.0)
- `mult` node — multiplies the running multiplier (×2 / ×3 / ×4 / ×5)
- `rocket` — halves the running multiplier

### Win/loss resolution (unchanged)
- Plane lands on aircraft carrier → **win**: payout = `floor(bet × finalMult)`
- Plane splashes in ocean → **loss**: bet forfeited

### Win celebration tiers
| Tier | Threshold | Label |
|---|---|---|
| Big Win | finalMult ≥ 20× | BIG WIN |
| Mega Win | finalMult ≥ 40× | MEGA WIN |
| Super Mega Win | finalMult ≥ 80× | SUPER MEGA WIN |

Only shown on a winning round. Auto-dismisses after 2.5s or on click. Autoplay pauses
until dismissed for Super Mega Win.

---

## 2. New Features

### 2a. Boosters (4 total, one use each per round)
Booster buttons are always visible but greyed out during `betting` and `result` phases.
During `flying` they are active and can each be tapped once. After activation the button
dims and shows ✓.

Booster effects are applied via `applyBooster(events, currentIdx, boosterKind, outcome)`
which returns `{ events: newEvents, outcome: newOutcome }`.

| Booster | Icon | Effect |
|---|---|---|
| Laser Gun | 🔫 | Removes the next `rocket` in remaining unprocessed events |
| Magnet | 🧲 | Converts the next `rocket` to `add +0.5`; also flips `outcome` to `'land'` if it was `'splash'` |
| Nitro | ⚡ | Marks all remaining `rocket` events as `skipped` (no effect); halves the tick interval for the rest of the round |
| Life Buoy | 🛟 | Flips `outcome` from `'splash'` to `'land'` |

A skipped event still advances the animation (plane moves, nothing happens to the counter).

### 2b. Safe Landing
Toggle in the betting panel. When enabled:
- Deducts `bet + (50 × bet)` from balance at round start
- If the round resolves as `'splash'`, it is treated as `'land'` — payout = `floor(bet × finalMult)`; minimum payout is 0 (Counter Balance may have been halved by rockets)
- Disabled (greyed out) if `balance < bet * 51`
- UI shows "Safe Landing — costs 50× bet" with the computed extra cost displayed inline

### 2c. Autoplay
- "Auto" button next to the Spin button in the betting phase
- Opens a row of preset options: `5 / 10 / 25 / 50` rounds
- While running, main button becomes "Stop Auto"; clicking it ends autoplay after the current round completes
- Autoplay stops automatically if: balance < current bet, or a Super Mega Win triggers
- Safe Landing setting persists across autoplay rounds

---

## 3. Visual Design

### Game board (360px tall, max-w-md)
Layered back-to-front:

1. **Sky** — deep navy-to-black CSS gradient (`#030712` → `#0f172a`)
2. **Stars** — ~20 small static dots (CSS `box-shadow` trick), upper half only
3. **SVG trajectory curve** — quadratic bezier `M 8%,82% Q 55%,30% 92%,18%`; the plane follows parametric `t ∈ [0,1]`; trail gradient drawn from start to current `t`
4. **Collectible badges** — positioned along the curve at their pre-rolled `t` values; `mult` = amber glow, `add` = green glow, `rocket` = 🚀 emoji; fade to 25% opacity after collected, `skipped` rockets shown crossed-out
5. **Ocean strip** — bottom 18%; blue gradient + subtle CSS wave animation (`@keyframes wave`)
6. **Aircraft carrier** — right side of ocean; 🚢 emoji + faint white platform line; glows amber on successful landing
7. **Plane** — follows bezier at current `t`; gentle bob animation (`amPlaneFly`) in flight; on splash rotates and drops; on land descends toward carrier
8. **Counter Balance readout** — centered top half; large font (56px); color: green < 2×, amber 2–5×, orange 5×+, red when last event was rocket

### Booster bar
Rendered below the game board, always present (opacity 50% during non-flying phases).
4 buttons in a row, icon + label, rounded pill style with `cp-elevated` background and
`amber-400` border when available, greyed-out with ✓ when used.

### Win popup overlay
Full-screen semi-transparent backdrop (`rgba(0,0,0,0.8)`). Centered card:
- **Big Win** — amber glow, large "BIG WIN" text + `finalMult.toFixed(2)×`
- **Mega Win** — orange glow, "MEGA WIN"
- **Super Mega Win** — red/gold shimmer animation, "SUPER MEGA WIN"

---

## 4. Component Structure

### `aviamastersEngine.js` — additions only
```
applyBooster(events, currentIdx, boosterKind, outcome) → { events, outcome }
WIN_TIERS = { BIG: 20, MEGA: 40, SUPER_MEGA: 80 }
```
All existing exports remain unchanged. Engine stays pure (no React, no DOM).

### `AviamastersGame.jsx` — full rewrite (same file, same default export)
Sub-components (defined in the same file):
- `GameBoard` — display-only; receives phase, planeT, badges, multiplier, splashed
- `BettingPanel` — bet chips, speed, Safe Landing toggle, Autoplay picker
- `BoosterBar` — 4 booster buttons; calls `onActivate(kind)` callback
- `WinPopup` — Big/Mega/Super Mega overlay; receives `tier` prop
- `ResultPanel` — win/loss result + Play Again (minimal changes from today)

State lives in the top-level `AviamastersGame` component.

### `aviamastersEngine.test.js` — 4 new tests for `applyBooster`
One test per booster type covering the primary effect (laser removes rocket, magnet
converts rocket + flips outcome, nitro skips all rockets, life buoy flips outcome).

---

## 5. What Does Not Change

- `CasinoPage.jsx` — no changes needed; the route `/casino/aviamasters` already exists
- `App.jsx` — no route changes
- `CasinoContext.jsx` — `placeBet('aviamasters', bet, profit)` API unchanged
- RTP tuning constants in `aviamastersEngine.js` — unchanged
- All other casino games — untouched

---

## 6. Open Questions / Accepted Trade-offs

- Boosters are purely client-side (like all casino game logic in this app). A player could
  manipulate them via devtools; this is an accepted trade-off for a private friends app.
- Safe Landing is validated client-side only; same caveat.
- No backend changes required.
