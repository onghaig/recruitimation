import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db/client.js'
import { scoreQueue } from '../workers/scorer.js'

const CandidateInputSchema = z.object({
  source_id: z.string().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  title: z.string().optional(), // most recent job title from scrape
  snippet: z.string().optional(), // resume snippet from scrape
  last_active: z.string().optional(),
  raw_text: z.string().optional(),
})

const IngestBodySchema = z.object({
  source: z.enum(['indeed', 'linkedin', 'paste']),
  platform_job_id: z.string().optional(),
  platform_job_title: z.string().optional(), // scraped from the page, names auto-created jobs
  job_id: z.string().uuid().optional(), // internal job UUID if known
  candidates: z.array(CandidateInputSchema),
})

export async function ingestRoutes(fastify: FastifyInstance) {
  // POST /api/ingest — receive candidates from extension or paste
  fastify.post('/api/ingest', async (req, reply) => {
    const body = IngestBodySchema.parse(req.body)

    // Resolve job_id: prefer the explicit internal id (set by the popup's job
    // selector), then look up by platform id. If nothing matches, auto-create a
    // stub job so candidates attach to *something* instead of orphaning with a
    // null jobId (orphans are invisible in the dashboard and never scored). The
    // stub has a blank description, so the scorer skips it until the recruiter
    // fills in the real job description and re-scores.
    let jobId = body.job_id
    if (!jobId && body.platform_job_id) {
      const job = await prisma.job.findFirst({
        where: {
          platformId: body.platform_job_id,
          platform: body.source,
        },
      })
      jobId = job?.id

      if (!jobId) {
        const stub = await prisma.job.create({
          data: {
            title: body.platform_job_title?.trim() || `${body.source} job ${body.platform_job_id}`,
            description: '',
            platform: body.source,
            platformId: body.platform_job_id,
          },
        })
        jobId = stub.id
      }
    }

    const results = []

    for (const raw of body.candidates) {
      // Skip duplicates (same source + source_id for same job)
      if (raw.source_id && jobId) {
        const existing = await prisma.candidate.findFirst({
          where: { sourceId: raw.source_id, jobId },
        })
        if (existing) {
          results.push({ id: existing.id, status: 'duplicate' })
          continue
        }
      }

      // Build raw text from available fields
      const rawText =
        raw.raw_text ??
        [raw.name, raw.title, raw.snippet, raw.location]
          .filter(Boolean)
          .join('\n')

      const candidate = await prisma.candidate.create({
        data: {
          jobId: jobId ?? null,
          source: body.source,
          sourceId: raw.source_id,
          name: raw.name,
          email: raw.email,
          phone: raw.phone,
          location: raw.location,
          rawText,
        },
      })

      // Enqueue scoring if we have a job
      if (jobId) {
        await scoreQueue.add('score', { candidateId: candidate.id, jobId })
      }

      results.push({ id: candidate.id, status: 'created' })
    }

    return reply.status(201).send({ ingested: results.length, results })
  })
}
