import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, Zap, CheckCircle, Layers, Users, FileText, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../api/client'
import type { ParseResult } from '../types'
import type { FileExtract } from '../utils/extractText'
import ScoreChip from '../components/ScoreChip'
import DocumentDropzone from '../components/DocumentDropzone'

function fileBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, '')
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
  const [batchJobId, setBatchJobId] = useState<string | null>(null)

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs'],
    queryFn: api.jobs.list,
  })

  const parseMutation = useMutation({
    mutationFn: () =>
      api.candidates.parse({
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
      }),
    onSuccess: (data) => {
      setResult(data)
      toast.success('Parsed and scored!')
    },
    onError: (err) => toast.error(err.message),
  })

  const okBatchFiles = batchFiles.filter((f) => f.ok && f.text.trim())

  const ingestMutation = useMutation({
    mutationFn: () =>
      api.candidates.ingest({
        source: 'paste',
        job_id: selectedJobId,
        candidates: okBatchFiles.map((f) => ({ raw_text: f.text, name: fileBaseName(f.name) })),
      }),
    onSuccess: (data) => {
      setBatchJobId(selectedJobId)
      setBatchFiles([])
      toast.success(`Queued ${data.ingested} candidate${data.ingested === 1 ? '' : 's'}`)
    },
    onError: (err) => toast.error(err.message),
  })

  // Poll the job's candidates so the recruiter can watch the queue drain.
  const { data: progressCandidates = [] } = useQuery({
    queryKey: ['jobs', batchJobId, 'candidates'],
    queryFn: () => api.jobs.candidates(batchJobId as string),
    enabled: !!batchJobId,
    refetchInterval: 4000,
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

      {/* Batch queue progress */}
      {batchJobId && progressCandidates.length > 0 && (() => {
        const total = progressCandidates.length
        const scored = progressCandidates.filter((c) => c.scoredAt).length
        const pct = Math.round((scored / total) * 100)
        return (
          <div className="card p-6 mb-8 space-y-3">
            <div className="flex items-center gap-3">
              {scored < total ? (
                <Loader2 className="animate-spin text-brand-500" size={20} />
              ) : (
                <CheckCircle className="text-emerald-500" size={20} />
              )}
              <h2 className="font-bold">
                {scored < total ? 'Scoring in progress…' : 'All candidates scored'}
              </h2>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-sm text-slate-500">
              {scored} of {total} candidates scored for this job. They appear in the dashboard as they finish.
            </p>
          </div>
        )
      })()}

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
                    ⚠ {f}
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
