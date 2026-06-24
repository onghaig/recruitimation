import type { Job, Candidate, Decision, Outreach, ParseResult } from '../types'

const BASE = import.meta.env.VITE_API_URL ?? ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? 'Request failed')
  }
  return res.json() as Promise<T>
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

export const api = {
  jobs: {
    list: () => request<Job[]>('/api/jobs'),
    get: (id: string) => request<Job>(`/api/jobs/${id}`),
    create: (data: Partial<Job>) =>
      request<Job>('/api/jobs', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Job>) =>
      request<Job>(`/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/api/jobs/${id}`, { method: 'DELETE' }),
    candidates: (id: string, params?: { decision?: string; limit?: number }) => {
      const qs = new URLSearchParams()
      if (params?.decision) qs.set('decision', params.decision)
      if (params?.limit) qs.set('limit', String(params.limit))
      return request<Candidate[]>(`/api/jobs/${id}/candidates?${qs}`)
    },
  },

  candidates: {
    get: (id: string) => request<Candidate>(`/api/candidates/${id}`),
    score: (id: string) =>
      request<{ queued: boolean }>(`/api/candidates/${id}/score`, { method: 'POST' }),
    pdfUrl: (id: string) =>
      request<{ url: string; expiresIn: number }>(`/api/candidates/${id}/pdf`),
    uploadPdf: async (id: string, file: File) => {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${BASE}/api/candidates/${id}/pdf`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) throw new Error('PDF upload failed')
      return res.json() as Promise<{ pdfKey: string }>
    },
    decide: (id: string, data: { decision: 'keep' | 'pin' | 'skip'; jobId: string; pinNote?: string; pinRemind?: string }) =>
      request<Decision>(`/api/candidates/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    parse: (data: {
      rawText: string
      jobDescription: string
      jobTitle: string
      jobLocation?: string
      jobPayRange?: string
      jobId?: string
    }) =>
      request<ParseResult>('/api/parse', { method: 'POST', body: JSON.stringify(data) }),
    ingest: (data: {
      source: 'indeed' | 'linkedin' | 'paste'
      job_id?: string
      platform_job_id?: string
      candidates: Array<{ source_id?: string; name?: string; raw_text?: string; location?: string }>
    }) =>
      request<{ ingested: number; results: Array<{ id: string; status: string }> }>('/api/ingest', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  outreach: {
    draft: (data: { candidateId: string; jobId: string; channel?: string }) =>
      request<Outreach>('/api/outreach/draft', { method: 'POST', body: JSON.stringify(data) }),
    send: (outreachId: string) =>
      request<Outreach>('/api/outreach/send', {
        method: 'POST',
        body: JSON.stringify({ outreachId }),
      }),
    update: (id: string, draft: string) =>
      request<Outreach>(`/api/outreach/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ draft }),
      }),
    history: (candidateId: string) =>
      request<Outreach[]>(`/api/outreach/${candidateId}`),
  },

  ats: {
    log: (data: { candidateId: string; jobId: string; stage: string; notes?: string }) =>
      request('/api/ats/log', { method: 'POST', body: JSON.stringify(data) }),
    pcf: (data: { candidateId: string; jobId: string; hireDate: string; clientName: string }) =>
      request('/api/ats/pcf', { method: 'POST', body: JSON.stringify(data) }),
    history: (candidateId: string) => request(`/api/ats/${candidateId}`),
    exportCsv: () => {
      window.open(`${BASE}/api/ats/export/csv`, '_blank')
    },
  },
}
