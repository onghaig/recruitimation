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
 * Embed a text string using baai/bge-m3 (8192-token context) on NVIDIA NIM.
 * input_type is 'query' for job descriptions and 'passage' for resume text
 * (retained from the asymmetric e5 model; bge-m3 accepts it as a retrieval hint).
 * Returns a float array.
 */
export async function embed(
  text: string,
  input_type: 'query' | 'passage'
): Promise<number[]> {
  const response = await openai.embeddings.create({
    // baai/bge-m3 has an 8192-token context (vs 512 for nv-embedqa-e5-v5), so the
    // whole resume / job description is embedded instead of just the first ~512
    // tokens. ~30k chars (~7.5k tokens) keeps us under the cap; truncate:'END' is
    // the safety net for anything longer so it trims server-side instead of 400ing.
    model: 'baai/bge-m3',
    input: text.slice(0, 30000),
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
