export const EVENT_KINDS = ['captured', 'lost', 'defended', 'attack_failed', 'bounced', 'eliminated']

const cityOf = (id, graph) => graph?.regions?.[id]?.city || id

// → { icon, text } for a war_events row. Pure; safe on partial graphs.
export function describeEvent(ev, graph) {
  const where = cityOf(ev.region_id, graph)
  const d = ev.detail || {}
  const coins = typeof d.coins === 'number' ? d.coins.toLocaleString() : null
  switch (ev.kind) {
    case 'captured':
      return { icon: '⚔', text: coins && d.coins > 0 ? `Captured ${where} (+${coins})` : `Captured ${where}` }
    case 'lost':
      return { icon: '💀', text: `Lost ${where}${d.opponent ? ` to ${d.opponent}` : ''}` }
    case 'defended':
      return { icon: '🛡', text: `Defended ${where}${d.opponent ? ` from ${d.opponent}` : ''}` }
    case 'attack_failed':
      return { icon: '✈', text: d.neutral
        ? `Your attack on ${where} was repelled by its garrison`
        : `Attack on ${where} failed` }
    case 'bounced':
      return { icon: '↩', text: `Forces bounced off ${where} (shielded)` }
    case 'eliminated':
      return { icon: '☠', text: `You were eliminated` }
    default:
      return { icon: '•', text: where }
  }
}
