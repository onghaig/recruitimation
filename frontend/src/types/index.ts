export interface Job {
  id: string
  title: string
  description: string
  location?: string | null
  payRange?: string | null
  platform?: string | null
  platformId?: string | null
  status: string
  createdAt: string
}

export interface JobEntry {
  role: string
  employer: string
  start?: string | null
  end?: string | null
  detail?: string | null
}

export interface Candidate {
  id: string
  jobId?: string | null
  source?: string | null
  sourceId?: string | null
  name?: string | null
  email?: string | null
  phone?: string | null
  location?: string | null
  distanceMi?: number | null
  resumeLastActive?: string | null
  rawText?: string | null
  jobsJson?: JobEntry[] | null
  skillsJson?: string[] | null
  pdfKey?: string | null
  matchScore?: number | null
  willingScore?: number | null
  aiSummary?: string | null
  flagsJson?: string[] | null
  scoredAt?: string | null
  createdAt: string
  decisions?: Decision[]
}

export interface Decision {
  id: string
  candidateId: string
  jobId: string
  decision: 'keep' | 'pin' | 'skip'
  pinNote?: string | null
  pinRemind?: string | null
  decidedAt: string
}

export interface Outreach {
  id: string
  candidateId: string
  jobId: string
  channel?: string | null
  draft?: string | null
  sentAt?: string | null
  response?: string | null
  credited: boolean
}

export interface AtsLog {
  id: string
  candidateId: string
  jobId: string
  atsId?: string | null
  stage: string
  loggedAt: string
  notes?: string | null
}

export interface ParseResult {
  candidateId?: string
  jobId?: string
  jobCreated?: boolean
  parsed: {
    name: string | null
    email: string | null
    phone: string | null
    location: string | null
    jobs: JobEntry[]
    skills: string[]
  }
  matchScore: number
  willingScore: number
  flags: string[]
  reasoning: string
  aiSummary: string
}
