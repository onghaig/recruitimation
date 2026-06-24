import { X } from 'lucide-react'
import type { Candidate } from '../types'

/**
 * Shows the original source text the AI scored a candidate from — for
 * candidates with no clickable profile link (e.g. pasted/uploaded résumés).
 */
export default function CandidateContextModal({
  candidate,
  onClose,
}: {
  candidate: Candidate
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="card p-6 w-full max-w-lg max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold">Source context — {candidate.name ?? 'Candidate'}</h3>
          <button className="text-slate-400 hover:text-slate-600" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          The original input the AI scored this candidate from.
        </p>
        <pre className="text-xs whitespace-pre-wrap break-words text-slate-700 bg-slate-50 rounded-lg p-3">
          {candidate.rawText?.trim() || 'No source text available for this candidate.'}
        </pre>
      </div>
    </div>
  )
}
