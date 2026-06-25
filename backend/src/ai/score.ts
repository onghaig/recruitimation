import OpenAI from 'openai'

// NVIDIA NIM (free tier) — swap back to Anthropic by reinstating the
// Anthropic client, apiKey: ANTHROPIC_API_KEY, model: "claude-sonnet-4-20250514"
// Claude gives noticeably better willingness scoring on edge cases
const openai = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
})

export interface CandidateScore {
  match_score: number // 0-100, how well the candidate meets the job's requirements
  willing_score: number // 0-100, likelihood to respond / accept / stay
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
 * Score a candidate against a job with a single LLM call, returning two
 * independent 0-100 numbers: match_score (requirement / experience fit) and
 * willing_score (likelihood to respond, accept, and stay). match_score replaces
 * the old embedding cosine similarity, which clustered every candidate around
 * 70-85 regardless of fit because résumés in the same field embed close together.
 */
export async function scoreCandidate(input: ScoreInput): Promise<CandidateScore> {
  const resumeExcerpt = input.rawText ? input.rawText.slice(0, 4000) : ''
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
Resume last active: ${input.resumeLastActive ?? 'Unknown'}${resumeExcerpt ? `\nRésumé text:\n${resumeExcerpt}` : ''}

Produce TWO independent scores:

1. match_score (0-100) — REQUIREMENT FIT. Read the job's requirements carefully. Does the
candidate's history clearly show the experience and skills the job requires? If the description
marks anything as "required" and the candidate does not clearly have it, that is a major
disqualifier — score below 30. Heavily penalise candidates whose background is in an unrelated
field, even when the work is similarly low-skill (e.g. housekeeping experience does NOT qualify
someone for a mailroom or warehouse role). Do not give credit for vaguely "transferable" soft
skills when specific experience is required. Reserve 80-100 for candidates who clearly meet every
requirement, 50-79 for partial fits, 30-49 for weak fits, and below 30 for unrelated backgrounds.

2. willing_score (0-100) — WILLINGNESS to respond to outreach, accept if offered, and stay past 30
days. Penalise: overqualification, large upward pay gap, long commute for low-wage role, resume
inactive > 3 months, very recent job start. Reward: exact title match, local, recently active,
similar pay history.

Use the FULL 0-100 range for both scores and spread candidates out — do not cluster everyone in
the 70s. In flags, add "lacks required <X>" for each unmet required item and "irrelevant
experience" when the background is in an unrelated field. Keep "reasoning" to at most two short
sentences so the JSON stays compact.

Return JSON only — no prose before or after:
{ "match_score": number, "willing_score": number, "flags": string[], "reasoning": string }`

  const message = await openai.chat.completions.create({
    model: 'meta/llama-3.3-70b-instruct',
    // Generous so the reasoning string can't truncate the JSON (which would fail
    // the parse and fall back to a 0/0 "scoring_unavailable" score).
    max_tokens: 768,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.choices[0].message.content ?? ''
  return parseJsonLoose<CandidateScore>(text, {
    match_score: 0,
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

export interface ParsedCandidate {
  name: string | null
  email: string | null
  phone: string | null
  location: string | null
  jobs: Array<{ role: string; employer: string; start?: string; end?: string; detail?: string }>
  skills: string[]
}

/**
 * Backfill contact fields from the raw résumé text whenever the model left them
 * null. These four fields are reliably present near the top of a scraped Indeed
 * résumé, so they should never depend on the larger structured-JSON parse
 * succeeding (a long career can truncate that JSON and zero out everything).
 */
export function backfillContact(rawText: string, parsed: ParsedCandidate): ParsedCandidate {
  const out = { ...parsed }
  if (!out.email) {
    out.email = (rawText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] ?? null
  }
  if (!out.phone) {
    out.phone = (rawText.match(/\+?\d{0,2}[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/) || [])[0]?.trim() ?? null
  }
  if (!out.name) {
    // Indeed résumé header: "Full name\nBridgette Smith"
    out.name = rawText.match(/\bFull name\b\s*[:\n]+\s*([^\n]{2,60})/i)?.[1]?.trim() ?? null
  }
  if (!out.location) {
    // Indeed résumé header: "City, state\nTroy, NY"
    out.location = rawText.match(/\bCity,?\s*state\b\s*[:\n]+\s*([^\n]{2,60})/i)?.[1]?.trim() ?? null
  }
  return out
}

/**
 * Parse raw candidate paste text into a structured object.
 */
export async function parseCandidate(rawText: string): Promise<ParsedCandidate> {
  const prompt = `Extract structured data from this candidate profile text.
Keep each job "detail" to one short phrase (max 15 words) so the response stays compact.
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
    // and is ~5x faster than the 70b model. max_tokens is generous so a long
    // job history doesn't truncate the JSON (which would fail the parse and zero
    // out every field, contact info included).
    model: 'meta/llama-3.1-8b-instruct',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.choices[0].message.content ?? ''
  const parsed = parseJsonLoose<ParsedCandidate>(text, {
    name: null,
    email: null,
    phone: null,
    location: null,
    jobs: [],
    skills: [],
  })
  // Guarantee contact fields even if the structured parse fell back to nulls.
  return backfillContact(rawText, parsed)
}
