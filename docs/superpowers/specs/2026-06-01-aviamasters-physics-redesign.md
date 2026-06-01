# Aviamasters Physics & Visual Redesign Spec

**Date:** 2026-06-01  
**Status:** Approved  
**Reference:** https://bgaming.com/games/aviamasters-2  
**Supersedes visual approach from:** `2026-06-01-aviamasters-redesign.md`

---

## Overview

Replace the current emoji + SVG + setInterval flight loop with a Canvas-based renderer
and a `requestAnimationFrame` physics loop that produces smooth 60fps animation with
trajectory-driven physics: the plane climbs on boosts, dives on rockets, and ends on
the island (win) or in the ocean (loss). All game logic (engine, boosters, Safe Landing,
Autoplay) is unchanged.

---

## 1. Physics Model

### Trajectory pre-computation

When a round starts, `assignBadgePositions(events, outcome)` (pure engine function)
converts the pre-rolled event list into a catmull-rom spline defined by control points:

```
controlPts: Array<{ x: number, altitude: number }>
  x        — 0.0 (left) to 1.0 (right), evenly spaced
  altitude — 0.0 (ocean level) to 1.0 (island height)
```

Construction rules:
- **P0 (start):** `{ x: 0, altitude: 0.30 }` — plane takes off from left island
- **Per event Pi** at `x = (i+1)/(N+2)`:
  - `add` node: altitude += `min(value * 0.18, 0.25)`
  - `mult` node: altitude += `min((value-1) * 0.12, 0.28)`
  - `rocket` node: altitude -= `0.22`
  - Altitude clamped to `[0.08, 0.92]` after each step
- **Pend (last):**
  - `outcome === 'land'`  → `altitude = 0.82` (island height)
  - `outcome === 'splash'` → `altitude = 0.06` (ocean level)

The full trajectory is evaluated at any `t ∈ [0,1]` via catmull-rom interpolation
through `controlPts`. Positions outside the first/last knot are clamped.

### Animation loop (replaces setInterval)

`requestAnimationFrame` physics loop starts on `phase → 'flying'`:

```
each frame:
  dt = (timestamp - lastTimestamp) / 1000
  planeTRef.current += T_SPEEDS[speed] * dt
  if planeTRef.current >= 1.0 → resolveRound()
  else → check badge triggers
```

**Badge trigger:** when `planeTRef.current` crosses a badge's pre-assigned `t` value for
the first time, fire the event (update `multRef`, mark badge applied, flash visual).

**Speed → t/sec mapping:**
| Speed     | t/sec | ~Flight duration |
|-----------|-------|-----------------|
| tortoise  | 0.12  | 8 s             |
| walking   | 0.20  | 5 s             |
| hare      | 0.35  | 3 s             |
| lightning | 0.65  | 1.5 s           |

**Nitro booster** doubles the effective t/sec for the remainder of the flight
(existing `nitroActive` state triggers this, same as before).

### Plane rotation

At each frame, compute the spline tangent at `planeTRef.current` using a small finite
difference (`t + 0.005`). Plane rotation angle = `atan2(dy, dx)` in canvas space
(altitude is inverted: higher altitude = lower canvas Y).

---

## 2. Canvas Visual Design

### Canvas element
- Logical resolution: **800 × 440 px**
- CSS: `width: 100%; max-width: 448px; height: auto` — scales to container
- `devicePixelRatio` scaling applied on mount for crisp rendering on HiDPI screens

### Background (drawn each frame — sky/ocean change with cloud drift)

| Layer | Description |
|-------|-------------|
| Sky gradient | `#050d1a` (top) → `#0a2040` (80%) |
| Stars | ~25 static dots, upper 40%, radii 1–2px |
| Clouds | 2 soft white bezier blobs, opacity 18%, drift left at 8px/s |
| Horizon glow | Thin cyan gradient strip at ocean boundary |
| Ocean | Bottom 22%, `#0a3050` → `#051525` gradient |
| Foam line | Animated sine wave at ocean surface, opacity 35% |

### Islands

**Left island (takeoff):**
- Small green/brown trapezoid near bottom-left
- White runway stripe (horizontal, 40px wide)
- 2 palm tree silhouettes (curved trunk + fan crown, canvas paths)
- Plane starts here at `t = 0`

**Right island (landing):**
- Same style, slightly larger, positioned at bottom-right
- Runway glows amber when plane lands successfully
- Plane descends onto the runway strip on a `'land'` outcome

### Plane (drawn every frame)

Canvas-drawn, ~44px wingspan:
- **Body:** rounded red rectangle (`#dc2626`), elongated
- **Wings:** amber (`#d97706`) swept-back, top and bottom pair
- **Tail fins:** small angled red shapes at rear
- **Propeller:** small gray circle at nose; `propAngle` increments by `0.25 rad/frame`
- **Engine glow:** amber dot at tail exhaust, radius pulses slightly
- Rotates to spline tangent angle every frame

**Event reactions:**
- Boost hit: apply `boostFlashTimer` (8 frames); draw amber halo ring around plane
- Rocket hit: apply `rocketShakeTimer` (6 frames); canvas translates by ±3px alternating;
  red halo ring around plane
- Splash end: plane tips `+0.8 rad` (nose down) over 20 frames; blue burst particles at
  impact point (8 expanding circles, fade out)
- Land end: plane rotates toward 0 rad (level), decelerates to stop on runway

### Smoke trail

- Ring buffer: last 45 `{x, y, age}` canvas positions
- Each particle: circle, radius `lerp(4, 2, age/45)`, opacity `lerp(0.5, 0, age/45)`
- Color: white at age 0, gray (`#9ca3af`) at age 45
- Drawn oldest→newest so fresh smoke is on top

### Badges (canvas, positioned along spline)

Pre-compute badge canvas positions at their `t` values once on `startFlight`:

| Type   | Shape | Fill | Text | Glow |
|--------|-------|------|------|------|
| `mult` | Rounded rect 42×22px | `#fbbf24` amber | `×N` black 12px bold | amber shadow |
| `add`  | Rounded rect 42×22px | `#4ade80` green | `+N` black 12px bold | green shadow |
| `rocket` | Missile path (nose cone + body + 2 fins) | `#ef4444` red | — | orange exhaust flame |

**Uncollected:** gentle pulse — scale oscillates `1.0 ± 0.04` at 1.5s period  
**Collected:** opacity lerps from 1.0 → 0.12 over 0.3s  
**Skipped rockets** (via nitro/laser): drawn at 30% opacity, no exhaust flame

### Counter Balance (canvas, upper-centre)

- Position: `x = canvas.width/2`, `y = canvas.height * 0.32`
- Font: `900 52px` system-ui; `textAlign: 'center'`
- Colour: green `#86efac` (< 2×), amber `#fde68a` (2–5×), orange `#fdba74` (5×+),
  red `#f87171` (splashed)
- On event trigger: `flashScale` lerps `1.0 → 1.18 → 1.0` over 0.28s
- Below multiplier (12px): `Bet: N coins` in `#6b7280` during flight

---

## 3. Component Structure

### `aviamastersEngine.js` — one addition

```js
export function assignBadgePositions(events, outcome)
// Returns { controlPts: [{x, altitude}], badges: [{...ev, t, applied: false}] }
// Pure function, no DOM, fully testable.
```

New tests in `aviamastersEngine.test.js`:
- End altitude is ≥ 0.75 for `'land'` outcome
- End altitude is ≤ 0.15 for `'splash'` outcome
- All control point altitudes within `[0.08, 0.92]` (clamped)

### `AviamastersGame.jsx` — changes

**Module-level:**
- `CANVAS_W = 800`, `CANVAS_H = 440`
- `T_SPEEDS = { tortoise: 0.12, walking: 0.20, hare: 0.35, lightning: 0.65 }`
- Canvas drawing helpers (pure functions): `drawBackground`, `drawIsland`, `drawPlane`,
  `drawTrail`, `drawBadge`, `drawRocket`, `drawCounterBalance`, `splinePoint`
- `splinePoint(t, controlPts)` — catmull-rom evaluation, returns `{x, y}` in canvas px

**`GameBoard` component — full rewrite to canvas:**
```
props: phase, controlPtsRef, badgesRef, multRef, planeTRef, speedRef
- Mounts canvas, applies devicePixelRatio scaling
- Runs own rAF draw loop (reads all refs every frame — no React re-renders at 60fps)
- Manages local animation state via refs: propAngle, trailBuffer,
  boostFlashTimer, rocketShakeTimer, badgeFadeMap, splashParticles
- Cleans up rAF on unmount
```

**`AviamastersGame` main component — flight loop replacement:**
- `planeTRef`, `controlPtsRef`, `badgesRef` replace `eventIdx` state and the old interval
- `startFlight` calls `assignBadgePositions`, stores results in refs, starts rAF physics loop
- Physics loop: advances `planeTRef`, triggers badge events, calls `resolveRound` at `t ≥ 1`
- `multRef` updated synchronously when badge fires (canvas reads it directly)
- `multiplier` React state still updated for `BettingPanel`/`ResultPanel` colour/text outside canvas
- `nitroActive` doubles `T_SPEEDS[speed]` in the physics loop

**Unchanged:** `BettingPanel`, `BoosterBar`, `WinPopup`, `ResultPanel`, all booster/Safe Landing/Autoplay logic, `placeBet` calls, keyframe injection (only `amWave` still needed for ocean; plane animation is now canvas-based).

---

## 4. What Does Not Change

- `aviamastersEngine.js` existing exports (generateRound, applyBooster, WIN_TIERS, etc.)
- All 9 existing engine tests
- Casino route `/casino/aviamasters` — no routing changes
- `CasinoContext.placeBet` API
- `BettingPanel`, `BoosterBar`, `WinPopup`, `ResultPanel` components
- Safe Landing cost/logic, Autoplay round counting, win tier detection
