// ── Canvas constants ──────────────────────────────────────────────────────────
export const CANVAS_W = 800
export const CANVAS_H = 440

// Canvas y-coordinates for altitude extremes
const RUNWAY_Y = CANVAS_H * 0.74   // altitude 1.0 → runway height
const WATER_Y  = CANVAS_H * 0.84   // altitude 0.0 → ocean crash level
const LEFT_X   = CANVAS_W * 0.08   // x=0 in spline → canvas left margin
const RIGHT_X  = CANVAS_W * 0.90   // x=1 in spline → canvas right margin

// ── Spline math ───────────────────────────────────────────────────────────────

// Evaluate a catmull-rom spline at t ∈ [0,1] through controlPts [{x, altitude}].
export function splinePoint(t, controlPts) {
  const n = controlPts.length
  if (n < 2) return controlPts[0] || { x: 0, altitude: 0.5 }

  const tc   = Math.max(0, Math.min(1, t))
  const segs = n - 1
  const raw  = tc * segs
  const seg  = Math.min(Math.floor(raw), segs - 1)
  const lt   = raw - seg

  const p0 = controlPts[Math.max(0, seg - 1)]
  const p1 = controlPts[seg]
  const p2 = controlPts[Math.min(n - 1, seg + 1)]
  const p3 = controlPts[Math.min(n - 1, seg + 2)]

  const lt2 = lt * lt
  const lt3 = lt2 * lt

  const interp = (a, b, c, d) =>
    0.5 * (2*b + (-a+c)*lt + (2*a-5*b+4*c-d)*lt2 + (-a+3*b-3*c+d)*lt3)

  return {
    x:        interp(p0.x,        p1.x,        p2.x,        p3.x),
    altitude: interp(p0.altitude, p1.altitude, p2.altitude, p3.altitude),
  }
}

// Convert spline {x, altitude} to canvas pixel {cx, cy}.
export function splineToCanvas(pt) {
  return {
    cx: LEFT_X + pt.x * (RIGHT_X - LEFT_X),
    cy: WATER_Y - pt.altitude * (WATER_Y - RUNWAY_Y),
  }
}

// ── Static scene data ─────────────────────────────────────────────────────────

// Deterministic star positions (no Math.random — stable across renders)
export const STARS = Array.from({ length: 25 }, (_, i) => ({
  xFrac: ((i * 97 + 13) * 31 % 10000) / 10000,
  yFrac: ((i * 61 + 7)  * 17 % 4000)  / 10000,
  r:     i % 4 === 0 ? 1.5 : 0.8,
  op:    0.25 + (i % 5) * 0.08,
}))

// Cloud shape templates (fractions of W/H; drift horizontally with cloudOffset)
export const CLOUD_TEMPLATES = [
  { xFrac: 0.25, yFrac: 0.13, blobs: [{dx:0,dy:0,r:26},{dx:22,dy:-8,r:20},{dx:-18,dy:-5,r:18}] },
  { xFrac: 0.68, yFrac: 0.21, blobs: [{dx:0,dy:0,r:20},{dx:18,dy:-6,r:16},{dx:-14,dy:-4,r:14}] },
]

// ── Drawing helpers ───────────────────────────────────────────────────────────

function drawCloud(ctx, cx, cy, blobs) {
  ctx.save()
  ctx.globalAlpha = 0.18
  ctx.fillStyle = '#ffffff'
  for (const { dx, dy, r } of blobs) {
    ctx.beginPath()
    ctx.arc(cx + dx, cy + dy, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function drawBackground(ctx, cloudOffset, time) {
  const W = CANVAS_W, H = CANVAS_H

  // Sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.78)
  sky.addColorStop(0,   '#050d1a')
  sky.addColorStop(0.6, '#0a1828')
  sky.addColorStop(1,   '#0a2040')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H * 0.78)

  // Stars
  for (const s of STARS) {
    ctx.globalAlpha = s.op
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(s.xFrac * W, s.yFrac * H, s.r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // Drifting clouds
  for (const cloud of CLOUD_TEMPLATES) {
    let x = cloud.xFrac * W - cloudOffset % (W + 200)
    if (x < -100) x += W + 200
    drawCloud(ctx, x, cloud.yFrac * H, cloud.blobs)
  }

  // Horizon glow
  const hz = ctx.createLinearGradient(0, H * 0.72, 0, H * 0.78)
  hz.addColorStop(0, 'rgba(0,180,200,0.07)')
  hz.addColorStop(1, 'rgba(0,180,200,0)')
  ctx.fillStyle = hz
  ctx.fillRect(0, H * 0.72, W, H * 0.06)

  // Ocean
  const ocean = ctx.createLinearGradient(0, H * 0.78, 0, H)
  ocean.addColorStop(0, '#0a3050')
  ocean.addColorStop(1, '#051525')
  ctx.fillStyle = ocean
  ctx.fillRect(0, H * 0.78, W, H * 0.22)

  // Animated foam line
  ctx.strokeStyle = 'rgba(148,210,235,0.35)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let x = 0; x <= W; x += 4) {
    const y = H * 0.785 + Math.sin(x / W * Math.PI * 6 + time * 1.5) * 2
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.stroke()
}

function drawPalm(ctx, x, y) {
  ctx.strokeStyle = '#5c3d1e'
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.quadraticCurveTo(x + 4, y - 10, x + 2, y - 20)
  ctx.stroke()

  ctx.strokeStyle = '#4ade80'
  ctx.lineWidth = 1.5
  for (const [dx, dy] of [[-12,-6],[8,-8],[12,2],[-6,6],[0,-10]]) {
    ctx.beginPath()
    ctx.moveTo(x + 2, y - 20)
    ctx.lineTo(x + 2 + dx, y - 20 + dy)
    ctx.stroke()
  }
}

export function drawIsland(ctx, side, glowing) {
  const W = CANVAS_W, H = CANVAS_H
  const isLeft  = side === 'left'
  const centerX = isLeft ? W * 0.05 : W * 0.91
  const halfW   = isLeft ? W * 0.055 : W * 0.065
  const topY    = H * 0.79
  const baseY   = H * 0.88

  if (glowing) {
    ctx.shadowBlur = 22
    ctx.shadowColor = '#fbbf24'
  }

  // Island body
  ctx.fillStyle = '#2d4a1e'
  ctx.beginPath()
  ctx.moveTo(centerX - halfW * 0.6, topY)
  ctx.lineTo(centerX + halfW * 0.6, topY)
  ctx.lineTo(centerX + halfW, baseY)
  ctx.lineTo(centerX - halfW, baseY)
  ctx.closePath()
  ctx.fill()

  // Sandy top
  ctx.fillStyle = '#8b7355'
  ctx.beginPath()
  ctx.ellipse(centerX, topY, halfW * 0.55, H * 0.012, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.shadowBlur = 0

  // Runway stripe
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillRect(centerX - halfW * 0.45, topY - 2, halfW * 0.9, 4)

  // Palm trees
  const palmCount = isLeft ? 1 : 2
  for (let i = 0; i < palmCount; i++) {
    const px = centerX + (palmCount === 1 ? halfW * 0.25 : (i === 0 ? -halfW * 0.3 : halfW * 0.3))
    drawPalm(ctx, px, topY)
  }
}

export function drawPlane(ctx, cx, cy, angle, propAngle, flashKind) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)

  // Flash halo
  if (flashKind === 'boost') {
    ctx.shadowBlur = 18
    ctx.shadowColor = '#fbbf24'
    ctx.strokeStyle = '#fbbf2480'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(0, 0, 18, 0, Math.PI * 2)
    ctx.stroke()
    ctx.shadowBlur = 0
  } else if (flashKind === 'rocket') {
    ctx.strokeStyle = '#f8717180'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(0, 0, 18, 0, Math.PI * 2)
    ctx.stroke()
  }

  // Engine glow (tail exhaust)
  ctx.globalAlpha = 0.55
  ctx.fillStyle = '#fbbf24'
  ctx.beginPath()
  ctx.arc(-20, 0, 3.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  // Swept wings (amber)
  ctx.fillStyle = '#d97706'
  // Upper wing
  ctx.beginPath()
  ctx.moveTo(4, -3); ctx.lineTo(-6, -3); ctx.lineTo(-12, -19); ctx.lineTo(0, -17)
  ctx.closePath(); ctx.fill()
  // Lower wing
  ctx.beginPath()
  ctx.moveTo(4, 3); ctx.lineTo(-6, 3); ctx.lineTo(-12, 19); ctx.lineTo(0, 17)
  ctx.closePath(); ctx.fill()

  // Tail fin
  ctx.fillStyle = '#b91c1c'
  ctx.beginPath()
  ctx.moveTo(-14, 0); ctx.lineTo(-21, -10); ctx.lineTo(-20, 0)
  ctx.closePath(); ctx.fill()

  // Fuselage (red ellipse)
  ctx.fillStyle = '#dc2626'
  ctx.beginPath()
  ctx.ellipse(0, 0, 18, 7, 0, 0, Math.PI * 2)
  ctx.fill()

  // Cockpit window
  ctx.fillStyle = '#60a5fa'
  ctx.beginPath()
  ctx.ellipse(7, -2, 4.5, 3.5, -0.3, 0, Math.PI * 2)
  ctx.fill()

  // Propeller (two blades, spinning)
  ctx.save()
  ctx.translate(18, 0)
  ctx.rotate(propAngle)
  ctx.fillStyle = '#374151'
  ctx.beginPath(); ctx.ellipse(0, 0, 9, 2.5, 0, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.ellipse(0, 0, 9, 2.5, Math.PI / 2, 0, Math.PI * 2); ctx.fill()
  ctx.restore()

  ctx.restore()
}

// trailBuffer: [{cx, cy}], index 0 = oldest, index N-1 = newest
export function drawTrail(ctx, trailBuffer) {
  const n = trailBuffer.length
  if (n < 2) return
  for (let i = 0; i < n; i++) {
    const { cx, cy } = trailBuffer[i]
    const frac  = i / (n - 1)
    const alpha = frac * 0.5
    const r     = 1.5 + frac * 2.5
    const gray  = Math.round(120 + frac * 80)
    ctx.globalAlpha = alpha
    ctx.fillStyle = `rgb(${gray},${gray},${gray})`
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

export function drawBadge(ctx, cx, cy, kind, value, opacity, scale) {
  if (opacity < 0.01) return
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)

  const BW = 44, BH = 22, BR = 6
  const fill = kind === 'mult' ? '#fbbf24' : '#4ade80'
  const glow = kind === 'mult' ? 'rgba(251,191,36,0.6)' : 'rgba(74,222,128,0.5)'
  const label = kind === 'mult' ? `×${value}` : `+${value}`

  ctx.shadowBlur = 12
  ctx.shadowColor = glow
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.roundRect(-BW / 2, -BH / 2, BW, BH, BR)
  ctx.fill()

  ctx.shadowBlur = 0
  ctx.fillStyle = '#000'
  ctx.font = 'bold 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, 0, 0)

  ctx.restore()
}

export function drawRocket(ctx, cx, cy, opacity, showFlame) {
  if (opacity < 0.01) return
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.translate(cx, cy)
  const BL = 24, BH = 8

  // Exhaust flame (left of body)
  if (showFlame) {
    const flameGrad = ctx.createLinearGradient(-BL / 2, 0, -BL / 2 - 14, 0)
    flameGrad.addColorStop(0, 'rgba(251,146,60,0.9)')
    flameGrad.addColorStop(1, 'rgba(251,146,60,0)')
    ctx.fillStyle = flameGrad
    ctx.beginPath()
    ctx.ellipse(-BL / 2 - 7, 0, 10, 4, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // Body
  ctx.fillStyle = '#ef4444'
  ctx.beginPath()
  ctx.roundRect(-BL / 2, -BH / 2, BL, BH, 2)
  ctx.fill()

  // Nose cone (right)
  ctx.fillStyle = '#dc2626'
  ctx.beginPath()
  ctx.moveTo(BL / 2, -BH / 2)
  ctx.lineTo(BL / 2 + 9, 0)
  ctx.lineTo(BL / 2, BH / 2)
  ctx.closePath()
  ctx.fill()

  // Tail fins
  ctx.fillStyle = '#b91c1c'
  ctx.beginPath()
  ctx.moveTo(-BL / 2 + 4, -BH / 2)
  ctx.lineTo(-BL / 2 - 4, -BH / 2 - 7)
  ctx.lineTo(-BL / 2 + 8, -BH / 2)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-BL / 2 + 4, BH / 2)
  ctx.lineTo(-BL / 2 - 4, BH / 2 + 7)
  ctx.lineTo(-BL / 2 + 8, BH / 2)
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

export function drawCounterBalance(ctx, multiplier, splashed, flashScale, bet) {
  const W = CANVAS_W, H = CANVAS_H
  const color = splashed     ? '#f87171'
    : multiplier < 2         ? '#86efac'
    : multiplier < 5         ? '#fde68a'
    :                          '#fdba74'

  ctx.save()
  ctx.translate(W / 2, H * 0.30)
  ctx.scale(flashScale, flashScale)

  ctx.shadowBlur = 24
  ctx.shadowColor = color + '80'
  ctx.fillStyle = color
  ctx.font = '900 52px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${multiplier.toFixed(2)}×`, 0, 0)

  ctx.shadowBlur = 0
  ctx.font = '400 11px system-ui, sans-serif'
  ctx.fillStyle = splashed ? '#f87171' : '#6b7280'

  if (splashed) {
    ctx.fillText('SPLASH', 0, 38)
  } else if (bet != null) {
    ctx.fillText(`Bet: ${bet.toLocaleString()} coins`, 0, 38)
  }

  ctx.restore()
}
