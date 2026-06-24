/**
 * Drop-in replacement for client.ts that returns mock data.
 * Active when VITE_API_URL is not set (i.e. no backend running).
 */
import type { Job, Candidate, Decision, Outreach, ParseResult } from '../types'
import {
  MOCK_JOBS,
  MOCK_CANDIDATES,
  MOCK_DECISIONS,
  MOCK_OUTREACH,
  MOCK_ATS_LOGS,
  MOCK_PARSE_RESULT,
} from './mockData'

// Mutable in-memory state so swipes/decisions persist within a session
let jobs = [...MOCK_JOBS]
let candidates = [...MOCK_CANDIDATES]
let decisions = [...MOCK_DECISIONS]
let outreach = [...MOCK_OUTREACH]
const atsLogs = [...MOCK_ATS_LOGS]

const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms))

export const api = {
  jobs: {
    list: async (): Promise<Job[]> => {
      await delay()
      return jobs
    },
    get: async (id: string): Promise<Job> => {
      await delay()
      const j = jobs.find((j) => j.id === id)
      if (!j) throw new Error('Job not found')
      return j
    },
    create: async (data: Partial<Job>): Promise<Job> => {
      await delay()
      const j: Job = {
        id: `job-${Date.now()}`,
        title: data.title ?? 'Untitled',
        description: data.description ?? '',
        location: data.location ?? null,
        payRange: data.payRange ?? null,
        platform: data.platform ?? null,
        platformId: data.platformId ?? null,
        status: 'open',
        createdAt: new Date().toISOString(),
      }
      jobs = [...jobs, j]
      return j
    },
    update: async (id: string, data: Partial<Job>): Promise<Job> => {
      await delay()
      jobs = jobs.map((j) => (j.id === id ? { ...j, ...data } : j))
      return jobs.find((j) => j.id === id)!
    },
    delete: async (id: string): Promise<void> => {
      await delay()
      jobs = jobs.filter((j) => j.id !== id)
    },
    candidates: async (
      jobId: string,
      params?: { decision?: string; limit?: number },
    ): Promise<Candidate[]> => {
      await delay()
      let result = candidates.filter((c) => c.jobId === jobId)

      if (params?.decision === 'undecided') {
        const decidedIds = new Set(decisions.map((d) => d.candidateId))
        result = result.filter((c) => !decidedIds.has(c.id))
      } else if (params?.decision && params.decision !== 'all') {
        const matchIds = new Set(
          decisions.filter((d) => d.decision === params.decision).map((d) => d.candidateId),
        )
        result = result.filter((c) => matchIds.has(c.id))
      }

      // Attach decisions to each candidate
      result = result.map((c) => ({
        ...c,
        decisions: decisions.filter((d) => d.candidateId === c.id),
      }))

      // Sort by matchScore desc
      result.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))

      return params?.limit ? result.slice(0, params.limit) : result
    },
    candidatesCount: async (jobId: string) => {
      await delay()
      const forJob = candidates.filter((c) => c.jobId === jobId)
      const scoredList = forJob.filter((c) => c.scoredAt)
      const decidedIds = new Set(decisions.map((d) => d.candidateId))
      const reviewed = scoredList.filter((c) => decidedIds.has(c.id)).length
      return {
        total: forJob.length,
        scored: scoredList.length,
        ingesting: forJob.length - scoredList.length,
        reviewed,
        toReview: scoredList.length - reviewed,
      }
    },
  },

  candidates: {
    get: async (id: string): Promise<Candidate> => {
      await delay()
      const c = candidates.find((c) => c.id === id)
      if (!c) throw new Error('Candidate not found')
      return { ...c, decisions: decisions.filter((d) => d.candidateId === c.id) }
    },
    score: async (_id: string): Promise<{ queued: boolean }> => {
      await delay(600)
      return { queued: true }
    },
    pdfUrl: async (_id: string): Promise<{ url: string; expiresIn: number }> => {
      await delay()
      return { url: 'https://pdfobject.com/pdf/sample.pdf', expiresIn: 3600 }
    },
    uploadPdf: async (_id: string, _file: File): Promise<{ pdfKey: string }> => {
      await delay(800)
      return { pdfKey: `mock-pdf-${Date.now()}` }
    },
    decide: async (
      candidateId: string,
      data: { decision: 'keep' | 'pin' | 'skip'; jobId: string; pinNote?: string; pinRemind?: string },
    ): Promise<Decision> => {
      await delay()
      // Remove any previous decision for this candidate+job
      decisions = decisions.filter(
        (d) => !(d.candidateId === candidateId && d.jobId === data.jobId),
      )
      const d: Decision = {
        id: `dec-${Date.now()}`,
        candidateId,
        jobId: data.jobId,
        decision: data.decision,
        pinNote: data.pinNote ?? null,
        pinRemind: data.pinRemind ?? null,
        decidedAt: new Date().toISOString(),
      }
      decisions = [...decisions, d]
      return d
    },
    parse: async (_data: unknown): Promise<ParseResult> => {
      await delay(1200)
      return MOCK_PARSE_RESULT
    },
    ingest: async (data: {
      candidates: Array<unknown>
    }): Promise<{ ingested: number; results: Array<{ id: string; status: string }> }> => {
      await delay(800)
      return {
        ingested: data.candidates.length,
        results: data.candidates.map((_, i) => ({ id: `mock-${Date.now()}-${i}`, status: 'created' })),
      }
    },
  },

  outreach: {
    draft: async (data: { candidateId: string; jobId: string; channel?: string }): Promise<Outreach> => {
      await delay(800)
      const candidate = candidates.find((c) => c.id === data.candidateId)
      const job = jobs.find((j) => j.id === data.jobId)
      const o: Outreach = {
        id: `out-${Date.now()}`,
        candidateId: data.candidateId,
        jobId: data.jobId,
        channel: data.channel ?? 'indeed_message',
        draft: `Hi ${candidate?.name?.split(' ')[0] ?? 'there'}, I came across your profile and think you'd be a great fit for our ${job?.title ?? 'open role'} in ${job?.location ?? 'the area'} — ${job?.payRange ?? 'competitive pay'}. Would you be open to a quick chat this week?`,
        sentAt: null,
        response: null,
        credited: false,
      }
      outreach = [...outreach, o]
      return o
    },
    send: async (outreachId: string): Promise<Outreach> => {
      await delay()
      outreach = outreach.map((o) =>
        o.id === outreachId ? { ...o, sentAt: new Date().toISOString(), credited: true } : o,
      )
      return outreach.find((o) => o.id === outreachId)!
    },
    update: async (id: string, draft: string): Promise<Outreach> => {
      await delay()
      outreach = outreach.map((o) => (o.id === id ? { ...o, draft } : o))
      return outreach.find((o) => o.id === id)!
    },
    history: async (candidateId: string): Promise<Outreach[]> => {
      await delay()
      return outreach.filter((o) => o.candidateId === candidateId)
    },
  },

  ats: {
    log: async (data: { candidateId: string; jobId: string; stage: string; notes?: string }) => {
      await delay()
      return {
        id: `ats-${Date.now()}`,
        ...data,
        atsId: null,
        loggedAt: new Date().toISOString(),
      }
    },
    pcf: async (data: { candidateId: string; jobId: string; hireDate: string; clientName: string }) => {
      await delay()
      return {
        id: `ats-pcf-${Date.now()}`,
        ...data,
        stage: 'pcf_created',
        loggedAt: new Date().toISOString(),
      }
    },
    history: async (candidateId: string) => {
      await delay()
      return atsLogs.filter((a) => a.candidateId === candidateId)
    },
    exportCsv: () => {
      console.info('[mock] CSV export — no-op in mock mode')
    },
  },
}
