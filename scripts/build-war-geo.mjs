// Build-time only. Requires Node 18+ (global fetch) + dev deps topojson-server/-client/-simplify.
// Splits each Natural Earth 10m admin-0 COUNTRY into four quadrants (NW/NE/SW/SE), divided at
// the centroid of the country's main landmass, producing ~1k "country quarter" regions.
// No runtime deps: the quadrant clip is a self-contained Sutherland–Hodgman rectangle clip.
// Generates:
//   public/war/provinces.topojson – compact TopoJSON (shared arcs + quantized), converted to GeoJSON client-side
//   public/war/provinces.json     – { regions: { [region_id]: {name, city, country, centroid:[lng,lat], coastal, neighbors:[region_id,...]} } }
import { writeFileSync, mkdirSync } from 'node:fs'
import { topology } from 'topojson-server'
import { feature, neighbors, quantize } from 'topojson-client'
import { presimplify, simplify, quantile } from 'topojson-simplify'

const ADMIN0 = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson'
const PLACES = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson'

const QUANTIZE    = 1e4    // coordinate grid (~tens of metres at world scale)
const REMOVE_PCT  = 0.55   // drop this fraction of lowest-weight points during simplification
const ROUND_DP    = 4      // decimal places kept in the output coordinates
const CLUSTER_KM  = 3500   // drop a country's polygons farther than this from its main landmass
const QUADS       = ['NW', 'NE', 'SW', 'SE']
// Edge-adjacent quadrants within the same country (diagonals only touch at the centre point).
const QUAD_ADJ    = { NW: ['NE', 'SW'], NE: ['NW', 'SE'], SW: ['NW', 'SE'], SE: ['NE', 'SW'] }

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`)
  return res.json()
}

const ringsOf = (geometry) =>
  geometry?.type === 'Polygon' ? [geometry.coordinates[0]]
  : geometry?.type === 'MultiPolygon' ? geometry.coordinates.map((p) => p[0])
  : []
const polysOf = (geometry) =>
  geometry?.type === 'Polygon' ? [geometry.coordinates]
  : geometry?.type === 'MultiPolygon' ? geometry.coordinates : []

// Haversine great-circle distance in km, points as [lng, lat].
function distKm([lng1, lat1], [lng2, lat2]) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}
const ringCentroid = (r) => { let x = 0, y = 0; for (const [lng, lat] of r) { x += lng; y += lat } return [x / r.length, y / r.length] }
const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(a) / 2 }

// Average of the largest ring's vertices — good enough for split point + marker placement.
function centroid(geometry) {
  let best = null, bestLen = -1
  for (const r of ringsOf(geometry)) if (r && r.length > bestLen) { bestLen = r.length; best = r }
  return best ? ringCentroid(best).map((v) => +v.toFixed(ROUND_DP)) : [0, 0]
}

// Keep only the polygons within CLUSTER_KM of the largest-area landmass — drops far-flung
// exclaves (French Guiana, Hawaii, Alaska's Aleutians) that would distort the quadrants,
// while keeping clustered archipelagos (UK, Japan, Indonesia) whole.
function mainCluster(geometry) {
  const polys = polysOf(geometry)
  if (polys.length <= 1) return geometry
  let mi = 0, ma = -1
  polys.forEach((p, i) => { const a = ringArea(p[0]); if (a > ma) { ma = a; mi = i } })
  const mc = ringCentroid(polys[mi][0])
  const kept = polys.filter((p) => distKm(mc, ringCentroid(p[0])) <= CLUSTER_KM)
  return kept.length === 1 ? { type: 'Polygon', coordinates: kept[0] } : { type: 'MultiPolygon', coordinates: kept }
}

function bboxOf(geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const poly of polysOf(geometry)) for (const [lng, lat] of poly[0]) {
    if (lng < minX) minX = lng; if (lng > maxX) maxX = lng
    if (lat < minY) minY = lat; if (lat > maxY) maxY = lat
  }
  return minX === Infinity ? null : [minX, minY, maxX, maxY]
}

// Sutherland–Hodgman: clip a ring against one axis-aligned half-plane. `axis` 0=lng,1=lat.
function clipHalfPlane(ring, axis, value, keepGreater) {
  const o = axis === 0 ? 1 : 0
  const inside = (p) => (keepGreater ? p[axis] >= value : p[axis] <= value)
  const cross = (A, B) => { const t = (value - A[axis]) / (B[axis] - A[axis]); const p = []; p[axis] = value; p[o] = A[o] + (B[o] - A[o]) * t; return [p[0], p[1]] }
  const out = []
  for (let i = 0; i < ring.length; i++) {
    const A = ring[(i + ring.length - 1) % ring.length], B = ring[i]
    const aIn = inside(A), bIn = inside(B)
    if (bIn) { if (!aIn) out.push(cross(A, B)); out.push(B) }
    else if (aIn) out.push(cross(A, B))
  }
  return out
}

// Clip one ring to the rectangle [minX,minY,maxX,maxY]; returns a closed ring or null.
function clipRing(ring, [minX, minY, maxX, maxY]) {
  let r = ring.slice()
  if (r.length && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop() // drop closing dup
  r = clipHalfPlane(r, 0, minX, true);  if (r.length < 3) return null
  r = clipHalfPlane(r, 0, maxX, false); if (r.length < 3) return null
  r = clipHalfPlane(r, 1, minY, true);  if (r.length < 3) return null
  r = clipHalfPlane(r, 1, maxY, false); if (r.length < 3) return null
  r.push([r[0][0], r[0][1]]) // re-close
  return r
}

// Clip a Polygon/MultiPolygon's OUTER rings to the rect (holes dropped — negligible for a
// quadrant game map). Returns a Polygon|MultiPolygon geometry, or null if nothing survives.
function clipToRect(geometry, rect) {
  const out = []
  for (const poly of polysOf(geometry)) {
    const clipped = clipRing(poly[0], rect)
    if (clipped && clipped.length >= 4) out.push([clipped])
  }
  if (out.length === 0) return null
  return out.length === 1 ? { type: 'Polygon', coordinates: out[0] } : { type: 'MultiPolygon', coordinates: out }
}

const arcsOf = (geom) => { const out = []; const walk = (a) => (Array.isArray(a) ? a.forEach(walk) : out.push(a < 0 ? ~a : a)); walk(geom.arcs ?? []); return out }
const norm = (s) => (s || '').toString().trim().toLowerCase()
const quadOf = (lng, lat, midX, midY) => (lat >= midY ? 'N' : 'S') + (lng < midX ? 'W' : 'E')

const admin0 = await getJson(ADMIN0)
const places = await getJson(PLACES)

// Split every country into up to four quadrant Features. region_id = `<ADM0_A3>_<Q>`.
const quadFeatures = []                 // { type:'Feature', properties:{region_id}, geometry } — for the shipped map + neighbors
const cleanFeatures = []                // { properties:{code,midX,midY}, geometry } — main-cluster country, for coastline detection
const meta = {}                         // region_id -> { country, q }
const countryByName = new Map()         // normalized country name -> { code, midX, midY }
const usedCode = new Map()

for (const f of admin0.features) {
  const p = f.properties || {}
  const name = p.NAME || p.ADMIN || p.NAME_LONG || 'Unknown'
  if (!f.geometry) continue
  if (name === 'Antarctica' || p.ADM0_A3 === 'ATA') continue
  const geometry = mainCluster(f.geometry)
  const bb = bboxOf(geometry)
  if (!bb) continue

  let code = p.ADM0_A3 || p.ISO_A3 || p.SOV_A3 || name.replace(/\W+/g, '').slice(0, 6).toUpperCase()
  const seen = usedCode.get(code) || 0
  usedCode.set(code, seen + 1)
  if (seen) code = `${code}${seen + 1}` // disambiguate the rare duplicate code

  const [minX, minY, maxX, maxY] = bb
  const c = centroid(geometry)          // split at the main landmass's centroid
  const midX = Math.min(maxX, Math.max(minX, c[0]))
  const midY = Math.min(maxY, Math.max(minY, c[1]))
  const rects = {
    NW: [minX, midY, midX, maxY], NE: [midX, midY, maxX, maxY],
    SW: [minX, minY, midX, midY], SE: [midX, minY, maxX, midY],
  }
  if (!countryByName.has(norm(name))) countryByName.set(norm(name), { code, midX, midY })
  cleanFeatures.push({ type: 'Feature', properties: { code, midX, midY }, geometry })
  for (const q of QUADS) {
    const geom = clipToRect(geometry, rects[q])
    if (!geom) continue
    const rid = `${code}_${q}`
    quadFeatures.push({ type: 'Feature', properties: { region_id: rid }, geometry: geom })
    meta[rid] = { country: name, q }
  }
}

// Coastal detection on the COUNTRY topology: an arc used by exactly one country is a coastline
// / dataset edge (inter-country borders are shared, count 2). Distribute each coastal arc's
// vertices to the quadrant they fall in, so only quarters that actually touch sea are coastal.
const coastal = new Set()
{
  const cTopo = topology({ c: { type: 'FeatureCollection', features: cleanFeatures } }) // unquantized → arcs hold real coords
  const cGeoms = cTopo.objects.c.geometries
  const use = new Map()
  cGeoms.forEach((g) => arcsOf(g).forEach((idx) => use.set(idx, (use.get(idx) || 0) + 1)))
  cGeoms.forEach((g, i) => {
    const { code, midX, midY } = cleanFeatures[i].properties
    for (const idx of arcsOf(g)) {
      if ((use.get(idx) || 0) !== 1) continue
      for (const [lng, lat] of cTopo.arcs[idx]) coastal.add(`${code}_${quadOf(lng, lat, midX, midY)}`)
    }
  })
}

// Most-populous populated place per quadrant → the quarter's HQ city label.
const cityByRegion = new Map() // region_id -> { name, pop }
for (const f of places.features) {
  const p = f.properties || {}
  const info = countryByName.get(norm(p.ADM0NAME)) || countryByName.get(norm(p.SOV0NAME))
  if (!info) continue
  const [lng, lat] = f.geometry?.coordinates || [p.LONGITUDE, p.LATITUDE]
  if (lng == null || lat == null) continue
  const rid = `${info.code}_${quadOf(lng, lat, info.midX, info.midY)}`
  if (!meta[rid]) continue
  const pop = p.POP_MAX || 0
  const prev = cityByRegion.get(rid)
  if (!prev || pop > prev.pop) cityByRegion.set(rid, { name: p.NAME, pop })
}

// Build a topology from the quad Features so properties + shared arcs survive.
const ids = quadFeatures.map((f) => f.properties.region_id)
let topo = topology({ p: { type: 'FeatureCollection', features: quadFeatures } }) // unquantized

// Cross-country adjacency from shared border arcs (before point removal). Order == ids order.
const nbrs = neighbors(topo.objects.p.geometries)

// Simplify (drop lowest-weight points), THEN quantize to integer deltas (keeps output compact).
topo = presimplify(topo)
topo = simplify(topo, quantile(topo, REMOVE_PCT))
topo = quantize(topo, QUANTIZE)
const simplified = feature(topo, topo.objects.p) // centroids read from the simplified geometry

// Intra-country adjacency (the four edge pairs) added explicitly so internal moves never miss.
function intraNeighbors(rid) {
  const us = rid.lastIndexOf('_')
  const base = rid.slice(0, us), q = rid.slice(us + 1)
  return (QUAD_ADJ[q] || []).map((qq) => `${base}_${qq}`).filter((id) => meta[id])
}

const regions = {}
simplified.features.forEach((f, i) => {
  const rid = ids[i]
  const m = meta[rid] || {}
  const country = m.country || ''
  const city = cityByRegion.get(rid)?.name
  const name = city || `${country} ${m.q}`.trim()
  const neigh = new Set([...nbrs[i].map((j) => ids[j]), ...intraNeighbors(rid)])
  neigh.delete(rid)
  regions[rid] = {
    name,
    city: city || name,
    country,
    centroid: centroid(f.geometry),
    coastal: coastal.has(rid),
    neighbors: [...neigh],
  }
})

// Ship the compact TopoJSON; the client converts it to GeoJSON with topojson-client `feature()`.
// Geometries keep their region_id in properties so the map can key feature-state by it.
mkdirSync('public/war', { recursive: true })
writeFileSync('public/war/provinces.json', JSON.stringify({ regions }))
writeFileSync('public/war/provinces.topojson', JSON.stringify(topo))
const nCoastal = Object.values(regions).filter((r) => r.coastal).length
console.log(`Wrote ${Object.keys(regions).length} country-quarter regions from ${usedCode.size} countries (${nCoastal} coastal).`)
