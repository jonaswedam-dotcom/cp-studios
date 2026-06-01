import { progress, buildTrajectory, pointAt, DIMS } from './aviatorTrajectory'

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Right-pointing jet (Material "flight" glyph rotated to face +x), drawn at (x, y),
// banked to angleDeg. On crash, an inner wrapper animates it forward off-screen.
function Jet({ x, y, angleDeg, color, flyoff }) {
  return (
    <g transform={`translate(${x},${y}) rotate(${angleDeg})`} filter="url(#fb-glow)">
      <g style={flyoff ? { animation: 'fbFlyoff 0.6s ease-in forwards' } : undefined}>
        <g transform="scale(1.25) translate(-12,-12) rotate(90 12 12)">
          <path
            d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"
            fill={color}
          />
        </g>
      </g>
    </g>
  )
}

export default function FlightBoard({ phase, multiplier, crashPoint, cashedOutAt, bet }) {
  const betting = phase === 'betting'
  const flying = phase === 'flying'
  const crashed = phase === 'crashed'
  const cashedOut = phase === 'cashedout'

  const p = progress(multiplier)
  const { line, area, plane } = buildTrajectory(p, DIMS)
  const origin = pointAt(0, DIMS)

  const strokeColor = crashed ? '#ef4444' : 'url(#fb-stroke)'
  const fillRef = crashed ? 'url(#fb-fill-red)' : 'url(#fb-fill)'
  const multColor = betting ? '#7a7570' : crashed ? '#f87171' : '#fde68a'
  const multShadow = crashed
    ? '0 0 26px rgba(239,68,68,0.5)'
    : betting
      ? 'none'
      : '0 0 30px rgba(251,191,36,0.5)'

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${DIMS.w} / ${DIMS.h}`,
        borderRadius: 16,
        overflow: 'hidden',
        background: 'radial-gradient(130% 120% at 16% 96%, #1c160b 0%, #0c0a09 66%)',
        border: '1px solid #252525',
        boxShadow: crashed ? 'inset 0 0 70px rgba(239,68,68,0.35)' : 'none',
        animation: crashed && !REDUCED_MOTION ? 'fbShake 0.4s ease' : 'none',
      }}
    >
      {/* Container enforces the matching aspect-ratio, so "meet" renders identically
          to "none" here but degrades gracefully (letterbox, not distort) if an
          ancestor ever constrains height independently. */}
      <svg
        viewBox={`0 0 ${DIMS.w} ${DIMS.h}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        <defs>
          <linearGradient id="fb-fill" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.26" />
          </linearGradient>
          <linearGradient id="fb-fill-red" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0" />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0.22" />
          </linearGradient>
          <linearGradient id="fb-stroke" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#b45309" />
            <stop offset="58%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#fde68a" />
          </linearGradient>
          <linearGradient id="fb-jet" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#fffbeb" />
          </linearGradient>
          <filter id="fb-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <g stroke="#fcd34d" strokeWidth="0.6" opacity="0.1">
          <line x1="0" y1="200" x2={DIMS.w} y2="200" />
          <line x1="0" y1="140" x2={DIMS.w} y2="140" />
          <line x1="0" y1="80" x2={DIMS.w} y2="80" />
        </g>

        {betting ? (
          <line
            x1="20" y1={DIMS.h - 22} x2="150" y2={DIMS.h - 22}
            stroke="#3f3f46" strokeWidth="2" strokeDasharray="6 6"
          />
        ) : (
          <>
            <path d={area} fill={fillRef} />
            <path
              d={line} fill="none" stroke={strokeColor} strokeWidth="4"
              strokeLinecap="round" filter="url(#fb-glow)" opacity={crashed ? 0.85 : 1}
            />
            {flying && !REDUCED_MOTION && [0.95, 0.9, 0.85].map((f, i) => {
              const e = pointAt(p * f, DIMS)
              return <circle key={i} cx={e.x} cy={e.y} r={2.6 - i * 0.5} fill="#fde68a" opacity={0.5 - i * 0.12} />
            })}
          </>
        )}

        <Jet
          x={betting ? origin.x : plane.x}
          y={betting ? origin.y : plane.y}
          angleDeg={betting ? 0 : plane.angleDeg}
          color={crashed ? '#f87171' : 'url(#fb-jet)'}
          flyoff={crashed && !REDUCED_MOTION}
        />
      </svg>

      <div style={{ position: 'absolute', left: '7%', top: '11%', pointerEvents: 'none' }}>
        <div
          style={{
            fontFamily: '"Playfair Display", Georgia, serif',
            fontWeight: 800,
            fontSize: 'clamp(34px, 12vw, 52px)',
            color: multColor,
            textShadow: multShadow,
            lineHeight: 1,
          }}
        >
          {multiplier.toFixed(2)}×
        </div>
        {betting && <div style={{ fontSize: 11, color: '#78716c', marginTop: 4 }}>Ready for takeoff</div>}
        {flying && (
          <div style={{ fontSize: 12, color: '#a8a29e', marginTop: 4 }}>
            Bet {bet} · cash out for <b style={{ color: '#fcd34d' }}>{Math.floor(bet * (multiplier - 1))}</b>
          </div>
        )}
      </div>

      {crashed && (
        <div style={{ position: 'absolute', left: '7%', top: '40%', fontWeight: 800, letterSpacing: 2, color: '#f87171', fontSize: 14 }}>
          FLEW AWAY ✈ {crashPoint != null ? crashPoint.toFixed(2) : '—'}×
        </div>
      )}

      {cashedOut && (
        <div style={{ position: 'absolute', top: 10, right: 10, fontSize: 11, fontWeight: 700, color: '#34d399', background: 'rgba(16,185,129,0.14)', border: '1px solid rgba(52,211,153,0.4)', borderRadius: 9, padding: '4px 9px' }}>
          Cashed out {cashedOutAt != null ? cashedOutAt.toFixed(2) : '—'}×
        </div>
      )}

      <style>{`
        @keyframes fbFlyoff { to { transform: translate(160px, 0px); opacity: 0; } }
        @keyframes fbShake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)} }
      `}</style>
    </div>
  )
}
