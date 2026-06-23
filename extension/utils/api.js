/**
 * Authenticated POST to the Recrutimation backend.
 * The API URL is stored in chrome.storage.sync so the recruiter
 * can point it at local dev or production.
 */

export async function getApiUrl() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['apiUrl'], (result) => {
      resolve(result.apiUrl ?? 'http://localhost:3000')
    })
  })
}

/**
 * POST /api/ingest with the given payload.
 * @param {object} payload - { source, platform_job_id?, candidates[] }
 * @returns {Promise<object>} response JSON
 */
export async function ingest(payload) {
  const base = await getApiUrl()
  const res = await fetch(`${base}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

/**
 * POST /api/candidates/by-source/enrich — attach richer profile detail,
 * resolved by the platform's applicant id (no internal UUID needed).
 * @param {object} payload - { source, source_id, raw_text?, name?, email?, phone?, location? }
 */
export async function enrich(payload) {
  const base = await getApiUrl()
  const res = await fetch(`${base}/api/candidates/by-source/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

/**
 * POST /api/candidates/by-source/pdf — upload a resume PDF, keyed by the
 * platform's applicant id. The blob arrives base64-encoded (it was passed
 * through extension messaging, which can't carry binary).
 * @param {object} payload - { source, source_id, base64, mimetype }
 */
export async function uploadPdfBySource({ source, source_id, base64, mimetype }) {
  const base = await getApiUrl()
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const blob = new Blob([bytes], { type: mimetype || 'application/pdf' })

  const fd = new FormData()
  // Fields must precede the file part — the backend reads them off req.file().fields.
  fd.append('source', source || 'indeed')
  fd.append('source_id', source_id)
  fd.append('file', blob, `${source_id}.pdf`)

  const res = await fetch(`${base}/api/candidates/by-source/pdf`, {
    method: 'POST',
    body: fd,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}
