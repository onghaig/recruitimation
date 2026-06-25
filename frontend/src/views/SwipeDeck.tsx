import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ThumbsUp, Bookmark, X, ChevronLeft, Loader2, CheckSquare, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../api/client'
import type { Job } from '../types'
import CandidateCard from '../components/CandidateCard'
import PdfViewer from '../components/PdfViewer'
import { useCandidateCount } from '../hooks/useCandidateCount'

function JobPicker({ jobs, onSelect }: { jobs: Job[]; onSelect: (id: string) => void }) {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Select a Job to Review</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {jobs.map((j) => (
          <button
            key={j.id}
            className="card p-5 text-left hover:shadow-md transition-shadow"
            onClick={() => onSelect(j.id)}
          >
            <h3 className="font-semibold">{j.title}</h3>
            <p className="text-sm text-slate-500">{[j.location, j.payRange].filter(Boolean).join(' · ')}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function SwipeDeck() {
  const { jobId: routeJobId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [jobId, setJobId] = useState<string | null>(routeJobId ?? null)
  const [index, setIndex] = useState(0)
  const [comment, setComment] = useState('')
  const [showPdf, setShowPdf] = useState(false)

  useEffect(() => {
    if (routeJobId) setJobId(routeJobId)
  }, [routeJobId])

  // Start at the first candidate whenever the job changes.
  useEffect(() => {
    setIndex(0)
  }, [jobId])

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs'],
    queryFn: api.jobs.list,
  })

  // Stable session snapshot: decisions are optimistic and we don't refetch per
  // decision, so a mid-session refetch must not reshuffle the list under `index`.
  // It still refetches fresh on mount / job change.
  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['candidates', jobId, 'undecided'],
    queryFn: () => api.jobs.candidates(jobId!, { decision: 'undecided', limit: 100 }),
    enabled: !!jobId,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  })

  const { data: counts } = useCandidateCount(jobId)

  const decideMutation = useMutation({
    mutationFn: ({
      candidateId,
      decision,
      pinNote,
    }: {
      candidateId: string
      decision: 'keep' | 'pin' | 'skip'
      pinNote?: string
    }) => api.candidates.decide(candidateId, { decision, jobId: jobId!, pinNote }),
    onError: () => toast.error('Failed to save — use undo and retry'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['candidateCount', jobId] }),
  })

  const undoMutation = useMutation({
    mutationFn: (candidateId: string) => api.candidates.undecide(candidateId, jobId!),
    onSettled: () => qc.invalidateQueries({ queryKey: ['candidateCount', jobId] }),
  })

  const current = candidates[index]

  // Decide on the current candidate (optionally with a comment) and advance.
  const decide = (decision: 'keep' | 'pin' | 'skip') => {
    if (!current) return
    decideMutation.mutate({
      candidateId: current.id,
      decision,
      pinNote: comment.trim() || undefined,
    })
    const label = decision === 'keep' ? '✅ Liked' : decision === 'pin' ? '📌 Pinned' : '⏭ Disliked'
    toast.success(label, { duration: 1000 })
    setIndex((i) => i + 1)
    setComment('')
    setShowPdf(false)
  }

  const undo = () => {
    if (index === 0) return
    const prev = candidates[index - 1]
    setIndex((i) => i - 1)
    setComment('')
    setShowPdf(false)
    if (prev) undoMutation.mutate(prev.id)
    toast('Undone', { icon: '↩️', duration: 1000 })
  }

  // Arrow-key review: ← Dislike, ↓ Pin, → Like. Ignored while typing a comment.
  // No deps array so the handler always sees the latest candidate + comment.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (!current) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        decide('skip')
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        decide('keep')
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        decide('pin')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!jobId) {
    return <JobPicker jobs={jobs} onSelect={(id) => { setJobId(id); navigate(`/swipe/${id}`) }} />
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3">
        <Loader2 className="animate-spin text-brand-500" size={32} />
        <p className="text-slate-500">Loading candidates…</p>
      </div>
    )
  }

  if (!current) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4 text-center">
        <CheckSquare size={48} className="text-emerald-400" />
        <h2 className="text-2xl font-bold">All reviewed!</h2>
        <p className="text-slate-500">No more undecided candidates for this job.</p>
        <button className="btn-primary" onClick={() => navigate('/results')}>
          View Results
        </button>
      </div>
    )
  }

  const selectedJob = jobs.find((j) => j.id === jobId)

  return (
    <div className="flex flex-col items-center">
      {/* Job header */}
      <div className="w-full flex items-center justify-between mb-6">
        <button className="btn-secondary" onClick={() => navigate('/jobs')}>
          <ChevronLeft size={16} /> Jobs
        </button>
        <div className="text-center">
          <h1 className="font-bold text-lg">{selectedJob?.title}</h1>
          <p className="text-sm text-slate-500">
            {index + 1} / {candidates.length} to review
            {counts ? ` · ${counts.scored} total` : ''}
          </p>
          {counts && counts.ingesting > 0 && (
            <p className="text-xs text-slate-400 flex items-center justify-center gap-1 mt-0.5">
              <Loader2 size={10} className="animate-spin" /> {counts.ingesting} still ingesting
            </p>
          )}
        </div>
        <button
          className="btn-secondary text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={undo}
          disabled={index === 0}
          title="Undo last decision"
        >
          <RotateCcw size={14} /> Undo
        </button>
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-sm mb-6 bg-slate-200 rounded-full h-1.5">
        <div
          className="bg-brand-500 h-1.5 rounded-full transition-all"
          style={{ width: `${(index / Math.max(candidates.length, 1)) * 100}%` }}
        />
      </div>

      {/* Candidate card */}
      <div className="w-full max-w-lg mb-4">
        <CandidateCard candidate={current} variant="swipe" />
      </div>

      {/* PDF viewer toggle */}
      {current.pdfKey && (
        <div className="w-full max-w-lg mb-4">
          {showPdf ? (
            <PdfViewer candidateId={current.id} />
          ) : (
            <button className="btn-secondary text-sm w-full" onClick={() => setShowPdf(true)}>
              View Resume PDF
            </button>
          )}
        </div>
      )}

      {/* Optional comment */}
      <div className="w-full max-w-lg mb-4">
        <textarea
          className="input"
          rows={2}
          placeholder="Optional comment (saved with your decision)…"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>

      {/* Action buttons */}
      <div className="flex gap-4">
        <button
          className="flex flex-col items-center gap-1 p-4 rounded-2xl bg-red-100 hover:bg-red-200 text-red-600 transition-colors"
          onClick={() => decide('skip')}
        >
          <X size={22} />
          <span className="text-xs font-medium">Dislike</span>
          <span className="text-[10px] text-red-400">←</span>
        </button>
        <button
          className="flex flex-col items-center gap-1 p-4 rounded-2xl bg-blue-100 hover:bg-blue-200 text-blue-600 transition-colors"
          onClick={() => decide('pin')}
        >
          <Bookmark size={22} />
          <span className="text-xs font-medium">Pin</span>
          <span className="text-[10px] text-blue-400">↓</span>
        </button>
        <button
          className="flex flex-col items-center gap-1 p-4 rounded-2xl bg-emerald-100 hover:bg-emerald-200 text-emerald-600 transition-colors"
          onClick={() => decide('keep')}
        >
          <ThumbsUp size={22} />
          <span className="text-xs font-medium">Like</span>
          <span className="text-[10px] text-emerald-400">→</span>
        </button>
      </div>

      <p className="text-xs text-slate-400 mt-4">← Dislike · ↓ Pin · → Like</p>
    </div>
  )
}
