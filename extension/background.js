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
})

async function handleIngest(payload) {
  console.log(
    `[Recruitimation/Background] Ingesting ${payload.candidates.length} candidates from ${payload.source}`
  )
  return ingest(payload)
}

console.log('[Recruitimation/Background] Service worker started')
