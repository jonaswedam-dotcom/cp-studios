// Build-time only. Requires Node 18+ (global fetch) + dev deps topojson-server/-client/-simplify.
// Uses Natural Earth 10m admin-1 (~4.6k provinces) quantized + simplified so the shipped
// GeoJSON stays small; the game caps zoom, so simplification is invisible in play.
// Generates:
//   public/war/provinces.topojson – compact TopoJSON (shared arcs + quantized), converted to GeoJSON client-side
//   public/war/provinces.json     – { regions: { [adm1_code]: {name, city, country, centroid:[lng,lat], neighbors:[adm1_code,...]} } }
import { writeFileSync, mkdirSync } from 'node:fs'
import { topology } from 'topojson-server'
import { feature, neighbors, quantize } from 'topojson-client'
import { presimplify, simplify, quantile } from 'topojson-simplify'

const ADMIN1 = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson'
const PLACES = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson'

const QUANTIZE   = 1e4   // coordinate grid (~tens of metres at world scale)
const REMOVE_PCT = 0.72  // drop this fraction of lowest-weight points during simplification
const ROUND_DP   = 4     // decimal places kept in the output coordinates

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`)
  return res.json()
}

// Average of the largest ring's vertices — good enough for marker placement.
function centroid(geometry) {
  if (!geometry) return [0, 0]
  let rings = []
  if (geometry.type === 'Polygon') rings = [geometry.coordinates[0]]
  else if (geometry.type === 'MultiPolygon') rings = geometry.coordinates.map(p => p[0])
  let best = null, bestLen = -1
  for (const r of rings) if (r && r.length > bestLen) { bestLen = r.length; best = r }
  if (!best) return [0, 0]
  let x = 0, y = 0
  for (const [lng, lat] of best) { x += lng; y += lat }
  return [ +(x / best.length).toFixed(ROUND_DP), +(y / best.length).toFixed(ROUND_DP) ]
}

const admin1 = await getJson(ADMIN1)
const places = await getJson(PLACES)

// Most populous city per (country, province) name pair.
// NOTE: the 10m populated-places dataset uses UPPERCASE property names.
const cityByKey = new Map()
for (const f of places.features) {
  const p = f.properties
  const key = `${p.ADM0NAME}|${p.ADM1NAME}`
  const pop = p.POP_MAX || 0
  const prev = cityByKey.get(key)
  if (!prev || pop > prev.pop) cityByKey.set(key, { name: p.NAME, pop })
}

const feats = admin1.features.filter(f => f.properties.adm1_code)
const codes = feats.map(f => f.properties.adm1_code)

// Build a topology from Features so properties survive into the simplified output.
const fc = {
  type: 'FeatureCollection',
  features: feats.map(f => ({
    type: 'Feature',
    properties: { adm1_code: f.properties.adm1_code, name: f.properties.name, admin: f.properties.admin },
    geometry: f.geometry,
  })),
}
let topo = topology({ p: fc }) // unquantized — presimplify needs geographic coords

// Adjacency from shared arcs (before point removal, which doesn't change which arcs are
// shared). Geometry order is preserved == codes order.
const nbrs = neighbors(topo.objects.p.geometries)

// Pipeline: simplify first (drop the lowest-weight REMOVE_PCT of points), THEN quantize
// to integer deltas. Quantizing last keeps the shipped TopoJSON compact.
topo = presimplify(topo)
topo = simplify(topo, quantile(topo, REMOVE_PCT))
topo = quantize(topo, QUANTIZE)

// Centroids are read from the simplified geometry (converted once here, not shipped).
const simplified = feature(topo, topo.objects.p) // FeatureCollection, properties preserved

const regions = {}
simplified.features.forEach((f, i) => {
  const code = codes[i]
  const country = f.properties.admin || ''
  const name = f.properties.name || code
  const cityHit = cityByKey.get(`${country}|${name}`)
  regions[code] = {
    name,
    city: cityHit ? cityHit.name : name,
    country,
    centroid: centroid(f.geometry),
    neighbors: nbrs[i].map(j => codes[j]),
  }
})

// Ship the compact TopoJSON (shared arcs + quantized integer deltas); the client
// converts it to GeoJSON with topojson-client `feature()`. Geometries keep their
// adm1_code in properties so the map can key feature-state by it.
mkdirSync('public/war', { recursive: true })
writeFileSync('public/war/provinces.json', JSON.stringify({ regions }))
writeFileSync('public/war/provinces.topojson', JSON.stringify(topo))
console.log(`Wrote ${Object.keys(regions).length} provinces.`)
