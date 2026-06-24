import { MapPin, Clock, Briefcase, AlertTriangle, Navigation, Mail, Phone } from 'lucide-react'
import type { Candidate } from '../types'
import ScoreChip from './ScoreChip'
import { formatFlag } from '../utils/format'

interface CandidateCardProps {
  candidate: Candidate
  /** If true, renders as a full swipe card; otherwise renders as a compact grid card */
  variant?: 'swipe' | 'grid'
  onClick?: () => void
}

export default function CandidateCard({
  candidate: c,
  variant = 'grid',
  onClick,
}: CandidateCardProps) {
  const flags = Array.isArray(c.flagsJson) ? (c.flagsJson as string[]) : []
  const jobs = Array.isArray(c.jobsJson) ? c.jobsJson : []
  const skills = Array.isArray(c.skillsJson) ? (c.skillsJson as string[]) : []
  const firstJob = jobs[0] as { role?: string; employer?: string; start?: string; end?: string } | undefined

  if (variant === 'swipe') {
    const visibleJobs = jobs.slice(0, 3)
    const extraJobs = jobs.length - visibleJobs.length

    return (
      <div
        className="card p-8 w-full max-w-lg select-none"
        style={{ touchAction: 'none' }}
      >
        {/* Header — name + scores */}
        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{c.name ?? 'Unknown'}</h2>

            {/* Location + distance */}
            <div className="flex items-center flex-wrap gap-3 mt-1">
              {c.location && (
                <p className="text-sm text-slate-500 flex items-center gap-1">
                  <MapPin size={13} /> {c.location}
                </p>
              )}
              {c.distanceMi != null && (
                <p className="text-sm text-slate-400 flex items-center gap-1">
                  <Navigation size={13} /> {c.distanceMi} mi away
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1 items-end shrink-0 ml-3">
            <ScoreChip label="Match" value={c.matchScore} />
            <ScoreChip label="Willing" value={c.willingScore} />
          </div>
        </div>

        {/* Contact */}
        {(c.email || c.phone) && (
          <div className="flex items-center flex-wrap gap-4 mb-3 text-xs text-slate-400">
            {c.email && (
              <span className="flex items-center gap-1">
                <Mail size={11} /> {c.email}
              </span>
            )}
            {c.phone && (
              <span className="flex items-center gap-1">
                <Phone size={11} /> {c.phone}
              </span>
            )}
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-slate-100 mb-3" />

        {/* AI Summary */}
        {c.aiSummary && (
          <p className="text-sm text-slate-700 italic mb-4 leading-relaxed">
            "{c.aiSummary}"
          </p>
        )}

        {/* Job history — up to 3 entries */}
        {visibleJobs.length > 0 && (
          <div className="flex flex-col gap-2 mb-3">
            {visibleJobs.map((job, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-slate-600">
                <Briefcase size={14} className="shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium">{job.role}</span>
                  <span className="text-slate-400"> @ {job.employer}</span>
                  {job.start && (
                    <span className="text-slate-400 ml-1 text-xs">
                      ({job.start}–{job.end ?? 'present'})
                    </span>
                  )}
                  {job.detail && (
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{job.detail}</p>
                  )}
                </div>
              </div>
            ))}
            {extraJobs > 0 && (
              <p className="text-xs text-slate-400 ml-5">+{extraJobs} more role{extraJobs > 1 ? 's' : ''}</p>
            )}
          </div>
        )}

        {/* Resume activity */}
        {c.resumeLastActive && (
          <div className="flex items-center gap-1.5 text-sm text-slate-400 mb-3">
            <Clock size={13} className="shrink-0" />
            <span>Active {c.resumeLastActive}</span>
          </div>
        )}

        {/* Skills */}
        {skills.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {skills.slice(0, 8).map((s, i) => (
              <span key={i} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">
                {s}
              </span>
            ))}
            {skills.length > 8 && (
              <span className="px-2 py-0.5 bg-slate-100 text-slate-400 rounded text-xs">
                +{skills.length - 8}
              </span>
            )}
          </div>
        )}

        {/* Flags */}
        {flags.length > 0 && (
          <div className="flex flex-col gap-1.5 mt-1">
            {flags.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded">
                <AlertTriangle size={11} className="shrink-0" />
                {formatFlag(f)}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Grid variant
  return (
    <div
      className="card p-4 cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="font-semibold text-slate-900">{c.name ?? 'Unknown'}</h3>
          {c.location && (
            <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
              <MapPin size={10} /> {c.location}
            </p>
          )}
        </div>
        <div className="flex gap-1">
          <ScoreChip label="M" value={c.matchScore} size="sm" />
          <ScoreChip label="W" value={c.willingScore} size="sm" />
        </div>
      </div>
      {c.aiSummary && (
        <p className="text-xs text-slate-600 line-clamp-2 italic">"{c.aiSummary}"</p>
      )}
      {firstJob && (
        <p className="text-xs text-slate-500 mt-1">
          {firstJob.role} @ {firstJob.employer}
        </p>
      )}
      {flags.length > 0 && (
        <div className="flex items-center gap-1 mt-2 text-xs text-amber-600">
          <AlertTriangle size={11} />
          {formatFlag(flags[0])}
          {flags.length > 1 && ` +${flags.length - 1}`}
        </div>
      )}
    </div>
  )
}
