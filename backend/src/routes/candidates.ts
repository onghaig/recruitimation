import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db/client.js'
import { scoreQueue } from '../workers/scorer.js'
import { presignUrl, uploadPdf } from '../storage/r2.js'
import { scoreCandidate, generateSummary, parseCandidate } from '../ai/score.js'

const DecisionSchema = z.object({
  decision: z.enum(['keep', 'pin', 'skip']),
  jobId: z.string().uuid(),
  pinNote: z.string().optional(),
  pinRemind: z.string().optional(), // ISO date string
})

const EnrichSchema = z.object({
  source: z.enum(['indeed', 'linkedin', 'paste']).optional(),
  source_id: z.string().min(1),
  job_id: z.string().uuid().optional(),
  raw_text: z.string().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
})

const ParseAndScoreSchema = z.object({
  rawText: z.string().min(1),
  jobDescription: z.string().min(1),
  jobTitle: z.string(),
  jobLocation: z.string().optional(),
  jobPayRange: z.string().optional(),
  jobId: z.string().uuid().optional(),
})

export async function candidateRoutes(fastify: FastifyInstance) {
  // POST /api/parse — Phase 1 MVP: paste raw text, get structured candidate + scores
  fastify.post('/api/parse', async (req, reply) => {
    const body = ParseAndScoreSchema.parse(req.body)

    // parse and summary are independent — run them concurrently so the request
    // waits on the slowest single call rather than the sum of both.
    const [parsed, aiSummary] = await Promise.all([
      parseCandidate(body.rawText),
      generateSummary(body.rawText, body.jobTitle),
    ])

    // Scoring needs the parsed job history, so it runs after the parse resolves.
    // match_score and willing_score both come from this single LLM call now.
    const firstJob = parsed.jobs[0]
    const score = await scoreCandidate({
      jobTitle: body.jobTitle,
      jobDescription: body.jobDescription,
      jobPayRange: body.jobPayRange,
      jobLocation: body.jobLocation,
      candidateLocation: parsed.location,
      mostRecentRole: firstJob?.role,
      employer: firstJob?.employer,
      jobsJson: parsed.jobs,
      rawText: body.rawText,
    })
    const matchScore = score.match_score

    // Resolve the job: use the selected one, or auto-create it from the entered
    // details so a freshly-parsed candidate (and its new job) always show up in
    // the Jobs/Results tabs.
    let jobId = body.jobId
    let jobCreated = false
    if (!jobId) {
      const job = await prisma.job.create({
        data: {
          title: body.jobTitle,
          description: body.jobDescription,
          location: body.jobLocation,
          payRange: body.jobPayRange,
        },
      })
      jobId = job.id
      jobCreated = true
    }

    const candidate = await prisma.candidate.create({
      data: {
        jobId,
        source: 'paste',
        name: parsed.name,
        email: parsed.email,
        phone: parsed.phone,
        location: parsed.location,
        rawText: body.rawText,
        jobsJson: parsed.jobs,
        skillsJson: parsed.skills,
        matchScore,
        willingScore: score.willing_score,
        aiSummary,
        flagsJson: score.flags,
        scoredAt: new Date(),
      },
    })

    return {
      candidateId: candidate.id,
      jobId,
      jobCreated,
      parsed,
      matchScore,
      willingScore: score.willing_score,
      flags: score.flags,
      reasoning: score.reasoning,
      aiSummary,
    }
  })

  // GET /api/candidates/:id — get single candidate
  fastify.get<{ Params: { id: string } }>('/api/candidates/:id', async (req, reply) => {
    const candidate = await prisma.candidate.findUnique({
      where: { id: req.params.id },
      include: {
        decisions: { orderBy: { decidedAt: 'desc' }, take: 1 },
        outreach: { orderBy: { sentAt: 'desc' } },
      },
    })
    if (!candidate) return reply.status(404).send({ error: 'Candidate not found' })
    return candidate
  })

  // POST /api/candidates/:id/score — (re)score a candidate
  fastify.post<{ Params: { id: string } }>('/api/candidates/:id/score', async (req, reply) => {
    const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } })
    if (!candidate) return reply.status(404).send({ error: 'Candidate not found' })
    if (!candidate.jobId) return reply.status(400).send({ error: 'Candidate has no associated job' })

    await scoreQueue.add('score', { candidateId: candidate.id, jobId: candidate.jobId })
    return { queued: true }
  })

  // GET /api/candidates/:id/pdf — get presigned R2 URL for PDF
  fastify.get<{ Params: { id: string } }>('/api/candidates/:id/pdf', async (req, reply) => {
    const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } })
    if (!candidate) return reply.status(404).send({ error: 'Candidate not found' })
    if (!candidate.pdfKey) return reply.status(404).send({ error: 'No PDF on file' })

    const url = await presignUrl(candidate.pdfKey)
    return { url, expiresIn: 3600 }
  })

  // POST /api/candidates/:id/pdf — upload a PDF resume
  fastify.post<{ Params: { id: string } }>(
    '/api/candidates/:id/pdf',
    async (req, reply) => {
      const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } })
      if (!candidate) return reply.status(404).send({ error: 'Candidate not found' })

      const data = await req.file()
      if (!data) return reply.status(400).send({ error: 'No file uploaded' })

      const buffer = await data.toBuffer()
      const pdfKey = await uploadPdf(candidate.id, buffer, data.mimetype)

      await prisma.candidate.update({
        where: { id: candidate.id },
        data: { pdfKey },
      })

      return { pdfKey }
    }
  )

  // POST /api/candidates/by-source/pdf — upload a PDF keyed by the platform's
  // applicant id, so the extension doesn't need the internal candidate UUID.
  // Multipart: send fields (source_id, source?, job_id?) BEFORE the file part.
  fastify.post('/api/candidates/by-source/pdf', async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.status(400).send({ error: 'No file uploaded' })

    const fields = data.fields as Record<string, { value?: string } | undefined>
    const sourceId = fields.source_id?.value
    const source = fields.source?.value
    const jobId = fields.job_id?.value
    if (!sourceId) return reply.status(400).send({ error: 'source_id field required' })

    const candidate = await prisma.candidate.findFirst({
      where: {
        sourceId,
        ...(source ? { source } : {}),
        ...(jobId ? { jobId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    })
    if (!candidate) return reply.status(404).send({ error: 'No candidate for that source_id' })

    const buffer = await data.toBuffer()
    const pdfKey = await uploadPdf(candidate.id, buffer, data.mimetype)
    await prisma.candidate.update({ where: { id: candidate.id }, data: { pdfKey } })

    return { candidateId: candidate.id, pdfKey }
  })

  // POST /api/candidates/by-source/enrich — attach richer detail scraped from
  // an applicant's profile page (behind-click data) keyed by source_id. Clears
  // the structured JSON so the scoring worker re-parses the fuller text.
  fastify.post('/api/candidates/by-source/enrich', async (req, reply) => {
    const body = EnrichSchema.parse(req.body)

    const candidate = await prisma.candidate.findFirst({
      where: {
        sourceId: body.source_id,
        ...(body.source ? { source: body.source } : {}),
        ...(body.job_id ? { jobId: body.job_id } : {}),
      },
      orderBy: { createdAt: 'desc' },
    })
    if (!candidate) return reply.status(404).send({ error: 'No candidate for that source_id' })

    // Keep whichever resume text is richer (the profile page is usually longer).
    const incoming = body.raw_text ?? ''
    const rawText =
      incoming.length > (candidate.rawText?.length ?? 0) ? incoming : candidate.rawText

    await prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        rawText,
        name: candidate.name ?? body.name,
        email: candidate.email ?? body.email,
        phone: candidate.phone ?? body.phone,
        location: candidate.location ?? body.location,
        // Force the worker to re-parse jobs/skills from the richer text.
        jobsJson: [],
        skillsJson: [],
      },
    })

    let rescored = false
    if (candidate.jobId) {
      await scoreQueue.add('score', { candidateId: candidate.id, jobId: candidate.jobId })
      rescored = true
    }

    return { candidateId: candidate.id, rescored }
  })

  // POST /api/candidates/:id/decision — save keep/pin/skip
  fastify.post<{ Params: { id: string } }>('/api/candidates/:id/decision', async (req, reply) => {
    const body = DecisionSchema.parse(req.body)
    const { id } = req.params

    const candidate = await prisma.candidate.findUnique({ where: { id } })
    if (!candidate) return reply.status(404).send({ error: 'Candidate not found' })

    const decision = await prisma.decision.create({
      data: {
        candidateId: id,
        jobId: body.jobId,
        decision: body.decision,
        pinNote: body.pinNote,
        pinRemind: body.pinRemind ? new Date(body.pinRemind) : undefined,
      },
    })

    return reply.status(201).send(decision)
  })

  // DELETE /api/candidates/:id/decision — undo: remove the latest decision for
  // this candidate (optionally scoped to a job), so it returns to "undecided".
  fastify.delete<{ Params: { id: string }; Querystring: { jobId?: string } }>(
    '/api/candidates/:id/decision',
    async (req) => {
      const { id } = req.params
      const latest = await prisma.decision.findFirst({
        where: { candidateId: id, ...(req.query.jobId ? { jobId: req.query.jobId } : {}) },
        orderBy: { decidedAt: 'desc' },
      })
      if (latest) await prisma.decision.delete({ where: { id: latest.id } })
      return { ok: true, removed: !!latest }
    },
  )
}
