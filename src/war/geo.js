export function landNeighbors(id, graph) {
  return graph.regions[id]?.neighbors ?? []
}

export function centroidOf(id, graph) {
  return graph.regions[id]?.centroid ?? null
}

// Haversine great-circle distance in km. Points are [lng, lat].
export function distanceKm([lng1, lat1], [lng2, lat2]) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

// All region ids whose centroid is within rangeKm of `id` (excluding `id`).
export function airReachable(id, graph, rangeKm) {
  const from = centroidOf(id, graph)
  if (!from) return []
  const out = []
  for (const [rid, r] of Object.entries(graph.regions)) {
    if (rid === id || !r.centroid) continue
    if (distanceKm(from, r.centroid) <= rangeKm) out.push(rid)
  }
  return out
}

// Connected components of the land-neighbour graph, memoized per graph object. Two regions
// share a component iff a chain of land borders connects them — i.e. they sit on the same
// landmass, so a land army can march between them without crossing open sea (warships do that).
const _landComponents = new WeakMap()
function landComponentMap(graph) {
  const cached = _landComponents.get(graph)
  if (cached) return cached
  const comp = new Map()
  let next = 0
  for (const id of Object.keys(graph.regions)) {
    if (comp.has(id)) continue
    const cid = next++
    const stack = [id]
    comp.set(id, cid)
    while (stack.length) {
      const x = stack.pop()
      for (const y of (graph.regions[x]?.neighbors ?? [])) {
        if (graph.regions[y] && !comp.has(y)) { comp.set(y, cid); stack.push(y) }
      }
    }
  }
  _landComponents.set(graph, comp)
  return comp
}

// Provinces a land army can march to from `id`: every direct border neighbour (any distance),
// PLUS any same-landmass province whose centroid is within rangeKm. The landmass constraint
// stops soldiers "swimming" across open sea — crossing to another landmass still needs a warship.
export function landReachable(id, graph, rangeKm) {
  // Seed with direct neighbours that actually exist in the graph — a stale adjacency id with
  // no region row would otherwise leak through as a clickable target with a null centroid.
  const out = new Set(landNeighbors(id, graph).filter((n) => graph.regions[n]))
  const from = centroidOf(id, graph)
  if (from) {
    const comp = landComponentMap(graph)
    const cid = comp.get(id)
    if (cid !== undefined) {
      for (const [rid, r] of Object.entries(graph.regions)) {
        if (rid === id || !r.centroid) continue
        if (comp.get(rid) === cid && distanceKm(from, r.centroid) <= rangeKm) out.add(rid)
      }
    }
  }
  out.delete(id)
  return [...out]
}

// Coastal provinces reachable by sea from a coastal `id` within rangeKm.
// Returns [] if `id` itself is not coastal.
export function seaReachable(id, graph, rangeKm) {
  const self = graph.regions[id]
  if (!self || !self.coastal) return []
  const from = self.centroid
  const out = []
  for (const [rid, r] of Object.entries(graph.regions)) {
    if (rid === id || !r.coastal || !r.centroid) continue
    if (distanceKm(from, r.centroid) <= rangeKm) out.push(rid)
  }
  return out
}
