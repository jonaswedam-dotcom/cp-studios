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
          if (Number.isNaN(d)) continue
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
