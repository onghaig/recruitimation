import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion'
import { ThumbsUp, Bookmark, X, ChevronLeft, Loader2, CheckSquare, RotateCcw } from 'lucide-react'
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
  onDecide: (decision: 'keep' | 'skip') => void
}

function DraggableCard({ candidate, onDecide }: CardDragProps) {
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-200, 200], [-12, 12])
  const keepOpacity = useTransform(x, [40, 120], [0, 1])
  const skipOpacity = useTransform(x, [-120, -40], [1, 0])
  const [exitX, setExitX] = useState(0)
  // Lock so a single card can only be decided once (prevents double-swipe).
  const decided = useRef(false)

  const fling = (decision: 'keep' | 'skip') => {
    if (decided.current) return
    decided.current = true
    setExitX(decision === 'keep' ? 700 : -700)
    onDecide(decision)
  }

  const handleDragEnd = (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
    if (decided.current) return
    if (info.offset.x > 90 || info.velocity.x > 700) fling('keep')
    else if (info.offset.x < -90 || info.velocity.x < -700) fling('skip')
    // otherwise dragConstraints springs it back to center automatically
  }

  return (
    <motion.div
      style={{ x, rotate }}
      drag={decided.current ? false : 'x'}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.6}
      onDragEnd={handleDragEnd}
      initial={{ scale: 0.96, y: 10, opacity: 0.5 }}
      animate={{ scale: 1, y: 0, opacity: 1, transition: { type: 'spring', stiffness: 520, damping: 38 } }}
      exit={{ x: exitX, opacity: 0, scale: 0.92, transition: { duration: 0.18 } }}
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

  // Start at the first candidate whenever the job changes.
  useEffect(() => {
    setIndex(0)
  }, [jobId])

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs'],
    queryFn: api.jobs.list,
  })

  // Stable session snapshot: with optimistic swiping the deck advances locally,
  // so a mid-session refetch (e.g. window refocus) must not reshuffle the list
  // out from under `index`. It still refetches fresh on mount / job change.
  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['candidates', jobId, 'undecided'],
    queryFn: () => api.jobs.candidates(jobId!, { decision: 'undecided', limit: 100 }),
    enabled: !!jobId,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  })

  const { data: counts } = useCandidateCount(jobId)

  // Fire-and-forget so the UI never waits on the network. We advance the deck
  // optimistically; counts refresh on settle (the deck list itself stays stable
  // for the whole session so undo can step back through it).
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

  // Decide on the current card and advance immediately (optimistic).
  const decide = (decision: 'keep' | 'pin' | 'skip', pinNote?: string) => {
    if (!current) return
    decideMutation.mutate({ candidateId: current.id, decision, pinNote })
    const label = decision === 'keep' ? '✅ Kept' : decision === 'pin' ? '📌 Pinned' : '⏭ Skipped'
    toast.success(label, { duration: 1000 })
    setIndex((i) => i + 1)
    setShowPdf(false)
    setPinModal(null)
    setPinNote('')
  }

  // Step back to the previous candidate and clear its decision server-side.
  const undo = () => {
    if (index === 0) return
    const prev = candidates[index - 1]
    setIndex((i) => i - 1)
    setShowPdf(false)
    if (prev) undoMutation.mutate(prev.id)
    toast('Undone', { icon: '↩️', duration: 1000 })
  }

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
        <AnimatePresence initial={false}>
          <DraggableCard key={current.id} candidate={current} onDecide={(d) => decide(d)} />
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
          onClick={() => decide('skip')}
        >
          <X size={22} />
          <span className="text-xs font-medium">Skip</span>
        </button>
        <button
          className="flex flex-col items-center gap-1 p-4 rounded-2xl bg-blue-100 hover:bg-blue-200 text-blue-600 transition-colors"
          onClick={() => setPinModal({ candidate: current })}
        >
          <Bookmark size={22} />
          <span className="text-xs font-medium">Pin</span>
        </button>
        <button
          className="flex flex-col items-center gap-1 p-4 rounded-2xl bg-emerald-100 hover:bg-emerald-200 text-emerald-600 transition-colors"
          onClick={() => decide('keep')}
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
              <button className="btn-primary" onClick={() => decide('pin', pinNote || undefined)}>
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
