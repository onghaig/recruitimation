/**
 * Recruitimation — Indeed *candidates* content script
 *
 * Target: employers.indeed.com/candidates?id=:legacyJobId&...   (the unified
 * candidate list that replaced the per-job /jobs/:id/applicants page)
 *
 * The list is a table: each row is [data-testid="table-row"] and the candidate
 * link [data-testid="NameCell"] carries both the candidate id (?id=) and the
 * job id (&legacyJobId=). Posts candidates to /api/ingest via the background
 * worker, using the same payload shape as the legacy indeed.js list scraper.
 *
 * The detail page /candidates/view is handled by indeed_profile.js, so this
 * script explicitly skips it.
 */

;(function () {
  'use strict'

  // Guard against double-init: the popup injects this script on demand when SPA
  // navigation lands on /candidates without a document load, and the static
  // manifest injection may also have run. Re-running would stack a second
  // MutationObserver and message listener.
  if (window.__recruitimationCandidatesInit) return
  window.__recruitimationCandidatesInit = true

  // ── Selectors ─────────────────────────────────────────────────────────────
  const ROW_SELECTOR      = '[data-testid="table-row"]'
  const NAME_SELECTOR     = '[data-testid="NameCell"]'        // <a role="link" href="/candidates/view?id=...">
  const LOCATION_SELECTOR = '[data-testid="CandidateInfoColumn-location"]'
  const APPLY_SELECTOR    = '[data-testid="CandidateInfoColumn-apply"]' // e.g. "Applied Jun 13"

  // ── Helpers ────────────────────────────────────────────────────────────────
  function getParam(href, key) {
    if (!href) return null
    try {
      return new URL(href, location.origin).searchParams.get(key)
    } catch {
      return null
    }
  }

  function extractJobId() {
    // Prefer legacyJobId off a row link; fall back to the list URL's ?id= param.
    const link = document.querySelector(`${ROW_SELECTOR} ${NAME_SELECTOR}`)
    const fromRow = getParam(link?.getAttribute('href'), 'legacyJobId')
    return fromRow ?? new URLSearchParams(location.search).get('id')
  }

  // Best-effort job title so an auto-created job is named (e.g. "Mailroom Clerk")
  // instead of "indeed job <id>". Tries a few likely headers, then the page
  // <title> with the site/section noise stripped. Returns null if nothing usable.
  function extractJobTitle() {
    const SELECTORS = [
      '[data-testid="job-title"]',
      '[data-testid="JobTitle"]',
      '[class*="jobTitle"]',
      'h1',
    ]
    for (const sel of SELECTORS) {
      const t = document.querySelector(sel)?.innerText?.trim()
      if (t && t.length <= 120) return t
    }
    const dt = (document.title || '').split('|')[0].split(' - ')[0].trim()
    return dt && !/^candidates$/i.test(dt) ? dt : null
  }

  // Build the queue of profile pages for the background auto-iterator. Uses the
  // full NameCell href (keeps listQuery/legacyJobId params so the profile renders
  // when navigated to directly).
  function buildProfileQueue() {
    const rows = [...document.querySelectorAll(ROW_SELECTOR)]
    const seen = new Set()
    const items = []
    for (const row of rows) {
      const href = row.querySelector(NAME_SELECTOR)?.getAttribute('href')
      const source_id = getParam(href, 'id')
      if (!href || !source_id || seen.has(source_id)) continue
      seen.add(source_id)
      items.push({ source_id, url: new URL(href, location.origin).href })
    }
    return { jobId: extractJobId(), items }
  }

  function scrapeCandidates() {
    const rows = [...document.querySelectorAll(ROW_SELECTOR)]
    return rows.map((row) => {
      const link = row.querySelector(NAME_SELECTOR)
      const href = link?.getAttribute('href')
      return {
        source_id:   getParam(href, 'id'),
        name:        link?.innerText.trim() ?? null,
        location:    row.querySelector(LOCATION_SELECTOR)?.innerText.trim() ?? null,
        last_active: row.querySelector(APPLY_SELECTOR)?.innerText.trim() ?? null,
      }
    }).filter((c) => c.source_id || c.name)
  }

  // ── Ingest ─────────────────────────────────────────────────────────────────
  let lastPosted = new Set()

  async function runScrape() {
    // Only run on the candidate *list*; the detail page is /candidates/view.
    if (location.pathname !== '/candidates') return

    const candidates = scrapeCandidates()
    if (candidates.length === 0) {
      console.log('[Recruitimation/Candidates] No candidates found on page')
      return
    }

    // Deduplicate against what we already sent this session
    const fresh = candidates.filter(
      (c) => c.source_id && !lastPosted.has(c.source_id)
    )
    if (fresh.length === 0) {
      console.log('[Recruitimation/Candidates] All candidates already posted this session')
      return
    }

    const platform_job_id = extractJobId()
    console.log(
      `[Recruitimation/Candidates] Scraping ${fresh.length} candidates for job ${platform_job_id}`
    )

    // Send to background worker which holds the API URL config
    chrome.runtime.sendMessage({
      type: 'INGEST',
      payload: {
        source: 'indeed',
        platform_job_id,
        platform_job_title: extractJobTitle(),
        candidates: fresh,
      },
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Recruitimation/Candidates] Message error:', chrome.runtime.lastError.message)
        return
      }
      if (response?.ok) {
        fresh.forEach((c) => c.source_id && lastPosted.add(c.source_id))
        console.log(
          `[Recruitimation/Candidates] Posted ${fresh.length} candidates →`,
          response.result
        )
      } else {
        console.error('[Recruitimation/Candidates] Ingest error:', response?.error)
      }
    })
  }

  // ── Popup → controller: hand over the profile queue ────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'GET_PROFILE_QUEUE') {
      // Make sure the list rows have been ingested (candidates must exist before
      // the per-profile enrich runs), then return the queue.
      runScrape()
      sendResponse({ ok: true, ...buildProfileQueue() })
      return false
    }
    return false
  })

  // ── MutationObserver with 500 ms debounce ──────────────────────────────────
  let debounceTimer = null

  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(runScrape, 500)
  })

  // Observe the body so we catch SPA navigations that swap out the table
  observer.observe(document.body, { childList: true, subtree: true })

  // Run immediately on load
  runScrape()
})()
