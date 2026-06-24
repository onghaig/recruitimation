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
  jobDescription?: string | null
  jobPayRange?: string | null
  jobLocation?: string | null
  candidateLocation?: string | null
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
  const prompt = `You are screening a job candidate for a specific role. Be strict — this is
first-pass filtering for a staffing agency, and the recruiter's time and contact credits are
limited. When in doubt, score lower.

JOB
Title: ${input.jobTitle}${input.jobPayRange ? `\nPay: ${input.jobPayRange}` : ''}${input.jobLocation ? `\nLocation: ${input.jobLocation}` : ''}
Full description and requirements:
${input.jobDescription ?? '(no description provided)'}

CANDIDATE
Location: ${input.candidateLocation ?? 'Unknown'}
Most recent role: ${input.mostRecentRole ?? 'Unknown'} at ${input.employer ?? 'Unknown'}${input.duration ? `, ${input.duration}` : ''}
Full job history: ${JSON.stringify(input.jobsJson ?? [])}
Distance from job: ${input.distanceMi != null ? `${input.distanceMi} miles` : 'Unknown — estimate the commute from the two locations above'}
Resume last active: ${input.resumeLastActive ?? 'Unknown'}

Assess on TWO axes. REQUIREMENT FIT is by far the most important:

1. REQUIREMENT FIT (dominant factor): Read the job's requirements carefully. Does the candidate's
history clearly show the experience and skills the job requires? If the description marks anything
as "required" and the candidate does not clearly have it, treat that as a major disqualifier.
Heavily penalise candidates whose background is in an unrelated field, even when the work is
similarly low-skill (e.g. housekeeping experience does NOT qualify someone for a mailroom or
warehouse role). Do not give credit for vaguely "transferable" soft skills when specific experience
is required. A candidate who lacks required experience must score below 30 no matter how willing
they appear.

2. WILLINGNESS: likelihood to respond to outreach, accept if offered, and stay past 30 days.
Penalise: overqualification, large upward pay gap, long commute for low-wage role, resume inactive
> 3 months, very recent job start (they just started somewhere else). Reward: exact title match,
local, recently active, similar pay history.

Return a single willing_score 0–100 that reflects BOTH axes but is dominated by requirement fit.
In flags, add "lacks required <X>" for each unmet required item and "irrelevant experience" when the
background is in an unrelated field.

Return JSON only — no prose before or after:
{ "willing_score": number, "flags": string[], "reasoning": string }`

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
