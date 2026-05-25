/**
 * Extract the file path inside the cp-studios bucket from a Supabase public URL.
 *
 * Public URL format:
 *   https://<project>.supabase.co/storage/v1/object/public/cp-studios/<path>
 *
 * Returns the <path> string, or null if the URL doesn't match the bucket.
 */
export function getStoragePath(url) {
  if (!url) return null
  try {
    const u      = new URL(url)
    const marker = '/storage/v1/object/public/cp-studios/'
    if (u.pathname.startsWith(marker)) {
      return decodeURIComponent(u.pathname.slice(marker.length))
    }
  } catch {
    // not a valid URL – nothing to delete from storage
  }
  return null
}
