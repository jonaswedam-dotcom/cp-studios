// Deterministic placeholder avatar from a name (matches normalizeProfile's fallback).
export function fallbackAvatar(name) {
  return `https://i.pravatar.cc/150?img=${(name?.charCodeAt(0) || 65) % 68 + 1}`
}
