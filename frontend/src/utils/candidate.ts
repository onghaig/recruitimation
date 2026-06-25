import type { Candidate } from '../types'

/**
 * The candidate's source profile URL, when one can be reconstructed from a
 * scraped source. Indeed candidate pages are addressable by their id; paste and
 * (for now) LinkedIn candidates have no derivable public URL, so callers fall
 * back to showing the raw source context instead.
 */
export function getProfileUrl(c: Candidate): string | null {
  if (c.source === 'indeed' && c.sourceId) {
    return `https://employers.indeed.com/candidates/view?id=${encodeURIComponent(c.sourceId)}`
  }
  return null
}
