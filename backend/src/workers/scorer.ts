/**
 * BullMQ scorer worker — picks up scoring jobs and runs the AI pipeline.
 *
 * Run with: npm run worker
 * (or alongside the API server in development)
 */
import { Worker, Queue } from 'bullmq'
import { Redis as IORedis } from 'ioredis'
import { prisma } from '../db/client.js'
import { computeMatchScore } from '../ai/embed.js'
import { scoreWillingness, generateSummary, parseCandidate } from '../ai/score.js'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null })

export const SCORE_QUEUE = 'score'

export const scoreQueue = new Queue(SCORE_QUEUE, { connection })

export interface ScoreJobData {
  candidateId: string
  jobId: string
}

const worker = new Worker<ScoreJobData>(
  SCORE_QUEUE,
  async (job) => {
    const { candidateId, jobId } = job.data
    console.log(`[scorer] Processing candidate ${candidateId} for job ${jobId}`)

    const [candidate, jobRecord] = await Promise.all([
      prisma.candidate.findUnique({ where: { id: candidateId } }),
      prisma.job.findUnique({ where: { id: jobId } }),
    ])

    if (!candidate || !jobRecord) {
      throw new Error(`Candidate or job not found: ${candidateId}, ${jobId}`)
    }

    if (!candidate.rawText || !jobRecord.description) {
      console.warn(`[scorer] Missing rawText or job description for ${candidateId}`)
      return
    }

    // Steps 1, 2, 4 are independent (match score, structured parse, summary), so
    // run them concurrently. Only willingness (below) depends on the parse output.
    // Extension-ingested candidates carry a thin scrape (name/title/snippet) with
    // null jobsJson, which starves the willingness model — parse those here,
    // mirroring /api/parse. Candidates that already have structured jobs skip it.
    const needsParse =
      !Array.isArray(candidate.jobsJson) || candidate.jobsJson.length === 0

    const [matchScore, parsed, aiSummary] = await Promise.all([
      computeMatchScore(jobRecord.description, candidate.rawText),
      needsParse ? parseCandidate(candidate.rawText) : Promise.resolve(null),
      generateSummary(candidate.rawText, jobRecord.title),
    ])

    let jobsArray = Array.isArray(candidate.jobsJson) ? candidate.jobsJson : []
    let skillsArray = Array.isArray(candidate.skillsJson) ? candidate.skillsJson : []
    const parsedFields: {
      name?: string | null
      email?: string | null
      phone?: string | null
      location?: string | null
    } = {}

    if (parsed) {
      jobsArray = parsed.jobs ?? []
      skillsArray = parsed.skills ?? []
      // Backfill contact fields only where the scrape left them empty.
      if (!candidate.name && parsed.name) parsedFields.name = parsed.name
      if (!candidate.email && parsed.email) parsedFields.email = parsed.email
      if (!candidate.phone && parsed.phone) parsedFields.phone = parsed.phone
      if (!candidate.location && parsed.location) parsedFields.location = parsed.location
    }

    // Step 3 — willingness score
    const firstJob = jobsArray[0] as
      | { role?: string; employer?: string; start?: string; end?: string }
      | undefined

    const willingnessResult = await scoreWillingness({
      jobTitle: jobRecord.title,
      jobDescription: jobRecord.description,
      jobPayRange: jobRecord.payRange,
      jobLocation: jobRecord.location,
      candidateLocation: candidate.location ?? parsedFields.location ?? null,
      mostRecentRole: firstJob?.role,
      employer: firstJob?.employer,
      duration:
        firstJob?.start && firstJob?.end ? `${firstJob.start} – ${firstJob.end}` : undefined,
      jobsJson: jobsArray,
      distanceMi: candidate.distanceMi ? Number(candidate.distanceMi) : null,
      resumeLastActive: candidate.resumeLastActive?.toISOString().split('T')[0] ?? null,
    })

    // Step 4 — write back to DB (summary already computed concurrently above)
    await prisma.candidate.update({
      where: { id: candidateId },
      data: {
        ...parsedFields,
        jobsJson: jobsArray,
        skillsJson: skillsArray,
        matchScore,
        willingScore: willingnessResult.willing_score,
        aiSummary,
        flagsJson: willingnessResult.flags,
        scoredAt: new Date(),
      },
    })

    console.log(
      `[scorer] Done — candidate ${candidateId}: match=${matchScore} willing=${willingnessResult.willing_score}`
    )
  },
  {
    connection,
    concurrency: 3,
  }
)

worker.on('failed', (job, err) => {
  console.error(`[scorer] Job ${job?.id} failed:`, err.message)
})

worker.on('completed', (job) => {
  console.log(`[scorer] Job ${job.id} completed`)
})

console.log('[scorer] Worker started, waiting for jobs…')
