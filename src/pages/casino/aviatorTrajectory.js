// Pure geometry + crash math for the Aviator crash game. No React, no DOM.

export const DIMS = { w: 360, h: 286 }

// Curve anchor padding inside the board viewBox.
const PAD_LEFT = 24
const PAD_RIGHT = 24
const PAD_TOP = 40
const PAD_BOTTOM = 18

const PROGRESS_C = 4 // larger => slower asymptotic approach to the top
const RISE_EXP = 1.7 // > 1 => concave-up curve (shallow, then steep)
export const GROWTH_RATE = 0.15 // multiplier growth per second: m = e^(rate * t)

// Live multiplier (>= 1) -> normalized progress p in [0, 1). Asymptotic so any
// multiplier stays on-screen (this is the "Y-axis rescales" effect).
export function progress(m) {
  const x = Math.max(0, m - 1)
  return x / (x + PROGRESS_C)
}

// Multiplier as a function of elapsed seconds since takeoff.
export function multiplierForElapsed(seconds) {
  return Math.exp(GROWTH_RATE * Math.max(0, seconds))
}

function anchors(dims) {
  return { x0: PAD_LEFT, y0: dims.h - PAD_BOTTOM, x1: dims.w - PAD_RIGHT, y1: PAD_TOP }
}

// Point on the curve at progress p (0..1).
export function pointAt(p, dims = DIMS) {
  const { x0, y0, x1, y1 } = anchors(dims)
  const cp = Math.min(1, Math.max(0, p))
  return {
    x: x0 + (x1 - x0) * cp,
    y: y0 - (y0 - y1) * Math.pow(cp, RISE_EXP),
  }
}

// Tangent angle (degrees) at progress p for a right-pointing sprite.
export function tangentDeg(p, dims = DIMS) {
  const { x0, y0, x1, y1 } = anchors(dims)
  const cp = Math.min(1, Math.max(0, p))
  const dxdp = x1 - x0
  const dydp = -(y0 - y1) * RISE_EXP * Math.pow(cp, RISE_EXP - 1)
  return (Math.atan2(dydp, dxdp) * 180) / Math.PI
}

// SVG path strings + plane placement for progress p.
export function buildTrajectory(p, dims = DIMS, steps = 24) {
  const cp = Math.min(1, Math.max(0, p))
  const pts = []
  for (let i = 0; i <= steps; i++) pts.push(pointAt((cp * i) / steps, dims))
  const line = pts
    .map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`)
    .join(' ')
  const last = pts[pts.length - 1]
  const area = `${line} L${last.x.toFixed(2)},${dims.h} L${pts[0].x.toFixed(2)},${dims.h} Z`
  return { line, area, plane: { x: last.x, y: last.y, angleDeg: tangentDeg(cp, dims) } }
}

// Predetermined crash multiplier. Same distribution as the original game:
// ~5% instant bust at 1.00, otherwise a heavy-tailed value clamped to >= 1.01.
export function generateCrash(rng = Math.random) {
  if (rng() < 0.05) return 1.0
  const u = rng()
  return Math.max(1.01, +(1 / (1 - u * 0.95)).toFixed(2))
}
