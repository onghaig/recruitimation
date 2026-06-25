import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db/client.js'

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
