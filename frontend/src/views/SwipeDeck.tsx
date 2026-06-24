import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion'
import { ThumbsUp, Bookmark, X, ChevronLeft, Loader2, CheckSquare } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../api/client'
import type { Job, Candidate } from '../types'
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

interface CardDragProps {
  candidate: Candidate
  onKeep: () => void
  onPin: () => void
  onSkip: () => void
}

function DraggableCard({ candidate, onKeep, onPin, onSkip }: CardDragProps) {
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-200, 200], [-15, 15])
  const keepOpacity = useTransform(x, [30, 100], [0, 1])
  const skipOpacity = useTransform(x, [-100, -30], [1, 0])

  const handleDragEnd = (_: unknown, info: { offset: { x: number } }) => {
    if (info.offset.x > 100) onKeep()
    else if (info.offset.x < -100) onSkip()
    else x.set(0)
  }

  return (
    <motion.div
      style={{ x, rotate }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.9}
      onDragEnd={handleDragEnd}
      className="relative z-10 cursor-grab active:cursor-grabbing"
    >
      {/* Keep indicator */}
      <motion.div
        style={{ opacity: keepOpacity }}
        className="absolute top-6 left-6 bg-emerald-500 text-white text-lg font-bold px-3 py-1 rounded-lg rotate-[-15deg] z-10 pointer-events-none"
      >
        KEEP ✓
      </motion.div>
      {/* Skip indicator */}
      <motion.div
        style={{ opacity: skipOpacity }}
        className="absolute top-6 right-6 bg-red-500 text-white text-lg font-bold px-3 py-1 rounded-lg rotate-[15deg] z-10 pointer-events-none"
      >
        SKIP ✗
      </motion.div>
      <CandidateCard candidate={candidate} variant="swipe" />
    </motion.div>
  )
}

export default function SwipeDeck() {
  const { jobId: routeJobId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [jobId, setJobId] = useState<string | null>(routeJobId ?? null)
  const [index, setIndex] = useState(0)
  const [pinModal, setPinModal] = useState<{ candidate: Candidate } | null>(null)
  const [pinNote, setPinNote] = useState('')
  const [showPdf, setShowPdf] = useState(false)

  useEffect(() => {
    if (routeJobId) setJobId(routeJobId)
  }, [routeJobId])

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs'],
    queryFn: api.jobs.list,
  })

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['candidates', jobId, 'undecided'],
    queryFn: () => api.jobs.candidates(jobId!, { decision: 'undecided', limit: 100 }),
    enabled: !!jobId,
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
    }) =>
      api.candidates.decide(candidateId, {
        decision,
        jobId: jobId!,
        pinNote,
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['candidates'] })
      const label = vars.decision === 'keep' ? '✅ Kept' : vars.decision === 'pin' ? '📌 Pinned' : '⏭ Skipped'
      toast.success(label, { duration: 1200 })
      setIndex((i) => i + 1)
      setShowPdf(false)
      setPinModal(null)
    },
  })

  const current = candidates[index]

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
        <div className="w-24" />
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-sm mb-6 bg-slate-200 rounded-full h-1.5">
        <div
          className="bg-brand-500 h-1.5 rounded-full transition-all"
          style={{ width: `${((index) / Math.max(candidates.length, 1)) * 100}%` }}
        />
      </div>

      {/* Card stack */}
      <div className="relative w-full max-w-lg mb-6">
        {/* Ghost cards underneath */}
        {candidates[index + 1] && (
          <div className="absolute inset-0 scale-95 translate-y-2 opacity-40 pointer-events-none">
            <CandidateCard candidate={candidates[index + 1]} variant="swipe" />
          </div>
        )}
        <AnimatePresence mode="wait">
          <DraggableCard
            key={current.id}
            candidate={current}
            onKeep={() => decideMutation.mutate({ candidateId: current.id, decision: 'keep' })}
            onPin={() => setPinModal({ candidate: current })}
            onSkip={() => decideMutation.mutate({ candidateId: current.id, decision: 'skip' })}
          />
        </AnimatePresence>
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

      {/* Action buttons */}
      <div className="flex gap-4">
        <button
          className="flex flex-col items-center gap-1 p-4 rounded-2xl bg-red-100 hover:bg-red-200 text-red-600 transition-colors"
          onClick={() => decideMutation.mutate({ candidateId: current.id, decision: 'skip' })}
          disabled={decideMutation.isPending}
        >
          <X size={22} />
          <span className="text-xs font-medium">Skip</span>
        </button>
        <button
          className="flex flex-col items-center gap-1 p-4 rounded-2xl bg-blue-100 hover:bg-blue-200 text-blue-600 transition-colors"
          onClick={() => setPinModal({ candidate: current })}
          disabled={decideMutation.isPending}
        >
          <Bookmark size={22} />
          <span className="text-xs font-medium">Pin</span>
        </button>
        <button
          className="flex flex-col items-center gap-1 p-4 rounded-2xl bg-emerald-100 hover:bg-emerald-200 text-emerald-600 transition-colors"
          onClick={() => decideMutation.mutate({ candidateId: current.id, decision: 'keep' })}
          disabled={decideMutation.isPending}
        >
          <ThumbsUp size={22} />
          <span className="text-xs font-medium">Keep</span>
        </button>
      </div>

      {/* Pin modal */}
      {pinModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="card p-6 w-full max-w-md">
            <h3 className="font-semibold text-lg mb-2">
              Pin {pinModal.candidate.name}
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              Add a note or follow-up reminder (optional)
            </p>
            <textarea
              className="input mb-3"
              rows={3}
              placeholder="Notes about this candidate…"
              value={pinNote}
              onChange={(e) => setPinNote(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => { setPinModal(null); setPinNote('') }}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() =>
                  decideMutation.mutate({
                    candidateId: pinModal.candidate.id,
                    decision: 'pin',
                    pinNote: pinNote || undefined,
                  })
                }
              >
                <Bookmark size={14} />
                Pin
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
