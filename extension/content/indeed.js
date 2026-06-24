/**
 * Recruitimation — Indeed content script
 *
 * Target: employers.indeed.com/jobs/:jobId/applicants
 *
 * Reads the applicant list DOM and POSTs candidates to /api/ingest.
 * Uses data-testid selectors where possible (more stable than class names).
 * Also sets up a MutationObserver with 500 ms debounce to handle SPA navigation.
 */

;(function () {
  'use strict'

  // ── Selectors ─────────────────────────────────────────────────────────────
  const CARD_SELECTOR      = '[data-testid="applicant-card"]'
  const NAME_SELECTOR      = '[data-testid="applicant-name"]'
  const TITLE_SELECTOR     = '[data-testid="applicant-headline"]'
  const SNIPPET_SELECTOR   = '[data-testid="resume-snippet"]'
  const LOCATION_SELECTOR  = '[data-testid="applicant-location"]'
  const UPDATED_SELECTOR   = '[data-testid="resume-updated"]'
  // href shape: /applicants/12345 or /jobs/12345/applicants/67890
  const LINK_SELECTOR      = 'a[href*="/applicants/"]'

  // ── Helpers ────────────────────────────────────────────────────────────────
  function extractApplicantId(href) {
    if (!href) return null
    const match = href.match(/\/applicants\/([^/?#]+)/)
    return match ? match[1] : null
  }

  function extractJobId() {
    // URL shape: /jobs/:jobId/applicants or /job/:jobId
    const match = location.pathname.match(/\/jobs?\/([^/]+)/)
    return match ? match[1] : null
  }

  function scrapeApplicants() {
    const cards = [...document.querySelectorAll(CARD_SELECTOR)]
    return cards.map((card) => {
      const link = card.querySelector(LINK_SELECTOR)
      return {
        source_id:   extractApplicantId(link?.getAttribute('href')),
        name:        card.querySelector(NAME_SELECTOR)?.innerText.trim() ?? null,
        title:       card.querySelector(TITLE_SELECTOR)?.innerText.trim() ?? null,
        snippet:     card.querySelector(SNIPPET_SELECTOR)?.innerText.trim() ?? null,
        location:    card.querySelector(LOCATION_SELECTOR)?.innerText.trim() ?? null,
        last_active: card.querySelector(UPDATED_SELECTOR)?.innerText.trim() ?? null,
      }
    }).filter((c) => c.source_id || c.name)
  }

  // ── Ingest ─────────────────────────────────────────────────────────────────
  let lastPosted = new Set()

  async function runScrape() {
    // Only run on applicant list pages
    if (!location.pathname.includes('/applicants')) return

    const candidates = scrapeApplicants()
    if (candidates.length === 0) {
      console.log('[Recruitimation/Indeed] No candidates found on page')
      return
    }

    // Deduplicate against what we already sent this session
    const fresh = candidates.filter(
      (c) => c.source_id && !lastPosted.has(c.source_id)
    )
    if (fresh.length === 0) {
      console.log('[Recruitimation/Indeed] All candidates already posted this session')
      return
    }

    const platform_job_id = extractJobId()
    console.log(
      `[Recruitimation/Indeed] Scraping ${fresh.length} candidates for job ${platform_job_id}`
    )

    // Send to background worker which holds the API URL config
    chrome.runtime.sendMessage({
      type: 'INGEST',
      payload: {
        source: 'indeed',
        platform_job_id,
        candidates: fresh,
      },
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Recruitimation/Indeed] Message error:', chrome.runtime.lastError.message)
        return
      }
      if (response?.ok) {
        fresh.forEach((c) => c.source_id && lastPosted.add(c.source_id))
        console.log(
          `[Recruitimation/Indeed] Posted ${fresh.length} candidates →`,
          response.result
        )
      } else {
        console.error('[Recruitimation/Indeed] Ingest error:', response?.error)
      }
    })
  }

  // ── MutationObserver with 500 ms debounce ──────────────────────────────────
  let debounceTimer = null

  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(runScrape, 500)
  })

  // Observe the body so we catch SPA navigations that swap out the list
  observer.observe(document.body, { childList: true, subtree: true })

  // Run immediately on load
  runScrape()
})()
