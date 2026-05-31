// Build-time only. Requires Node 18+ (global fetch) and dev deps topojson-server/-client.
// Generates:
//   public/war/provinces.geojson  – admin-1 polygons, each feature id = adm1_code
//   public/war/provinces.json     – { regions: { [adm1_code]: {name, city, country, centroid:[lng,lat], neighbors:[adm1_code,...]} } }
import { writeFileSync, mkdirSync } from 'node:fs'
import { topology } from 'topojson-server'
import { neighbors } from 'topojson-client'

const ADMIN1 = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson'
const PLACES = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_populated_places.geojson'

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`)
  return res.json()
}

// Average of the largest ring's vertices — good enough for marker placement.
function centroid(geometry) {
  let rings = []
  if (geometry.type === 'Polygon') rings = [geometry.coordinates[0]]
  else if (geometry.type === 'MultiPolygon') rings = geometry.coordinates.map(p => p[0])
  let best = null, bestLen = -1
  for (const r of rings) if (r.length > bestLen) { bestLen = r.length; best = r }
  if (!best) return [0, 0]
  let x = 0, y = 0
  for (const [lng, lat] of best) { x += lng; y += lat }
  return [ +(x / best.length).toFixed(4), +(y / best.length).toFixed(4) ]
}

const admin1 = await getJson(ADMIN1)
const places = await getJson(PLACES)

// Pick the most populous city per (country, province) name pair.
const cityByKey = new Map()
for (const f of places.features) {
  const p = f.properties
  const key = `${p.adm0name}|${p.adm1name}`
  const pop = p.pop_max || 0
  const prev = cityByKey.get(key)
  if (!prev || pop > prev.pop) cityByKey.set(key, { name: p.name, pop })
}

// Stable order; assign adm1_code as feature id.
const feats = admin1.features.filter(f => f.properties.adm1_code)
const codes = feats.map(f => f.properties.adm1_code)
const geoms = feats.map(f => f.geometry)

// TopoJSON neighbors() gives adjacency from shared arcs (true land borders).
const topo = topology({ p: { type: 'GeometryCollection', geometries: geoms.map((g, i) => ({ ...g, id: i })) } })
const nbrs = neighbors(topo.objects.p.geometries) // array of arrays of indices

const regions = {}
feats.forEach((f, i) => {
  const p = f.properties
  const code = p.adm1_code
  const country = p.admin || p.adm0name || ''
  const cityHit = cityByKey.get(`${country}|${p.name}`)
  regions[code] = {
    name: p.name || code,
    city: cityHit ? cityHit.name : (p.name || code),
    country,
    centroid: centroid(f.geometry),
    neighbors: nbrs[i].map(j => codes[j]),
  }
})

// GeoJSON for MapLibre: keep only what we need, ensure adm1_code on each feature.
const outGeo = {
  type: 'FeatureCollection',
  features: feats.map(f => ({
    type: 'Feature',
    properties: { adm1_code: f.properties.adm1_code, name: f.properties.name, admin: f.properties.admin },
    geometry: f.geometry,
  })),
}

mkdirSync('public/war', { recursive: true })
writeFileSync('public/war/provinces.json', JSON.stringify({ regions }))
writeFileSync('public/war/provinces.geojson', JSON.stringify(outGeo))
console.log(`Wrote ${Object.keys(regions).length} provinces.`)
