/**
 * Polish a scoring flag for display. Flags arrive in mixed styles — snake_case
 * machine tokens ("unknown_job_history") and already-natural phrases
 * ("lacks required warehouse experience"). Normalise underscores to spaces and
 * capitalise the first letter, leaving the rest untouched so "and/or" and any
 * acronyms survive.
 */
export function formatFlag(flag: string): string {
  const cleaned = flag.replace(/_/g, ' ').trim()
  if (!cleaned) return ''
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}
