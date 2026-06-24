/**
 * Recruitimation — LinkedIn content script
 *
 * Strategy: inject interceptor.js into the page context to proxy
 * XMLHttpRequest / fetch (can't do this from the isolated content-script world).
 * The interceptor posts messages back here via window.postMessage,
 * then we forward to the background service worker.
 */

;(function () {
  'use strict'

  // ── Inject interceptor into page context ───────────────────────────────────
  function injectInterceptor() {
    const script = document.createElement('script')
    script.src = chrome.runtime.getURL('interceptor.js')
    script.onload = () => script.remove()
    ;(document.head ?? document.documentElement).appendChild(script)
    console.log('[Recruitimation/LinkedIn] Interceptor injected')
  }

  injectInterceptor()

  // Enable dev logging in the interceptor
  if (process?.env?.NODE_ENV === 'development') {
    const devScript = document.createElement('script')
    devScript.textContent = 'window.__recruitimation_dev = true'
    document.documentElement.appendChild(devScript)
    devScript.remove()
  }

  // ── Listen for candidate batches from interceptor ──────────────────────────
  window.addEventListener('message', (event) => {
    if (
      event.source !== window ||
      event.data?.type !== 'RECRUITIMATION_CANDIDATES'
    ) {
      return
    }

    const { candidates } = event.data
    if (!Array.isArray(candidates) || candidates.length === 0) return

    console.log(
      `[Recruitimation/LinkedIn] Received ${candidates.length} candidates from interceptor`
    )

    chrome.runtime.sendMessage(
      {
        type: 'INGEST',
        payload: {
          source: 'linkedin',
          candidates,
        },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            '[Recruitimation/LinkedIn] Message error:',
            chrome.runtime.lastError.message
          )
          return
        }
        if (response?.ok) {
          console.log('[Recruitimation/LinkedIn] Ingested:', response.result)
        } else {
          console.error('[Recruitimation/LinkedIn] Ingest error:', response?.error)
        }
      }
    )
  })

  console.log('[Recruitimation/LinkedIn] Content script loaded')
})()
