import { useState } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { ChevronLeft, Mail, Phone, MapPin, Send, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../api/client'
import type { Candidate } from '../types'
import { formatFlag } from '../utils/format'
import ScoreChip from '../components/ScoreChip'
import PdfViewer from '../components/PdfViewer'

interface Props {
  candidate: Candidate
  jobId: string
  onBack: () => void
}

export default function CandidateDetail({ candidate: c, jobId, onBack }: Props) {
  const qc = useQueryClient()
  const [outreachDraft, setOutreachDraft] = useState<{ id: string; draft: string } | null>(null)
  const [editedDraft, setEditedDraft] = useState('')

  const { data: outreachHistory = [] } = useQuery({
    queryKey: ['outreach', c.id],
    queryFn: () => api.outreach.history(c.id),
  })

  const draftMutation = useMutation({
    mutationFn: () => api.outreach.draft({ candidateId: c.id, jobId }),
    onSuccess: (data) => {
      setOutreachDraft({ id: data.id, draft: data.draft ?? '' })
      setEditedDraft(data.draft ?? '')
    },
    onError: () => toast.error('Failed to generate draft'),
  })

  const sendMutation = useMutation({
    mutationFn: () => api.outreach.send(outreachDraft!.id),
    onSuccess: () => {
      toast.success('Marked as sent ✓')
      qc.invalidateQueries({ queryKey: ['outreach', c.id] })
      setOutreachDraft(null)
      // Auto-log to ATS
      api.ats.log({ candidateId: c.id, jobId, stage: 'submitted', notes: c.aiSummary ?? undefined })
    },
  })

  const updateDraftMutation = useMutation({
    mutationFn: (draft: string) => api.outreach.update(outreachDraft!.id, draft),
    onSuccess: (data) => {
      setOutreachDraft((d) => d ? { ...d, draft: data.draft ?? '' } : null)
      toast.success('Draft saved')
    },
  })

  const jobs = Array.isArray(c.jobsJson) ? c.jobsJson : []
  const skills = Array.isArray(c.skillsJson) ? (c.skillsJson as string[]) : []
  const flags = Array.isArray(c.flagsJson) ? (c.flagsJson as string[]) : []

  return (
    <div className="max-w-2xl mx-auto">
      <button className="btn-secondary mb-6" onClick={onBack}>
        <ChevronLeft size={16} /> Back
      </button>

      <div className="card p-6 mb-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">{c.name ?? 'Unknown'}</h1>
            <div className="flex flex-wrap gap-3 mt-1 text-sm text-slate-500">
              {c.location && <span className="flex items-center gap-1"><MapPin size={13} />{c.location}</span>}
              {c.email && <span className="flex items-center gap-1"><Mail size={13} />{c.email}</span>}
              {c.phone && <span className="flex items-center gap-1"><Phone size={13} />{c.phone}</span>}
            </div>
          </div>
          <div className="flex flex-col gap-1 items-end">
            <ScoreChip label="Match" value={c.matchScore} />
            <ScoreChip label="Willing" value={c.willingScore} />
          </div>
        </div>

        {/* AI Summary */}
        {c.aiSummary && (
          <div className="bg-brand-50 border border-brand-100 rounded-lg p-3 mb-4 text-sm italic text-brand-800">
            {c.aiSummary}
          </div>
        )}

        {/* Flags */}
        {flags.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Risk Flags</h3>
            <div className="flex flex-col gap-1">
              {flags.map((f, i) => (
                <div key={i} className="text-sm text-amber-700 bg-amber-50 px-2 py-1 rounded">
                  ⚠ {formatFlag(f)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Job History */}
        {jobs.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Work History</h3>
            <div className="space-y-2">
              {(jobs as Array<{ role?: string; employer?: string; start?: string; end?: string; detail?: string }>).map((j, i) => (
                <div key={i} className="border-l-2 border-slate-200 pl-3">
                  <p className="font-medium text-sm">{j.role}</p>
                  <p className="text-xs text-slate-500">
                    {j.employer}{j.start && ` · ${j.start}–${j.end ?? 'present'}`}
                  </p>
                  {j.detail && <p className="text-xs text-slate-400 mt-0.5">{j.detail}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Skills */}
        {skills.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Skills</h3>
            <div className="flex flex-wrap gap-1.5">
              {skills.map((s, i) => (
                <span key={i} className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* PDF */}
        {c.pdfKey && (
          <div className="mt-4">
            <PdfViewer candidateId={c.id} />
          </div>
        )}
      </div>

      {/* Outreach panel */}
      <div className="card p-6 mb-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Send size={16} /> Outreach
        </h2>

        {outreachHistory.length > 0 && (
          <div className="mb-4 space-y-2">
            {outreachHistory.map((o) => (
              <div key={o.id} className="bg-slate-50 rounded-lg p-3 text-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-500 uppercase">{o.channel}</span>
                  {o.sentAt ? (
                    <span className="text-xs text-emerald-600">Sent {new Date(o.sentAt).toLocaleDateString()}</span>
                  ) : (
                    <span className="text-xs text-slate-400">Draft</span>
                  )}
                </div>
                <p className="text-slate-700">{o.draft}</p>
              </div>
            ))}
          </div>
        )}

        {!outreachDraft ? (
          <button
            className="btn-primary"
            onClick={() => draftMutation.mutate()}
            disabled={draftMutation.isPending}
          >
            {draftMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            Generate Outreach Draft
          </button>
        ) : (
          <div className="space-y-3">
            <textarea
              className="input"
              rows={5}
              value={editedDraft}
              onChange={(e) => setEditedDraft(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                className="btn-secondary flex-1"
                onClick={() => updateDraftMutation.mutate(editedDraft)}
                disabled={updateDraftMutation.isPending}
              >
                Save Edit
              </button>
              <button
                className="btn-primary flex-1"
                onClick={() => sendMutation.mutate()}
                disabled={sendMutation.isPending}
              >
                {sendMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Looks good, send →
              </button>
            </div>
            <p className="text-xs text-slate-400">
              This marks the outreach as sent — you still need to paste it into Indeed/LinkedIn manually.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
