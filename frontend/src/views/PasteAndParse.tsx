import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Zap, CheckCircle, Layers, Users, FileText, X, History, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../api/client'
import type { ParseResult } from '../types'
import type { FileExtract } from '../utils/extractText'
import ScoreChip from '../components/ScoreChip'
import DocumentDropzone from '../components/DocumentDropzone'
import { useIngestHistory, type IngestHistoryEntry } from '../hooks/useIngestHistory'
import { useCandidateCount } from '../hooks/useCandidateCount'
import { formatFlag } from '../utils/format'

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// One history row. Batch rows poll live job counts so progress resumes after a
// page refresh (jobId comes from localStorage).
function HistoryItem({ entry }: { entry: IngestHistoryEntry }) {
  const { data: counts } = useCandidateCount(entry.type === 'batch' ? entry.jobId : null)
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {entry.type === 'batch' ? (
            <Layers size={13} className="text-brand-500 shrink-0" />
          ) : (
            <FileText size={13} className="text-slate-400 shrink-0" />
          )}
          <span className="font-medium truncate">
            {entry.type === 'batch'
              ? `${entry.count} candidates → ${entry.jobTitle}`
              : `${entry.candidateName ?? 'Candidate'} → ${entry.jobTitle}`}
          </span>
        </div>
        {entry.type === 'batch' && counts && (
          <div className="mt-1">
            <div className="h-1.5 w-44 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-brand-500 transition-all"
                style={{ width: `${counts.scored ? Math.round((counts.scored / Math.max(counts.total, 1)) * 100) : 0}%` }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {counts.scored}/{counts.total} scored
              {counts.ingesting > 0 ? ` · ${counts.ingesting} ingesting` : ' · done'}
            </p>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {entry.type === 'single' && (
          <>
            <ScoreChip label="M" value={entry.matchScore ?? null} size="sm" />
            <ScoreChip label="W" value={entry.willingScore ?? null} size="sm" />
          </>
        )}
        <span className="text-xs text-slate-400">{timeAgo(entry.createdAt)}</span>
      </div>
    </div>
  )
}

export default function PasteAndParse() {
  const [rawText, setRawText] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [jobLocation, setJobLocation] = useState('')
  const [jobPayRange, setJobPayRange] = useState('')
  const [selectedJobId, setSelectedJobId] = useState('')
  const [result, setResult] = useState<ParseResult | null>(null)
  const [mode, setMode] = useState<'combine' | 'batch'>('combine')
  const [batchFiles, setBatchFiles] = useState<FileExtract[]>([])
  const { history, add: addHistory, clear: clearHistory } = useIngestHistory()

  const qc = useQueryClient()

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs'],
    queryFn: api.jobs.list,
  })

  const resolvedTitle = () => jobs.find((j) => j.id === selectedJobId)?.title ?? jobTitle

  const parseMutation = useMutation({
    mutationFn: async () => {
      const titleAtStart = resolvedTitle()
      const data = await api.candidates.parse({
        rawText,
        jobDescription: selectedJobId
          ? jobs.find((j) => j.id === selectedJobId)?.description ?? jobDescription
          : jobDescription,
        jobTitle: selectedJobId
          ? jobs.find((j) => j.id === selectedJobId)?.title ?? jobTitle
          : jobTitle,
        jobLocation: selectedJobId
          ? jobs.find((j) => j.id === selectedJobId)?.location ?? jobLocation
          : jobLocation,
        jobPayRange: selectedJobId
          ? jobs.find((j) => j.id === selectedJobId)?.payRange ?? jobPayRange
          : jobPayRange,
        jobId: selectedJobId || undefined,
      })
      // Record history here (not in onSuccess) so it persists to localStorage
      // even if the user navigates away before the parse finishes — the mutation
      // promise runs to completion regardless of whether the view is mounted.
      addHistory({
        type: 'single',
        jobId: data.jobId,
        jobTitle: titleAtStart,
        candidateName: data.parsed.name ?? 'Unknown',
        matchScore: data.matchScore,
        willingScore: data.willingScore,
      })
      return data
    },
    onSuccess: (data) => {
      setResult(data)
      // A new job was auto-created from the entered details — surface it in the
      // Jobs tab and select it so further parses reuse it (no duplicate jobs).
      if (data.jobCreated && data.jobId) {
        qc.invalidateQueries({ queryKey: ['jobs'] })
        setSelectedJobId(data.jobId)
      }
      toast.success(data.jobCreated ? 'Parsed, scored & job created!' : 'Parsed and scored!')
    },
    onError: (err) => toast.error(err.message),
  })

  const okBatchFiles = batchFiles.filter((f) => f.ok && f.text.trim())

  const ingestMutation = useMutation({
    mutationFn: () =>
      api.candidates.ingest({
        source: 'paste',
        job_id: selectedJobId,
        // Don't send the filename as the name — let the worker's parse extract
        // the real name from the résumé text (it only backfills when name is empty).
        candidates: okBatchFiles.map((f) => ({ raw_text: f.text })),
      }),
    onSuccess: (data) => {
      setBatchFiles([])
      addHistory({
        type: 'batch',
        jobId: selectedJobId,
        jobTitle: resolvedTitle(),
        count: data.ingested,
      })
      toast.success(`Queued ${data.ingested} candidate${data.ingested === 1 ? '' : 's'}`)
    },
    onError: (err) => toast.error(err.message),
  })

  const handleJobSelect = (id: string) => {
    setSelectedJobId(id)
    const j = jobs.find((j) => j.id === id)
    if (j) {
      setJobTitle(j.title)
      setJobDescription(j.description)
      setJobLocation(j.location ?? '')
      setJobPayRange(j.payRange ?? '')
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Paste & Parse</h1>
      <p className="text-slate-500 mb-8">
        Paste a candidate's profile text and validate AI scoring with real candidates before using the extension.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Left: Job */}
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold">Job Details</h2>

          {jobs.length > 0 && (
            <div>
              <label className="label">Load from existing job</label>
              <select
                className="input"
                value={selectedJobId}
                onChange={(e) => handleJobSelect(e.target.value)}
              >
                <option value="">— Enter manually —</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="label">Job Title *</label>
            <input
              className="input"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Assembly Technician"
            />
          </div>
          <div>
            <label className="label">Location</label>
            <input
              className="input"
              value={jobLocation}
              onChange={(e) => setJobLocation(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Pay Range</label>
            <input
              className="input"
              value={jobPayRange}
              onChange={(e) => setJobPayRange(e.target.value)}
              placeholder="e.g. $18–22/hr"
            />
          </div>
          <div>
            <label className="label">Job Description *</label>
            <textarea
              className="input"
              rows={5}
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste or type the full job description…"
            />
          </div>
        </div>

        {/* Right: Candidate */}
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Candidate Profile</h2>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setMode('combine')}
                className={`px-2.5 py-1 flex items-center gap-1 ${mode === 'combine' ? 'bg-brand-50 text-brand-700' : 'text-slate-500'}`}
              >
                <FileText size={12} /> One candidate
              </button>
              <button
                type="button"
                onClick={() => setMode('batch')}
                className={`px-2.5 py-1 flex items-center gap-1 border-l border-slate-200 ${mode === 'batch' ? 'bg-brand-50 text-brand-700' : 'text-slate-500'}`}
              >
                <Layers size={12} /> Batch
              </button>
            </div>
          </div>

          {mode === 'combine' ? (
            <>
              <div>
                <label className="label">Upload documents</label>
                <DocumentDropzone
                  mode="combine"
                  onCombined={(text) =>
                    setRawText((prev) => (prev.trim() ? `${prev}\n\n${text}` : text))
                  }
                />
              </div>

              <div>
                <label className="label">Raw Profile Text *</label>
                <textarea
                  className="input"
                  rows={14}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="Drop files above, or paste the candidate's full profile text, resume, or LinkedIn copy here…"
                />
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-slate-500">
                Upload many files — each becomes its own candidate, queued and scored by the worker.
                Requires a saved job (select one on the left).
              </p>
              <DocumentDropzone
                mode="batch"
                onBatch={(results) => setBatchFiles((prev) => [...prev, ...results])}
              />
              {batchFiles.length > 0 && (
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-auto">
                  {batchFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <FileText size={12} className="shrink-0 text-slate-400" />
                        <span className="truncate">{f.name}</span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className={f.ok ? 'text-slate-400' : 'text-red-500'}>
                          {f.ok ? `${f.text.length} chars` : 'unreadable'}
                        </span>
                        <button
                          type="button"
                          className="text-slate-400 hover:text-slate-600"
                          onClick={() => setBatchFiles((prev) => prev.filter((_, j) => j !== i))}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {mode === 'combine' ? (
        <button
          className="btn-primary w-full text-base py-3 mb-8"
          disabled={parseMutation.isPending || !rawText || !jobTitle || !jobDescription}
          onClick={() => parseMutation.mutate()}
        >
          {parseMutation.isPending ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <Zap size={18} />
          )}
          {parseMutation.isPending ? 'Scoring…' : 'Parse & Score'}
        </button>
      ) : (
        <button
          className="btn-primary w-full text-base py-3 mb-8"
          disabled={ingestMutation.isPending || okBatchFiles.length === 0 || !selectedJobId}
          onClick={() => ingestMutation.mutate()}
        >
          {ingestMutation.isPending ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <Users size={18} />
          )}
          {ingestMutation.isPending
            ? 'Queuing…'
            : !selectedJobId
              ? 'Select a saved job to ingest'
              : `Ingest ${okBatchFiles.length} candidate${okBatchFiles.length === 1 ? '' : 's'}`}
        </button>
      )}

      {/* History — past parsing attempts, persisted across refresh/tabs */}
      {history.length > 0 && (
        <div className="card p-5 mb-8">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold flex items-center gap-2">
              <History size={16} /> History
            </h2>
            <button
              className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
              onClick={clearHistory}
            >
              <Trash2 size={12} /> Clear
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {history.map((entry) => (
              <HistoryItem key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="card p-6 space-y-6">
          <div className="flex items-center gap-3">
            <CheckCircle className="text-emerald-500" size={22} />
            <h2 className="font-bold text-xl">Scoring Complete</h2>
          </div>

          {/* Scores */}
          <div className="flex gap-3 flex-wrap">
            <ScoreChip label="Match" value={result.matchScore} />
            <ScoreChip label="Willing" value={result.willingScore} />
          </div>

          {/* Summary */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">AI Summary</h3>
            <p className="italic text-slate-700 text-sm">"{result.aiSummary}"</p>
          </div>

          {/* Reasoning */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Reasoning</h3>
            <p className="text-sm text-slate-600">{result.reasoning}</p>
          </div>

          {/* Flags */}
          {result.flags.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Flags</h3>
              <div className="flex flex-col gap-1">
                {result.flags.map((f, i) => (
                  <div key={i} className="text-sm text-amber-700 bg-amber-50 px-2 py-1 rounded">
                    ⚠ {formatFlag(f)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Parsed data */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Extracted Data</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-slate-400">Name: </span>{result.parsed.name ?? '—'}</div>
              <div><span className="text-slate-400">Email: </span>{result.parsed.email ?? '—'}</div>
              <div><span className="text-slate-400">Phone: </span>{result.parsed.phone ?? '—'}</div>
              <div><span className="text-slate-400">Location: </span>{result.parsed.location ?? '—'}</div>
            </div>
          </div>

          {/* Work history */}
          {result.parsed.jobs.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Work History</h3>
              <div className="space-y-1.5">
                {result.parsed.jobs.map((j, i) => (
                  <div key={i} className="text-sm border-l-2 border-slate-200 pl-3">
                    <span className="font-medium">{j.role}</span>
                    <span className="text-slate-500"> @ {j.employer}</span>
                    {j.start && <span className="text-slate-400"> · {j.start}–{j.end ?? 'present'}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Skills */}
          {result.parsed.skills.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Skills</h3>
              <div className="flex flex-wrap gap-1.5">
                {result.parsed.skills.map((s, i) => (
                  <span key={i} className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {result.candidateId && (
            <p className="text-xs text-slate-400">
              Saved as candidate ID: {result.candidateId}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
