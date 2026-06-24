import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export interface CandidateCount {
  total: number
  scored: number
  ingesting: number
  reviewed: number
  toReview: number
}

/**
 * Live candidate counts for a job. Polls every 4s while the LLM is still
 * ingesting (scoring) candidates, then stops. Used for the review/jobs/results
 * badges and the batch-ingest progress bars.
 */
export function useCandidateCount(jobId: string | null | undefined) {
  return useQuery<CandidateCount>({
    queryKey: ['candidateCount', jobId],
    queryFn: () => api.jobs.candidatesCount(jobId as string),
    enabled: !!jobId,
    refetchInterval: (query) => ((query.state.data?.ingesting ?? 0) > 0 ? 4000 : false),
  })
}
