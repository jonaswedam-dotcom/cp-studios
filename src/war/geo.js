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
    if (rid === id) continue
    if (distanceKm(from, r.centroid) <= rangeKm) out.push(rid)
  }
  return out
}
