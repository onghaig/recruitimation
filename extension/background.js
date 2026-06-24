/**
 * Recruitimation — Background service worker
 *
 * Receives INGEST messages from content scripts and POSTs to the API.
 * Also handles popup requests for sync status.
 */

import { ingest, enrich, uploadPdfBySource } from './utils/api.js'

// ── State ─────────────────────��──────────────────────���─────────────────────
let syncStats = {
  total: 0,
  lastSync: null,
  lastError: null,
}

// ── Message handler ────────────────────────────────────────────────��────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'INGEST') {
    handleIngest(message.payload)
      .then((result) => {
        syncStats.total += result.ingested ?? 0
        syncStats.lastSync = new Date().toISOString()
        syncStats.lastError = null
        sendResponse({ ok: true, result })
      })
      .catch((err) => {
        console.error('[Recruitimation/Background] Ingest failed:', err.message)
        syncStats.lastError = err.message
        sendResponse({ ok: false, error: err.message })
      })
    // Return true to keep channel open for async response
    return true
  }

  if (message.type === 'ENRICH') {
    enrich(message.payload)
      .then((result) => {
        syncStats.lastSync = new Date().toISOString()
        syncStats.lastError = null
        sendResponse({ ok: true, result })
      })
      .catch((err) => {
        console.error('[Recruitimation/Background] Enrich failed:', err.message)
        syncStats.lastError = err.message
        sendResponse({ ok: false, error: err.message })
      })
    return true
  }

  if (message.type === 'INGEST_PDF') {
    uploadPdfBySource(message.payload)
      .then((result) => {
        syncStats.lastSync = new Date().toISOString()
        syncStats.lastError = null
        sendResponse({ ok: true, result })
      })
      .catch((err) => {
        console.error('[Recruitimation/Background] PDF upload failed:', err.message)
        syncStats.lastError = err.message
        sendResponse({ ok: false, error: err.message })
      })
    return true
  }

  if (message.type === 'GET_STATS') {
    sendResponse({ ok: true, stats: syncStats })
    return false
  }

  if (message.type === 'SET_API_URL') {
    chrome.storage.sync.set({ apiUrl: message.url }, () => {
      sendResponse({ ok: true })
    })
    return true
  }

  // ── Auto-ingest controller ─────────────────────────────────────────────────
  if (message.type === 'START_AUTO_INGEST') {
    const items = message.items || []
    if (auto.running) {
      sendResponse({ ok: false, error: 'Auto-ingest already running' })
    } else if (items.length === 0) {
      sendResponse({ ok: false, error: 'No candidates to ingest' })
    } else {
      runAutoIngest(items)
      sendResponse({ ok: true, total: items.length })
    }
    return false
  }

  if (message.type === 'CANCEL_AUTO_INGEST') {
    auto.cancelled = true
    if (auto.resolveStep) auto.resolveStep()
    sendResponse({ ok: true })
    return false
  }

  if (message.type === 'GET_AUTO_PROGRESS') {
    sendResponse({ ok: true, running: auto.running, done: auto.done, total: auto.total })
    return false
  }

  if (message.type === 'PROFILE_DONE') {
    if (auto.running && message.source_id === auto.currentSourceId && auto.resolveStep) {
      auto.resolveStep()
    }
    return false
  }
})

// ── Auto-iterate: walk each candidate profile in one driver tab ──────────────
// Sequential + delayed + DOM-only, per the project's ban-mitigation guidance.
let auto = {
  running: false,
  cancelled: false,
  tabId: null,
  items: [],
  done: 0,
  total: 0,
  currentSourceId: null,
  resolveStep: null,
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const randDelayMs = () => 1500 + Math.floor(Math.random() * 1500) // 1.5–3s

// Wait until indeed_profile.js reports PROFILE_DONE for the current profile, or
// a hard timeout (covers pages that fail to render / signal).
function waitForStep(timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    let timer = null
    const finish = () => {
      if (settled) return
      settled = true
      auto.resolveStep = null
      clearTimeout(timer)
      resolve()
    }
    auto.resolveStep = finish
    timer = setTimeout(finish, timeoutMs)
  })
}

async function runAutoIngest(items) {
  auto = {
    running: true,
    cancelled: false,
    tabId: null,
    items,
    done: 0,
    total: items.length,
    currentSourceId: null,
    resolveStep: null,
  }
  console.log(`[Recruitimation/Auto] Starting — ${items.length} candidates`)

  try {
    // Start with a blank driver tab, then navigate per-item inside the loop so
    // currentSourceId is always set before the profile can report PROFILE_DONE.
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true })
    auto.tabId = tab.id

    for (let i = 0; i < items.length; i++) {
      if (auto.cancelled) break
      auto.currentSourceId = items[i].source_id
      try {
        await chrome.tabs.update(auto.tabId, { url: items[i].url })
      } catch (e) {
        console.warn('[Recruitimation/Auto] Tab navigation failed:', e.message)
        break
      }
      // Profile script waits up to ~12s for render, so allow a little more here.
      await waitForStep(20000)
      auto.done = i + 1
      if (auto.cancelled) break
      if (i < items.length - 1) await sleep(randDelayMs())
    }
  } catch (e) {
    console.error('[Recruitimation/Auto] Failed:', e.message)
  } finally {
    if (auto.tabId != null) {
      try { await chrome.tabs.remove(auto.tabId) } catch { /* tab already gone */ }
    }
    console.log(
      `[Recruitimation/Auto] ${auto.cancelled ? 'Cancelled' : 'Finished'} — ${auto.done}/${auto.total}`
    )
    auto.running = false
    auto.currentSourceId = null
    auto.tabId = null
  }
}

async function handleIngest(payload) {
  console.log(
    `[Recruitimation/Background] Ingesting ${payload.candidates.length} candidates from ${payload.source}`
  )
  return ingest(payload)
}

console.log('[Recruitimation/Background] Service worker started')
