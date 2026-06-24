import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, Zap, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../api/client'
import type { ParseResult } from '../types'
import { formatFlag } from '../utils/format'
import ScoreChip from '../components/ScoreChip'

export default function PasteAndParse() {
  const [rawText, setRawText] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [jobLocation, setJobLocation] = useState('')
  const [jobPayRange, setJobPayRange] = useState('')
  const [selectedJobId, setSelectedJobId] = useState('')
  const [result, setResult] = useState<ParseResult | null>(null)

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
          <h2 className="font-semibold">Candidate Profile</h2>
          <div>
            <label className="label">Raw Profile Text *</label>
            <textarea
              className="input"
              rows={14}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="Paste the candidate's full profile text, resume, or LinkedIn copy here…"
            />
          </div>
        </div>
      </div>

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
