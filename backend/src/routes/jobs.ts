import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db/client.js'
import { scoreQueue } from '../workers/scorer.js'

const CreateJobSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  location: z.string().optional(),
  payRange: z.string().optional(),
  platform: z.enum(['indeed', 'linkedin']).optional(),
  platformId: z.string().optional(),
})

const UpdateJobSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  payRange: z.string().optional(),
  platform: z.enum(['indeed', 'linkedin']).optional(),
  platformId: z.string().optional(),
  status: z.enum(['open', 'closed', 'paused']).optional(),
})

// Job details scraped from a platform's job page (via the extension popup). The
// description is what the scorer needs; supplying it is what lets a stub job's
// candidates finally score.
const JobBySourceSchema = z.object({
  job_id: z.string().uuid().optional(),
  platform: z.enum(['indeed', 'linkedin']).optional(),
  platform_job_id: z.string().optional(),
  title: z.string().optional(),
  description: z.string().min(1),
  location: z.string().optional(),
  payRange: z.string().optional(),
})

// A stub job auto-created by ingest is titled "<source> job <platformId>"; treat
// that (or an empty title) as "not really set" so a scrape can fill it in without
// clobbering a title the recruiter typed themselves.
function isPlaceholderTitle(title: string): boolean {
  return !title.trim() || /^(indeed|linkedin|paste) job /i.test(title)
}

export async function jobRoutes(fastify: FastifyInstance) {
  // GET /api/jobs — list all jobs
  fastify.get('/api/jobs', async () => {
    return prisma.job.findMany({ orderBy: { createdAt: 'desc' } })
  })

  // GET /api/jobs/:id — get single job
  fastify.get<{ Params: { id: string } }>('/api/jobs/:id', async (req, reply) => {
    const job = await prisma.job.findUnique({ where: { id: req.params.id } })
    if (!job) return reply.status(404).send({ error: 'Job not found' })
    return job
  })

  // POST /api/jobs — create job
  fastify.post('/api/jobs', async (req, reply) => {
    const body = CreateJobSchema.parse(req.body)
    const job = await prisma.job.create({
      data: {
        title: body.title,
        description: body.description,
        location: body.location,
        payRange: body.payRange,
        platform: body.platform,
        platformId: body.platformId,
      },
    })
    return reply.status(201).send(job)
  })

  // POST /api/jobs/by-source — attach job details scraped from the platform's
  // job page, resolved by internal job_id or (platform, platformId), then
  // re-score that job's candidates now that a real description exists.
  fastify.post('/api/jobs/by-source', async (req, reply) => {
    const body = JobBySourceSchema.parse(req.body)

    // Resolve the job: explicit id first, then the platform id, else create one.
    let job = null
    if (body.job_id) {
      job = await prisma.job.findUnique({ where: { id: body.job_id } })
      if (!job) return reply.status(404).send({ error: 'Job not found' })
    } else if (body.platform_job_id) {
      job = await prisma.job.findFirst({
        where: { platformId: body.platform_job_id, platform: body.platform },
      })
    }
    if (!job && !body.platform_job_id) {
      return reply.status(400).send({ error: 'job_id or platform_job_id required' })
    }

    // Fill title/location/payRange only where the job doesn't already have a
    // recruiter-set value; always set the description (that's the point).
    const data: {
      description: string
      title?: string
      location?: string
      payRange?: string
    } = { description: body.description }
    if (body.title && (!job || isPlaceholderTitle(job.title))) data.title = body.title
    if (body.location && !job?.location) data.location = body.location
    if (body.payRange && !job?.payRange) data.payRange = body.payRange

    if (job) {
      job = await prisma.job.update({ where: { id: job.id }, data })
    } else {
      job = await prisma.job.create({
        data: {
          title: data.title ?? `${body.platform ?? 'indeed'} job ${body.platform_job_id}`,
          description: body.description,
          location: data.location,
          payRange: data.payRange,
          platform: body.platform,
          platformId: body.platform_job_id,
        },
      })
    }

    // Re-score every candidate on this job — prior scores were against a blank or
    // placeholder description, so they're stale. Only candidates with rawText are
    // scoreable.
    const cands = await prisma.candidate.findMany({
      where: { jobId: job.id, rawText: { not: null } },
      select: { id: true },
    })
    for (const c of cands) {
      await scoreQueue.add('score', { candidateId: c.id, jobId: job.id })
    }

    return { job, requeued: cands.length }
  })

  // PATCH /api/jobs/:id — update job
  fastify.patch<{ Params: { id: string } }>('/api/jobs/:id', async (req, reply) => {
    const body = UpdateJobSchema.parse(req.body)
    const job = await prisma.job.update({
      where: { id: req.params.id },
      data: body,
    })
    return job
  })

  // DELETE /api/jobs/:id — delete job
  fastify.delete<{ Params: { id: string } }>('/api/jobs/:id', async (req, reply) => {
    await prisma.job.delete({ where: { id: req.params.id } })
    return reply.status(204).send()
  })

  // GET /api/jobs/:id/candidates — candidates for a job, sorted by match score
  fastify.get<{ Params: { id: string }; Querystring: { decision?: string; limit?: string } }>(
    '/api/jobs/:id/candidates',
    async (req) => {
      const { id } = req.params
      const limit = parseInt(req.query.limit ?? '50', 10)

      // Get candidates with their latest decision. Only fully-scored candidates
      // are shown — ones still being ingested by the LLM are hidden until ready.
      const candidates = await prisma.candidate.findMany({
        where: { jobId: id, scoredAt: { not: null } },
        orderBy: [{ matchScore: 'desc' }, { willingScore: 'desc' }],
        take: limit,
        include: {
          decisions: {
            orderBy: { decidedAt: 'desc' },
            take: 1,
          },
        },
      })

      // Filter by decision status if requested
      if (req.query.decision) {
        return candidates.filter((c) => {
          const latest = c.decisions[0]
          if (req.query.decision === 'undecided') return !latest
          return latest?.decision === req.query.decision
        })
      }

      return candidates
    }
  )

  // GET /api/jobs/:id/candidates/count — counts for a job. Drives the ingest
  // progress UI and the review/results/jobs tab badges without depending on the
  // list endpoint's (capped) page size.
  //   total     — all candidates ingested for the job
  //   scored    — fully scored by the LLM (ready to review)
  //   ingesting — uploaded but not yet scored (total - scored)
  //   reviewed  — scored AND have a keep/pin/skip decision
  //   toReview  — scored but not yet decided (scored - reviewed)
  fastify.get<{ Params: { id: string } }>('/api/jobs/:id/candidates/count', async (req) => {
    const { id } = req.params
    const [total, scored, reviewed] = await Promise.all([
      prisma.candidate.count({ where: { jobId: id } }),
      prisma.candidate.count({ where: { jobId: id, scoredAt: { not: null } } }),
      prisma.candidate.count({
        where: { jobId: id, scoredAt: { not: null }, decisions: { some: {} } },
      }),
    ])
    return { total, scored, ingesting: total - scored, reviewed, toReview: scored - reviewed }
  })
}
