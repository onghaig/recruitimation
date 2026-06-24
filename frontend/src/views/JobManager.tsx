import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Pencil, Trash2, Zap, CheckCircle, PauseCircle, XCircle, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../api/client'
import type { Job } from '../types'
import { useCandidateCount } from '../hooks/useCandidateCount'

// Review button + live candidate counts for one job card.
function JobReviewButton({ jobId, onReview }: { jobId: string; onReview: () => void }) {
  const { data: c } = useCandidateCount(jobId)
  return (
    <div className="flex-1">
      <button className="btn-primary text-xs py-1.5 w-full" onClick={onReview}>
        <Zap size={13} /> Review Candidates
        {c && c.scored > 0 && (
          <span className="ml-1 opacity-90">{c.toReview}/{c.scored}</span>
        )}
      </button>
      {c && c.ingesting > 0 && (
        <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
          <Loader2 size={10} className="animate-spin" /> {c.ingesting} still ingesting
        </p>
      )}
    </div>
  )
}

const statusIcon: Record<string, React.ReactNode> = {
  open: <CheckCircle size={14} className="text-emerald-500" />,
  paused: <PauseCircle size={14} className="text-yellow-500" />,
  closed: <XCircle size={14} className="text-slate-400" />,
}

function JobForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<Job>
  onSave: (data: Partial<Job>) => void
  onCancel: () => void
  saving: boolean
}) {
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    location: initial?.location ?? '',
    payRange: initial?.payRange ?? '',
    platform: initial?.platform ?? '',
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSave(form)
      }}
      className="card p-6 space-y-4"
    >
      <h2 className="font-semibold text-lg">{initial?.id ? 'Edit Job' : 'New Job'}</h2>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Job Title *</label>
          <input
            className="input"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
          />
        </div>
        <div>
          <label className="label">Location</label>
          <input
            className="input"
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
          />
        </div>
        <div>
          <label className="label">Pay Range</label>
          <input
            className="input"
            placeholder="e.g. $18–22/hr"
            value={form.payRange}
            onChange={(e) => setForm((f) => ({ ...f, payRange: e.target.value }))}
          />
        </div>
        <div>
          <label className="label">Platform</label>
          <select
            className="input"
            value={form.platform}
            onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
          >
            <option value="">—</option>
            <option value="indeed">Indeed</option>
            <option value="linkedin">LinkedIn</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label">Job Description *</label>
        <textarea
          className="input"
          rows={6}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          required
        />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving && <Loader2 size={14} className="animate-spin" />}
          {initial?.id ? 'Save Changes' : 'Create Job'}
        </button>
      </div>
    </form>
  )
}

export default function JobManager() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Partial<Job> | null>(null)

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: api.jobs.list,
  })

  const createJob = useMutation({
    mutationFn: api.jobs.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] })
      setEditing(null)
      toast.success('Job created')
    },
  })

  const updateJob = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Job> }) => api.jobs.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] })
      setEditing(null)
      toast.success('Job updated')
    },
  })

  const deleteJob = useMutation({
    mutationFn: api.jobs.delete,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] })
      toast.success('Job deleted')
    },
  })

  const handleSave = (data: Partial<Job>) => {
    if (editing?.id) {
      updateJob.mutate({ id: editing.id, data })
    } else {
      createJob.mutate(data)
    }
  }

  if (editing !== null) {
    return (
      <JobForm
        initial={editing}
        onSave={handleSave}
        onCancel={() => setEditing(null)}
        saving={createJob.isPending || updateJob.isPending}
      />
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Jobs</h1>
        <button className="btn-primary" onClick={() => setEditing({})}>
          <Plus size={16} /> New Job
        </button>
      </div>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-brand-500" />
        </div>
      )}

      {!isLoading && jobs.length === 0 && (
        <div className="text-center py-20 text-slate-400">
          <Briefcase size={40} className="mx-auto mb-3 opacity-30" />
          <p>No jobs yet. Create one to get started.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {jobs.map((job) => (
          <div key={job.id} className="card p-5">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="flex items-center gap-2">
                  {statusIcon[job.status] ?? statusIcon.open}
                  <h2 className="font-semibold">{job.title}</h2>
                </div>
                <p className="text-sm text-slate-500 mt-0.5">
                  {[job.location, job.payRange].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="flex gap-1">
                <button
                  className="p-1.5 rounded hover:bg-slate-100"
                  onClick={() => setEditing(job)}
                >
                  <Pencil size={14} className="text-slate-500" />
                </button>
                <button
                  className="p-1.5 rounded hover:bg-red-50"
                  onClick={() => deleteJob.mutate(job.id)}
                >
                  <Trash2 size={14} className="text-red-400" />
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-500 line-clamp-2 mb-3">
              {job.description}
            </p>
            <div className="flex gap-2">
              <JobReviewButton jobId={job.id} onReview={() => navigate(`/swipe/${job.id}`)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// needed for default export reference above
function Briefcase({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  )
}
