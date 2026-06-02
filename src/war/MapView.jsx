import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { feature } from 'topojson-client'
import { markerEl } from './icons.jsx'
import { UNIT_TYPES } from './units.js'
import { neutralGarrison } from './neutral.js'

const BASE_STYLE = {
  version: 8,
  sources: {
    carto: {
      type: 'raster', tileSize: 256,
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      attribution: '© OpenStreetMap, © CARTO',
    },
  },
  layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
}

// Dominant unit in a region (for the single marker we show per owned region).
function topUnit(region) {
  let best = 'soldier', n = -1
  for (const t of UNIT_TYPES) if ((region[t] || 0) > n) { n = region[t] || 0; best = t }
  return best
}
function regionTotal(region) {
  return UNIT_TYPES.reduce((s, t) => s + (region[t] || 0), 0)
}

// A glowing, clickable hexagon badge that marks a province you can act on.
const TARGET_COLOR = { attack: '#ef4444', expand: '#34d399', reinforce: '#38bdf8' }
const TARGET_GLYPH = { attack: '⚔', expand: '＋', reinforce: '↑' }
const fmtCount = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)
// `defenders` (when provided) is shown as a 🛡 count under the badge so "open" countries
// reveal their hidden garrison BEFORE you attack and lose to invisible troops.
function targetMarkerEl(kind, onClick, defenders = null) {
  const color = TARGET_COLOR[kind] || '#e5e7eb'
  const wrap = document.createElement('div')
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer'
  const hex = document.createElement('div')
  hex.style.cssText = `width:26px;height:26px;display:flex;align-items:center;justify-content:center;` +
    `clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);background:${color};color:#0b0b0b;` +
    `font-size:13px;font-weight:800;box-shadow:0 0 0 2px rgba(11,11,11,.65),0 0 14px ${color};` +
    `animation:war-target-pulse 1.6s ease-in-out infinite`
  hex.textContent = TARGET_GLYPH[kind] || ''
  wrap.appendChild(hex)
  if (defenders != null) {
    const pill = document.createElement('div')
    pill.textContent = `🛡${fmtCount(defenders)}`
    pill.style.cssText = 'font-size:9px;font-weight:700;line-height:1;color:#fff;background:rgba(11,11,11,.82);' +
      'border-radius:7px;padding:2px 5px;white-space:nowrap;box-shadow:0 0 0 1px rgba(255,255,255,.12)'
    wrap.appendChild(pill)
  }
  wrap.title = kind === 'attack' ? 'Attack' : kind === 'expand' ? `Capture · ${defenders ?? '?'} defenders` : 'Reinforce'
  wrap.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
  return wrap
}

export default function MapView({ graph, regions, movements, buildings = [], onRegionClick, targets = [], underAttack = [], focus = null }) {
  const mapRef     = useRef(null)
  const containerRef = useRef(null)
  const markersRef = useRef([])     // unit/HQ markers
  const moveMarkersRef = useRef({}) // movement id -> marker
  const targetMarkersRef = useRef([]) // clickable hexagon target badges
  const ringMarkersRef = useRef([]) // pulsing red rings on my provinces under attack
  const readyRef   = useRef(false)
  const [ready, setReady] = useState(false) // state (not just ref) so paint effects re-run once the map is loaded
  const onClickRef = useRef(onRegionClick)
  const highlightedIdsRef = useRef([]) // ids that currently have 'reach' feature-state set
  const focusedRef = useRef(false) // have we already flown to the player's HQ on this mount?
  useEffect(() => { onClickRef.current = onRegionClick })

  // Init map once
  useEffect(() => {
    if (!document.getElementById('war-target-kf')) {
      const st = document.createElement('style')
      st.id = 'war-target-kf'
      st.textContent = '@keyframes war-target-pulse{0%,100%{transform:scale(1);opacity:.92}50%{transform:scale(1.14);opacity:1}}'
      document.head.appendChild(st)
    }
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: [0, 25], zoom: 1.6, maxZoom: 8, minZoom: 1,
      attributionControl: true,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    mapRef.current = map

    map.on('load', async () => {
      const res = await fetch('/war/provinces.topojson')
      const topo = await res.json()
      const gj = feature(topo, topo.objects.p) // TopoJSON -> GeoJSON FeatureCollection
      map.addSource('provinces', { type: 'geojson', data: gj, promoteId: 'region_id' })
      map.addLayer({
        id: 'province-fills', type: 'fill', source: 'provinces',
        paint: {
          'fill-color': ['case',
            ['boolean', ['feature-state', 'owned'], false], ['feature-state', 'color'],
            ['==', ['feature-state', 'reach'], 'expand'], 'rgba(52,211,153,0.28)',
            'rgba(255,255,255,0.02)'],
          'fill-opacity': ['case', ['boolean', ['feature-state', 'owned'], false], 0.55, 0.5],
        },
      })
      map.addLayer({
        id: 'province-lines', type: 'line', source: 'provinces',
        paint: {
          'line-color': ['case',
            ['==', ['feature-state', 'reach'], 'attack'], '#ef4444',
            ['==', ['feature-state', 'reach'], 'expand'], '#34d399',
            ['==', ['feature-state', 'reach'], 'reinforce'], '#38bdf8',
            'rgba(255,255,255,0.15)'],
          'line-width': ['case',
            ['any',
              ['==', ['feature-state', 'reach'], 'attack'],
              ['==', ['feature-state', 'reach'], 'expand'],
              ['==', ['feature-state', 'reach'], 'reinforce']],
            2.5, 0.5],
        },
      })
      map.on('click', 'province-fills', (e) => {
        const f = e.features?.[0]
        if (f) onClickRef.current(f.properties.region_id)
      })
      map.getCanvas().style.cursor = 'pointer'
      readyRef.current = true
      setReady(true) // triggers the paint effects below to re-run with the latest data, now that the source exists
    })

    return () => map.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tint owned provinces via feature-state
  const syncOwnership = () => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    Object.values(regions).forEach((r) => {
      map.setFeatureState({ source: 'provinces', id: r.region_id },
        r.owner_id ? { owned: true, color: r.color || '#888' } : { owned: false, color: '' })
    })
  }

  // One marker per owned region (dominant unit + count), HQ gets a star.
  const syncMarkers = () => {
    const map = mapRef.current
    if (!map || !readyRef.current || !graph) return
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []
    Object.values(regions).forEach((r) => {
      if (!r.owner_id) return
      const c = graph.regions[r.region_id]?.centroid
      if (!c) return
      const total = regionTotal(r)
      const el = markerEl({ type: topUnit(r), color: r.color || '#888', count: total, hq: r.is_hq })
      const bn = buildings.filter((b) => b.region_id === r.region_id).length
      if (bn > 0) {
        const dot = document.createElement('div')
        dot.textContent = '🏗'
        dot.style.cssText = 'position:absolute;top:-9px;right:-7px;font-size:11px'
        el.appendChild(dot)
      }
      const mk = new maplibregl.Marker({ element: el }).setLngLat(c).addTo(map)
      markersRef.current.push(mk)
    })
  }

  useEffect(syncOwnership, [regions, ready])
  useEffect(syncMarkers, [regions, graph, buildings, ready])

  // Auto-highlight every actionable target (outline + glowing clickable hexagon badge).
  const syncTargets = () => {
    const map = mapRef.current
    if (!map || !readyRef.current || !graph) return
    // Clear previous outlines + badges.
    highlightedIdsRef.current.forEach((id) => map.setFeatureState({ source: 'provinces', id }, { reach: null }))
    highlightedIdsRef.current = []
    targetMarkersRef.current.forEach((m) => m.remove())
    targetMarkersRef.current = []
    targets.forEach(({ id, kind }) => {
      map.setFeatureState({ source: 'provinces', id }, { reach: kind })
      highlightedIdsRef.current.push(id)
      const c = graph.regions[id]?.centroid
      if (!c) return
      // Neutral "take" targets (expand) reveal their hidden garrison; enemy/own do not.
      const defenders = kind === 'expand' ? neutralGarrison(id).soldier : null
      const el = targetMarkerEl(kind, () => onClickRef.current(id), defenders)
      const mk = new maplibregl.Marker({ element: el, offset: [0, -20] }).setLngLat(c).addTo(map)
      targetMarkersRef.current.push(mk)
    })
  }
  useEffect(syncTargets, [targets, graph, ready])

  // Pulsing red ring on each of my provinces with an enemy force inbound (pointer-events off so
  // it never blocks a click). Reuses the war-target-pulse keyframe injected on init.
  const syncRings = () => {
    const map = mapRef.current
    if (!map || !readyRef.current || !graph) return
    ringMarkersRef.current.forEach((m) => m.remove())
    ringMarkersRef.current = []
    underAttack.forEach((id) => {
      const c = graph.regions[id]?.centroid
      if (!c) return
      const el = document.createElement('div')
      el.style.cssText = 'width:34px;height:34px;border-radius:50%;border:2px solid #ef4444;' +
        'box-shadow:0 0 12px #ef4444;pointer-events:none;animation:war-target-pulse 1.2s ease-in-out infinite'
      ringMarkersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat(c).addTo(map))
    })
  }
  useEffect(syncRings, [underAttack, graph, ready])

  // On open, zoom from the world view into the player's HQ island (once per mount).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current || !focus || focusedRef.current) return
    focusedRef.current = true
    map.flyTo({ center: focus, zoom: 5, duration: 2200 })
  }, [focus, ready])

  // In-transit movement dots (interpolated each animation frame)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !graph) return
    let raf
    const tick = () => {
      const now = Date.now()
      const live = new Set()
      movements.forEach((mv) => {
        if (mv.status !== 'moving') return
        const from = graph.regions[mv.from_region]?.centroid
        const to   = graph.regions[mv.to_region]?.centroid
        if (!from || !to) return
        const dur = (mv.arrives_at && mv.created_at)
          ? new Date(mv.arrives_at).getTime() - new Date(mv.created_at).getTime()
          : 1200_000
        const startMs = mv.created_at ? new Date(mv.created_at).getTime() : (new Date(mv.arrives_at).getTime() - dur)
        const t = Math.min(1, Math.max(0, (now - startMs) / dur))
        const lng = from[0] + (to[0] - from[0]) * t
        const lat = from[1] + (to[1] - from[1]) * t
        live.add(mv.id)
        let mk = moveMarkersRef.current[mv.id]
        if (!mk) {
          const units = mv.units || {}
          const mvType = UNIT_TYPES.find((t) => (units[t] || 0) > 0) || 'soldier'
          const mvCount = UNIT_TYPES.reduce((s, t) => s + (units[t] || 0), 0)
          const el = markerEl({ type: mvType, color: '#fff', count: mvCount })
          el.style.opacity = '0.85'
          mk = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)
          moveMarkersRef.current[mv.id] = mk
        } else {
          mk.setLngLat([lng, lat])
        }
      })
      Object.keys(moveMarkersRef.current).forEach((id) => {
        if (!live.has(id)) { moveMarkersRef.current[id].remove(); delete moveMarkersRef.current[id] }
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [movements, graph])

  return <div ref={containerRef} className="absolute inset-0" />
}
