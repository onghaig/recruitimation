/**
 * Recruitimation — Indeed *job detail* scraper
 *
 * Injected on demand by the popup (chrome.scripting.executeScript) when the
 * recruiter clicks "Scrape job details" while viewing a job's page on Indeed.
 * Reads the job title / description / location / pay and returns them in
 * response to a GET_JOB_DETAILS message, so the popup can attach them to the
 * backend job and trigger re-scoring.
 *
 * Not a static manifest content script: Indeed's job-page URL varies, so the
 * popup injects this on whatever job page the recruiter happens to be on.
 *
 * NOTE: the SELECTORS below are best-effort and must be confirmed against the
 * live job page — if the description comes back empty, inspect the page DOM and
 * pin the right selectors.
 */

;(function () {
  'use strict'

  // Guard against double-init: the popup injects this on every click, and the
  // listener would otherwise stack.
  if (window.__recruitimationJobInit) return
  window.__recruitimationJobInit = true

  // ── Selectors (best-effort; tune against the live page) ─────────────────────
  const TITLE_SELECTORS = [
    '[data-testid="job-title"]',
    '[data-testid="JobTitle"]',
    '[class*="jobTitle" i]',
    'h1',
  ]
  const DESCRIPTION_SELECTORS = [
    '[data-testid="job-description"]',
    '[data-testid="jobDescriptionText"]',
    '[id*="jobDescription" i]',
    '[class*="jobDescription" i]',
    '[class*="job-description" i]',
  ]
  const LOCATION_SELECTORS = [
    '[data-testid="job-location"]',
    '[class*="jobLocation" i]',
    '[class*="location" i]',
  ]
  const PAY_SELECTORS = [
    '[data-testid="job-salary"]',
    '[class*="salary" i]',
    '[class*="pay" i]',
  ]

  // ── Helpers ──────────────────────────────────────────────────────────────��─
  function firstText(selectors, { max = 200 } = {}) {
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      const t = el?.innerText?.trim()
      if (t && t.length <= max) return t
    }
    return null
  }

  function extractTitle() {
    const t = firstText(TITLE_SELECTORS, { max: 120 })
    if (t) return t
    const dt = (document.title || '').split('|')[0].split(' - ')[0].trim()
    return dt && !/^candidates$/i.test(dt) ? dt : null
  }

  function extractDescription() {
    for (const sel of DESCRIPTION_SELECTORS) {
      const el = document.querySelector(sel)
      const t = el?.innerText?.trim()
      if (t && t.length > 40) return t.slice(0, 20000)
    }
    // Fallback: the largest text container on the page (main/article), which on
    // a job page is almost always the description body.
    const containers = [...document.querySelectorAll('main, article, [role="main"]')]
    let best = ''
    for (const c of containers) {
      const t = c.innerText?.trim() ?? ''
      if (t.length > best.length) best = t
    }
    return best.length > 40 ? best.slice(0, 20000) : null
  }

  // Pull a job id off the page URL if present (?id=, ?jobId=, or /jobs/:id/),
  // used as a matching fallback when no target job is selected in the popup.
  function extractPlatformJobId() {
    const params = new URLSearchParams(location.search)
    const fromQuery = params.get('id') || params.get('jobId') || params.get('jk')
    if (fromQuery) return fromQuery
    const m = location.pathname.match(/\/jobs?\/([^/?#]+)/)
    return m ? m[1] : null
  }

  function scrapeJob() {
    return {
      title: extractTitle(),
      description: extractDescription(),
      location: firstText(LOCATION_SELECTORS, { max: 120 }),
      payRange: firstText(PAY_SELECTORS, { max: 120 }),
      platform_job_id: extractPlatformJobId(),
    }
  }

  // ── Popup → scraper: hand back the job details ───────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'GET_JOB_DETAILS') {
      sendResponse({ ok: true, ...scrapeJob() })
      return false
    }
    return false
  })
})()
