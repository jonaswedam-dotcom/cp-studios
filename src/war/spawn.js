// Pick a random unclaimed region id. rng() returns [0,1). Returns null if none free.
export function pickRandomSpawn(graph, claimedSet, rng = Math.random) {
  const free = Object.keys(graph.regions).filter((id) => !claimedSet.has(id))
  if (free.length === 0) return null
  const idx = Math.min(free.length - 1, Math.floor(rng() * free.length))
  return free[idx]
}
