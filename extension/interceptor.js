/**
 * Recruitimation — LinkedIn XHR/fetch interceptor
 *
 * This file runs in the PAGE context (not the extension isolated world)
 * so it can proxy XMLHttpRequest and window.fetch.
 *
 * It forwards parsed candidate data to the content script via postMessage.
 */

;(function () {
  'use strict'

  const TARGET_PATTERNS = [
    '/voyager/api/talent',
    '/voyager/api/search',
    '/voyager/api/graphql',
  ]

  function matchesTarget(url) {
    return TARGET_PATTERNS.some((p) => url.includes(p))
  }

  /**
   * Try to extract candidate profiles from a LinkedIn Voyager API response.
   * LinkedIn's schema changes over time — we log raw JSON in dev mode to help track it.
   */
  function extractCandidates(data) {
    const results = []

    // Walk all values recursively looking for profile-shaped objects
    function walk(obj, depth = 0) {
      if (!obj || typeof obj !== 'object' || depth > 12) return
      if (Array.isArray(obj)) {
        obj.forEach((item) => walk(item, depth + 1))
        return
      }

      // Heuristic: objects with firstName OR publicIdentifier are profile nodes
      const hasFirstName = 'firstName' in obj || 'first_name' in obj
      const hasId = 'profileId' in obj || 'publicIdentifier' in obj || 'entityUrn' in obj
      if (hasFirstName || hasId) {
        const candidate = {
          source_id:
            obj.profileId ??
            obj.publicIdentifier ??
            obj.entityUrn?.replace(/.*:/, '') ??
            null,
          name: [obj.firstName ?? obj.first_name, obj.lastName ?? obj.last_name]
            .filter(Boolean)
            .join(' ') || null,
          title: obj.headline ?? obj.occupation ?? null,
          location: obj.locationName ?? obj.geoLocationName ?? obj.location ?? null,
          snippet: obj.summary ?? null,
        }
        if (candidate.source_id || candidate.name) {
          results.push(candidate)
        }
      }

      Object.values(obj).forEach((v) => walk(v, depth + 1))
    }

    walk(data)

    // Deduplicate by source_id
    const seen = new Set()
    return results.filter((c) => {
      const key = c.source_id ?? c.name
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  function handleResponseText(url, text) {
    let data
    try {
      data = JSON.parse(text)
    } catch {
      return // not JSON
    }

    if (window.__recruitimation_dev) {
      console.log('[Recruitimation/Interceptor] Raw response from', url, data)
    }

    const candidates = extractCandidates(data)
    if (candidates.length === 0) return

    console.log(`[Recruitimation/Interceptor] Extracted ${candidates.length} profiles from`, url)

    window.postMessage(
      { type: 'RECRUITIMATION_CANDIDATES', source: 'linkedin', candidates },
      '*'
    )
  }

  // ── Proxy fetch ────────────────────────────────────────────────────────────
  const originalFetch = window.fetch
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? ''
    const response = await originalFetch.apply(this, args)

    if (matchesTarget(url)) {
      // Clone so the original stream is still readable
      response
        .clone()
        .text()
        .then((text) => handleResponseText(url, text))
        .catch(() => {})
    }

    return response
  }

  // ── Proxy XMLHttpRequest ───────────────────────────────────────────────────
  const OriginalXHR = XMLHttpRequest
  const originalOpen = OriginalXHR.prototype.open

  OriginalXHR.prototype.open = function (method, url, ...rest) {
    this._recruitimationUrl = url
    return originalOpen.call(this, method, url, ...rest)
  }

  const originalSend = OriginalXHR.prototype.send
  OriginalXHR.prototype.send = function (...args) {
    const url = this._recruitimationUrl ?? ''
    if (matchesTarget(url)) {
      this.addEventListener('load', () => {
        if (this.status >= 200 && this.status < 300) {
          handleResponseText(url, this.responseText)
        }
      })
    }
    return originalSend.apply(this, args)
  }

  console.log('[Recruitimation/Interceptor] Installed on LinkedIn page context')
})()
