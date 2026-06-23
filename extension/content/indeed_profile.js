/**
 * Recrutimation — Indeed applicant *profile* content script
 *
 * Target: employers.indeed.com/jobs/:jobId/applicants/:applicantId
 *
 * Captures the "behind-the-click" detail the list page doesn't have:
 *   1. The full resume text on the profile page  -> POST enrich (re-parses + re-scores)
 *   2. The resume PDF                            -> downloaded with the recruiter's
 *      live session cookies and uploaded to the backend.
 *
 * Selectors are pinned to data-testid where known and will need tuning when
 * Indeed changes their DOM (same caveat as the list scraper).
 */

;(function () {
  'use strict'

  const seen = new Set() // applicantIds handled this session (avoid re-spamming)

  function getIds() {
    const m = location.pathname.match(/\/jobs?\/([^/]+)\/applicants\/([^/?#]+)/)
    if (m) return { applicantId: m[2] }
    const m2 = location.pathname.match(/\/applicants\/([^/?#]+)/)
    return m2 ? { applicantId: m2[1] } : null
  }

  function pick(...selectors) {
    for (const s of selectors) {
      const el = document.querySelector(s)
      const t = el?.innerText?.trim()
      if (t) return t
    }
    return undefined
  }

  function scrapeDetail() {
    // Find the richest resume container; fall back to the main content area.
    const containers = [
      '[data-testid="resume"]',
      '[data-testid="applicant-resume"]',
      '[data-testid="resume-section"]',
      '#resume',
      'main',
    ]
    let text = ''
    for (const s of containers) {
      const el = document.querySelector(s)
      const t = el?.innerText?.trim()
      if (t && t.length > text.length) text = t
    }
    if (!text) text = (document.body.innerText || '').trim()

    const email =
      pick('[data-testid="applicant-email"]') ||
      (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0]
    const phone =
      pick('[data-testid="applicant-phone"]') ||
      (text.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/) || [])[0]

    return {
      raw_text: text.slice(0, 12000),
      name: pick('[data-testid="applicant-name"]'),
      email,
      phone,
      location: pick('[data-testid="applicant-location"]'),
    }
  }

  function findPdfUrl() {
    const a = document.querySelector(
      'a[href$=".pdf"], a[href*=".pdf?"], a[download][href*="resume"], a[href*="/resume"][href*="pdf"]'
    )
    if (a) return a.href
    const emb = document.querySelector(
      'embed[type="application/pdf"], iframe[src*=".pdf"], object[data*=".pdf"]'
    )
    return emb?.src || emb?.getAttribute('data') || null
  }

  async function blobToBase64(blob) {
    const buf = await blob.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let bin = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
    }
    return btoa(bin)
  }

  async function run() {
    const ids = getIds()
    if (!ids || seen.has(ids.applicantId)) return
    seen.add(ids.applicantId)

    const detail = scrapeDetail()
    if (detail.raw_text && detail.raw_text.length > 80) {
      chrome.runtime.sendMessage(
        {
          type: 'ENRICH',
          payload: {
            source: 'indeed',
            source_id: ids.applicantId,
            raw_text: detail.raw_text,
            name: detail.name,
            email: detail.email,
            phone: detail.phone,
            location: detail.location,
          },
        },
        (res) => {
          if (chrome.runtime.lastError) return
          console.log('[Recrutimation/Profile] Enriched', ids.applicantId, res?.result ?? res)
        }
      )
    }

    const pdfUrl = findPdfUrl()
    if (!pdfUrl) {
      console.log('[Recrutimation/Profile] No resume PDF found on this page')
      return
    }
    try {
      // Download using the recruiter's active session — only reaches PDFs the
      // logged-in account is already authorised to see.
      const res = await fetch(pdfUrl, { credentials: 'include' })
      if (!res.ok) throw new Error(`PDF HTTP ${res.status}`)
      const blob = await res.blob()
      const base64 = await blobToBase64(blob)
      chrome.runtime.sendMessage(
        {
          type: 'INGEST_PDF',
          payload: {
            source: 'indeed',
            source_id: ids.applicantId,
            base64,
            mimetype: blob.type || 'application/pdf',
          },
        },
        (resp) => {
          if (chrome.runtime.lastError) return
          console.log('[Recrutimation/Profile] PDF uploaded', resp?.result ?? resp)
        }
      )
    } catch (e) {
      console.warn('[Recrutimation/Profile] PDF download/upload failed:', e.message)
    }
  }

  // Run on load and on SPA navigation (debounced).
  let timer = null
  const observer = new MutationObserver(() => {
    clearTimeout(timer)
    timer = setTimeout(run, 800)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  run()
})()
