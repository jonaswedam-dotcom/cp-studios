// Inline-SVG unit glyphs (art style #2). Two consumers:
//  - UNIT_SVG: raw SVG strings for MapLibre HTML markers (no React).
//  - <UnitIcon/>: React component for the sidebar/modals.

export const UNIT_SVG = {
  soldier: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2" fill="currentColor"/><path d="M5 19 C5 12.5,19 12.5,19 19 Z" fill="currentColor"/></svg>',
  tank:    '<svg viewBox="0 0 24 24"><rect x="3" y="13" width="17" height="6" rx="2" fill="currentColor"/><rect x="7" y="8" width="9" height="5" rx="1.5" fill="currentColor"/><rect x="15" y="9.5" width="7" height="2" fill="currentColor"/></svg>',
  jet:     '<svg viewBox="0 0 24 24"><path d="M12 2 l1.7 9 7 3.4 -7 -.7 -.9 6.3 -1.6 0 -.9 -6.3 -7 .7 7 -3.4 Z" fill="currentColor"/></svg>',
  warship: '<svg viewBox="0 0 24 24"><path d="M3 14 h18 l-2.5 5 a2 2 0 0 1 -1.8 1 H7.3 a2 2 0 0 1 -1.8 -1 Z" fill="currentColor"/><rect x="10" y="6" width="2" height="7" fill="currentColor"/><rect x="12" y="7" width="6" height="2" fill="currentColor"/></svg>',
}

export function UnitIcon({ type, className = 'w-4 h-4' }) {
  return <span className={className} style={{ display: 'inline-block' }}
    dangerouslySetInnerHTML={{ __html: UNIT_SVG[type] || '' }} />
}

// Build a DOM element for a MapLibre marker: a colored chip with an optional count badge.
export function markerEl({ type, color, count, hq = false }) {
  const el = document.createElement('div')
  el.style.cssText = `width:30px;height:30px;border-radius:8px;background:#0b0b0bdd;border:2px solid ${color};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.6);color:#fff;position:relative`
  el.innerHTML = `<span style="width:20px;height:20px;display:block">${UNIT_SVG[type] || ''}</span>`
  if (hq) {
    const s = document.createElement('div')
    s.textContent = '⭐'
    s.style.cssText = 'position:absolute;top:-9px;left:-7px;font-size:12px'
    el.appendChild(s)
  }
  if (count) {
    const b = document.createElement('span')
    b.textContent = count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count)
    b.style.cssText = 'position:absolute;bottom:-7px;right:-7px;background:#0b0b0b;border:1px solid #555;border-radius:999px;font-size:9px;font-weight:700;padding:0 4px;line-height:14px'
    el.appendChild(b)
  }
  return el
}
