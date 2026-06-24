import OpenAI from 'openai'

// NVIDIA NIM (free tier) — swap back to Anthropic by reinstating the
// Anthropic client, apiKey: ANTHROPIC_API_KEY, model: "claude-sonnet-4-20250514"
// Claude gives noticeably better willingness scoring on edge cases
const openai = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
})

export interface WillingnessResult {
  willing_score: number
  flags: string[]
  reasoning: string
}

export interface ScoreInput {
  jobTitle: string
  jobPayRange?: string | null
  jobLocation?: string | null
  mostRecentRole?: string
  employer?: string
  duration?: string
  jobsJson?: unknown
  distanceMi?: number | null
  resumeLastActive?: string | null
  rawText?: string | null
}

/**
 * Parse JSON out of an LLM response, tolerating markdown fences and prose
 * wrapped around the object. Returns `fallback` instead of throwing when the
 * output can't be parsed, so a single malformed response never crashes the
 * scoring pipeline (this runs inside the BullMQ worker and the /api/parse route).
 */
export function parseJsonLoose<T>(raw: string, fallback: T): T {
  const stripped = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  // Try the whole stripped string first, then the first {...} block if the
  // model added prose around it.
  const candidates = [stripped]
  const first = stripped.indexOf('{')
  const last = stripped.lastIndexOf('}')
  if (first !== -1 && last > first) candidates.push(stripped.slice(first, last + 1))

  for (const c of candidates) {
    try {
      return JSON.parse(c) as T
    } catch {
      // try next candidate
    }
  }
  console.warn('[score] Could not parse LLM JSON output; using fallback. Raw:', raw.slice(0, 300))
  return fallback
}

/**
 * Ask Claude to estimate willingness score (0-100) and surface flags.
 */
export async function scoreWillingness(input: ScoreInput): Promise<WillingnessResult> {
  const prompt = `You are assessing whether a job candidate is likely to accept and stay in a role.

Job: ${input.jobTitle}${input.jobPayRange ? `, ${input.jobPayRange}` : ''}${input.jobLocation ? `, ${input.jobLocation}` : ''}
Candidate's most recent role: ${input.mostRecentRole ?? 'Unknown'} at ${input.employer ?? 'Unknown'}${input.duration ? `, ${input.duration}` : ''}
Candidate's full job history: ${JSON.stringify(input.jobsJson ?? [])}
Distance from job: ${input.distanceMi != null ? `${input.distanceMi} miles` : 'Unknown'}
Resume last active: ${input.resumeLastActive ?? 'Unknown'}

Score from 0–100 how likely this candidate is to:
1. Respond to outreach
2. Accept the role if offered
3. Stay past 30 days

Return JSON only — no prose before or after:
{ "willing_score": number, "flags": string[], "reasoning": string }

Penalise heavily for: overqualification, large pay gap upward, long commute for low-wage role,
resume inactive > 3 months, very recent job start (they just started somewhere else).
Reward: exact title match, local, recently active, similar pay history, gaps in employment.`

  const message = await openai.chat.completions.create({
    model: 'meta/llama-3.3-70b-instruct',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.choices[0].message.content ?? ''
  return parseJsonLoose<WillingnessResult>(text, {
    willing_score: 0,
    flags: ['scoring_unavailable'],
    reasoning: 'Model output could not be parsed.',
  })
}

/**
 * Generate a one-line recruiter-facing summary for a candidate.
 */
export async function generateSummary(rawText: string, jobTitle: string): Promise<string> {
  const prompt = `Summarise this candidate in one sentence for a recruiter reviewing candidates for a "${jobTitle}" role.
Be specific: mention years of experience, most relevant role, and any key risk factors.
Do not use filler phrases like "dynamic professional" or "results-driven". Max 25 words.

Candidate profile:
${rawText.slice(0, 3000)}`

  const message = await openai.chat.completions.create({
    // 8b is plenty for a one-line summary and ~5x faster than the 70b model.
    model: 'meta/llama-3.1-8b-instruct',
    max_tokens: 100,
    messages: [{ role: 'user', content: prompt }],
  })

  return (message.choices[0].message.content ?? '').trim()
}

/**
 * Parse raw candidate paste text into a structured object.
 */
export async function parseCandidate(rawText: string): Promise<{
  name: string | null
  email: string | null
  phone: string | null
  location: string | null
  jobs: Array<{ role: string; employer: string; start?: string; end?: string; detail?: string }>
  skills: string[]
}> {
  const prompt = `Extract structured data from this candidate profile text.
Return JSON only — no prose:
{
  "name": string | null,
  "email": string | null,
  "phone": string | null,
  "location": string | null,
  "jobs": [{ "role": string, "employer": string, "start": string | null, "end": string | null, "detail": string | null }],
  "skills": string[]
}

Profile text:
${rawText.slice(0, 8000)}`

  const message = await openai.chat.completions.create({
    // Field extraction is structured but not reasoning-heavy; 8b handles it well
    // and is ~5x faster than the 70b model.
    model: 'meta/llama-3.1-8b-instruct',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.choices[0].message.content ?? ''
  return parseJsonLoose(text, {
    name: null,
    email: null,
    phone: null,
    location: null,
    jobs: [],
    skills: [],
  })
}
