import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { Loader2, ChevronLeft } from 'lucide-react'
import { api } from '../api/client'
import type { Job, Candidate } from '../types'
import CandidateCard from '../components/CandidateCard'
import CandidateDetail from './CandidateDetail'
import { useCandidateCount } from '../hooks/useCandidateCount'

type Filter = 'keep' | 'pin' | 'skip' | 'all'

export default function ResultsGrid() {
  const { jobId: routeJobId } = useParams()
  const navigate = useNavigate()
  const [jobId, setJobId] = useState<string | null>(routeJobId ?? null)
  const [filter, setFilter] = useState<Filter>('keep')
  const [selected, setSelected] = useState<Candidate | null>(null)

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs'],
    queryFn: api.jobs.list,
  })

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['candidates', jobId, filter],
    queryFn: () =>
      api.jobs.candidates(jobId!, { decision: filter === 'all' ? undefined : filter }),
    enabled: !!jobId,
  })

  const { data: counts } = useCandidateCount(jobId)

  const selectedJob = jobs.find((j) => j.id === jobId)

  if (!jobId) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Results — Select Job</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {jobs.map((j: Job) => (
            <button
              key={j.id}
              className="card p-5 text-left hover:shadow-md transition-shadow"
              onClick={() => setJobId(j.id)}
            >
              <h3 className="font-semibold">{j.title}</h3>
              <p className="text-sm text-slate-500">
                {[j.location, j.payRange].filter(Boolean).join(' · ')}
              </p>
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (selected) {
    return (
      <CandidateDetail
        candidate={selected}
        jobId={jobId}
        onBack={() => setSelected(null)}
      />
    )
  }

  const filterButtons: { key: Filter; label: string }[] = [
    { key: 'keep', label: '✅ Keep' },
    { key: 'pin', label: '📌 Pin' },
    { key: 'skip', label: '⏭ Skip' },
    { key: 'all', label: 'All' },
  ]

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button className="btn-secondary" onClick={() => navigate('/jobs')}>
          <ChevronLeft size={16} /> Jobs
        </button>
        <h1 className="text-2xl font-bold flex-1">{selectedJob?.title}</h1>
        {counts && (
          <span className="text-sm text-slate-500">
            {counts.scored} total
            {counts.ingesting > 0 && (
              <span className="ml-2 text-slate-400 inline-flex items-center gap-1">
                <Loader2 size={11} className="animate-spin" /> {counts.ingesting} ingesting
              </span>
            )}
          </span>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        {filterButtons.map(({ key, label }) => (
          <button
            key={key}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === key
                ? 'bg-brand-600 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-sm text-slate-400 self-center">
          {candidates.length} candidates
        </span>
      </div>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-brand-500" />
        </div>
      )}

      {!isLoading && candidates.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          No {filter === 'all' ? '' : filter}ed candidates yet.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {candidates.map((c) => (
          <CandidateCard
            key={c.id}
            candidate={c}
            variant="grid"
            onClick={() => setSelected(c)}
          />
        ))}
      </div>
    </div>
  )
}
