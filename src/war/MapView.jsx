import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { feature } from 'topojson-client'
import { markerEl } from './icons.jsx'
import { UNITS, UNIT_TYPES } from './units.js'

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

export default function MapView({ graph, regions, movements, buildings = [], onRegionClick }) {
  const mapRef     = useRef(null)
  const containerRef = useRef(null)
  const markersRef = useRef([])     // unit/HQ markers
  const moveMarkersRef = useRef({}) // movement id -> marker
  const readyRef   = useRef(false)
  const onClickRef = useRef(onRegionClick)
  useEffect(() => { onClickRef.current = onRegionClick })

  // Init map once
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: [0, 25], zoom: 1.6, maxZoom: 5.5, minZoom: 1,
      attributionControl: true,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    mapRef.current = map

    map.on('load', async () => {
      const res = await fetch('/war/provinces.topojson')
      const topo = await res.json()
      const gj = feature(topo, topo.objects.p) // TopoJSON -> GeoJSON FeatureCollection
      map.addSource('provinces', { type: 'geojson', data: gj, promoteId: 'adm1_code' })
      map.addLayer({
        id: 'province-fills', type: 'fill', source: 'provinces',
        paint: {
          'fill-color': ['case', ['boolean', ['feature-state', 'owned'], false],
            ['feature-state', 'color'], 'rgba(255,255,255,0.02)'],
          'fill-opacity': ['case', ['boolean', ['feature-state', 'owned'], false], 0.55, 0.5],
        },
      })
      map.addLayer({
        id: 'province-lines', type: 'line', source: 'provinces',
        paint: { 'line-color': 'rgba(255,255,255,0.15)', 'line-width': 0.5 },
      })
      map.on('click', 'province-fills', (e) => {
        const f = e.features?.[0]
        if (f) onClickRef.current(f.properties.adm1_code)
      })
      map.getCanvas().style.cursor = 'pointer'
      readyRef.current = true
      syncOwnership()
      syncMarkers()
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

  useEffect(syncOwnership, [regions])
  useEffect(syncMarkers, [regions, graph, buildings])

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
        const dur = (UNITS[mv.unit_type]?.travelSeconds || 30) * 1000
        const startMs = mv.created_at ? new Date(mv.created_at).getTime() : (new Date(mv.arrives_at).getTime() - dur)
        const t = Math.min(1, Math.max(0, (now - startMs) / dur))
        const lng = from[0] + (to[0] - from[0]) * t
        const lat = from[1] + (to[1] - from[1]) * t
        live.add(mv.id)
        let mk = moveMarkersRef.current[mv.id]
        if (!mk) {
          const el = markerEl({ type: mv.unit_type, color: '#fff', count: mv.count })
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
