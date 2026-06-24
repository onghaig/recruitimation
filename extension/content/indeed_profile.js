/**
 * Recruitimation — Indeed applicant *profile* content script
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
    // New candidates view: /candidates/view?id=:candidateId&...&legacyJobId=...
    if (location.pathname.startsWith('/candidates/view')) {
      const id = new URLSearchParams(location.search).get('id')
      return id ? { applicantId: id } : null
    }
    // Legacy applicant profile: /jobs/:jobId/applicants/:applicantId
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
    // The new /candidates/view profile renders the full résumé in
    // ProfileResumePanel with profile-section-* blocks (Experience/Education).
    const containers = [
      '[data-testid="ProfileResumePanel"]',
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
    // Union the structured profile sections in case they sit outside the panel.
    const sections = [...document.querySelectorAll('[data-testid^="profile-section-"]')]
      .map((el) => el.innerText?.trim())
      .filter(Boolean)
      .join('\n\n')
    if (sections.length > text.length) text = sections
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
      '[data-testid="download-resume-inline"], [data-testid="download-resume-moreActions"], ' +
      'a[download][href^="blob:"], a[href$=".pdf"], a[href*=".pdf?"], ' +
      'a[download][href*="resume"], a[href*="/resume"][href*="pdf"]'
    )
    if (a) return a.href || a.getAttribute('href')
    const emb = document.querySelector(
      'embed[type="application/pdf"], iframe[src*=".pdf"], object[data*=".pdf"]'
    )
    return emb?.src || emb?.getAttribute('data') || null
  }

  // Promise wrapper so we can await background round-trips and only signal
  // PROFILE_DONE once the work for a profile is actually finished.
  function sendMessageAsync(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          void chrome.runtime.lastError
          resolve(res)
        })
      } catch {
        resolve(undefined)
      }
    })
  }

  // The profile is an SPA — wait until the résumé panel has actually rendered
  // before scraping, but don't wait forever.
  const READY_TIMEOUT = 12000
  const firstSeen = Date.now()
  function isReady() {
    if (document.querySelector('[data-testid="ResumePanel_loaded"]')) return true
    const panel = document.querySelector('[data-testid="ProfileResumePanel"]')
    return !!(panel && (panel.innerText || '').trim().length > 200)
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
    if (!ids) return
    // Wait for the SPA résumé panel to render before committing to this profile.
    if (!isReady() && Date.now() - firstSeen < READY_TIMEOUT) return
    if (seen.has(ids.applicantId)) return
    seen.add(ids.applicantId)

    try {
      const detail = scrapeDetail()
      if (detail.raw_text && detail.raw_text.length > 80) {
        const res = await sendMessageAsync({
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
        })
        console.log('[Recruitimation/Profile] Enriched', ids.applicantId, res?.result ?? res)
      }

      const pdfUrl = findPdfUrl()
      if (pdfUrl) {
        try {
          // Download using the recruiter's active session — only reaches PDFs
          // the logged-in account is already authorised to see.
          const res = await fetch(pdfUrl, { credentials: 'include' })
          if (!res.ok) throw new Error(`PDF HTTP ${res.status}`)
          const blob = await res.blob()
          const base64 = await blobToBase64(blob)
          const resp = await sendMessageAsync({
            type: 'INGEST_PDF',
            payload: {
              source: 'indeed',
              source_id: ids.applicantId,
              base64,
              mimetype: blob.type || 'application/pdf',
            },
          })
          console.log('[Recruitimation/Profile] PDF uploaded', resp?.result ?? resp)
        } catch (e) {
          console.warn('[Recruitimation/Profile] PDF download/upload failed:', e.message)
        }
      } else {
        console.log('[Recruitimation/Profile] No resume PDF found on this page')
      }
    } finally {
      // Always tell the auto-iterate controller this profile is done so it can
      // advance (no-op when no controller is running).
      sendMessageAsync({ type: 'PROFILE_DONE', source_id: ids.applicantId })
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
