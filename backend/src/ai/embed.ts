import OpenAI from 'openai'

// NVIDIA NIM (free tier) — swap back to OpenAI by setting baseURL to
// "https://api.openai.com/v1", apiKey to OPENAI_API_KEY, and model to
// "text-embedding-3-small" for better production quality
const openai = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
})

// nv-embedqa-e5-v5 requires input_type and supports truncate, neither of which
// is part of the standard OpenAI SDK EmbeddingCreateParams — use an intersection
// type to pass them through.
type NvidiaEmbeddingParams = Parameters<typeof openai.embeddings.create>[0] & {
  input_type: 'query' | 'passage'
  truncate: 'NONE' | 'START' | 'END'
}

/**
 * Embed a text string using nvidia/nv-embedqa-e5-v5.
 * input_type must be 'query' for job descriptions and 'passage' for resume text —
 * nv-embedqa-e5-v5 is asymmetric and uses different embedding spaces for each.
 * Returns a float array.
 */
export async function embed(
  text: string,
  input_type: 'query' | 'passage'
): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'nvidia/nv-embedqa-e5-v5',
    // The model caps input at 512 tokens. truncate:'END' tells the server to
    // trim to that limit instead of returning a 400 — without it, any resume or
    // job description longer than ~512 tokens fails the whole scoring request.
    input: text.slice(0, 8000),
    input_type,
    truncate: 'END',
  } as NvidiaEmbeddingParams)
  return response.data[0].embedding
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Compute a 0-100 match score between a job description and a resume text.
 */
export async function computeMatchScore(
  jobDescription: string,
  resumeText: string
): Promise<number> {
  const [jobEmbedding, candidateEmbedding] = await Promise.all([
    embed(jobDescription, 'query'),    // job description is the search query
    embed(resumeText, 'passage'),      // resume is the document being retrieved
  ])
  const similarity = cosineSimilarity(jobEmbedding, candidateEmbedding)
  // cosine similarity is -1 to 1; scale to 0-100
  return Math.round(((similarity + 1) / 2) * 100)
}
