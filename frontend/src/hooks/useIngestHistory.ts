import { useCallback, useEffect, useState } from 'react'

export interface IngestHistoryEntry {
  id: string
  type: 'batch' | 'single'
  createdAt: number
  jobId?: string
  jobTitle: string
  count?: number // batch: number of files ingested
  candidateName?: string // single
  matchScore?: number | null
  willingScore?: number | null
}

const KEY = 'recruitimation.ingestHistory'
const MAX = 50

function load(): IngestHistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

/**
 * Persistent (localStorage) history of parsing attempts — survives refresh and
 * is shared across tabs of the same origin. Batch entries keep their jobId so
 * progress can be re-polled after a reload.
 */
export function useIngestHistory() {
  const [history, setHistory] = useState<IngestHistoryEntry[]>(load)

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setHistory(load())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const persist = useCallback((next: IngestHistoryEntry[]) => {
    setHistory(next)
    localStorage.setItem(KEY, JSON.stringify(next))
  }, [])

  const add = useCallback(
    (entry: Omit<IngestHistoryEntry, 'id' | 'createdAt'>) => {
      const e: IngestHistoryEntry = {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: Date.now(),
      }
      // Merge against the freshest localStorage value (another tab may have added).
      persist([e, ...load()].slice(0, MAX))
    },
    [persist],
  )

  const clear = useCallback(() => persist([]), [persist])

  return { history, add, clear }
}
