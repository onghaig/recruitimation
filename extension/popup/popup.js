/**
 * Recruitimation — Popup script
 */

const $ = (id) => document.getElementById(id)

// ── Load saved settings ────────────────────────────────────────────────────
chrome.storage.sync.get(['apiUrl'], (result) => {
  const url = result.apiUrl ?? 'http://localhost:3000'
  $('api-url').value = url
  $('open-app').href = url
  checkApiStatus(url)
})

// ── Load sync stats ────────────────────────────────────────────────────────
chrome.runtime.sendMessage({ type: 'GET_STATS' }, (response) => {
  if (chrome.runtime.lastError || !response?.ok) return
  const { stats } = response

  $('stat-total').textContent = stats.total ?? 0

  if (stats.lastSync) {
    const d = new Date(stats.lastSync)
    $('stat-last').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } else {
    $('stat-last').textContent = 'Never'
  }
})

// ── Save button ────────────────────────────────────────────────────────────
$('save-btn').addEventListener('click', () => {
  const url = $('api-url').value.trim().replace(/\/$/, '')
  if (!url) {
    showMsg('Enter a valid URL', 'error')
    return
  }

  chrome.runtime.sendMessage({ type: 'SET_API_URL', url }, (response) => {
    if (response?.ok) {
      $('open-app').href = url
      showMsg('Saved!', 'success')
      checkApiStatus(url)
    } else {
      showMsg('Save failed', 'error')
    }
  })
})

// ── API health check ───────────────────────────────────────��───────────────
// ── Auto-ingest all candidates ───────────────────────────────────────────────
const autoBtn = $('auto-btn')
const autoCancel = $('auto-cancel')
const autoTrack = $('auto-track')
const autoBar = $('auto-bar')
const autoHint = $('auto-hint')
let progressTimer = null

function setAutoRunning(running) {
  autoBtn.style.display = running ? 'none' : 'block'
  autoCancel.style.display = running ? 'block' : 'none'
  autoTrack.style.display = running ? 'block' : 'none'
}

function renderProgress(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0
  autoBar.style.width = `${pct}%`
  autoHint.textContent = `${done} / ${total} profiles processed`
}

function pollProgress() {
  clearInterval(progressTimer)
  progressTimer = setInterval(() => {
    chrome.runtime.sendMessage({ type: 'GET_AUTO_PROGRESS' }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) return
      renderProgress(res.done, res.total)
      if (!res.running) {
        clearInterval(progressTimer)
        setAutoRunning(false)
        autoHint.textContent = `Done — ${res.done} / ${res.total} profiles processed`
      }
    })
  }, 1500)
}

autoBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0]
    if (!tab?.id) return
    requestProfileQueue(tab, false)
  })
})

// Ask the candidates-list content script for the profile queue. If the script
// isn't present (SPA navigation to /candidates never triggers a document-load
// injection), inject it on demand and retry once.
function requestProfileQueue(tab, injected) {
  chrome.tabs.sendMessage(tab.id, { type: 'GET_PROFILE_QUEUE' }, (res) => {
    if (chrome.runtime.lastError || !res?.ok) {
      if (!injected && /^https:\/\/employers\.indeed\.com\/candidates/.test(tab.url || '')) {
        chrome.scripting.executeScript(
          { target: { tabId: tab.id }, files: ['content/indeed_candidates.js'] },
          () => {
            if (chrome.runtime.lastError) {
              autoHint.textContent = 'Could not access this page. Reload and try again.'
              return
            }
            requestProfileQueue(tab, true)
          }
        )
        return
      }
      autoHint.textContent = 'Open an Indeed candidates list first.'
      return
    }
    const items = res.items || []
    if (items.length === 0) {
      autoHint.textContent = 'No candidates found on this page.'
      return
    }
    chrome.runtime.sendMessage({ type: 'START_AUTO_INGEST', items }, (startRes) => {
      if (chrome.runtime.lastError || !startRes?.ok) {
        autoHint.textContent = startRes?.error ?? 'Could not start.'
        return
      }
      setAutoRunning(true)
      renderProgress(0, startRes.total)
      pollProgress()
    })
  })
}

autoCancel.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CANCEL_AUTO_INGEST' }, () => {
    void chrome.runtime.lastError
  })
})

// If an auto-ingest is already running when the popup opens, resume the view.
chrome.runtime.sendMessage({ type: 'GET_AUTO_PROGRESS' }, (res) => {
  if (chrome.runtime.lastError || !res?.ok) return
  if (res.running) {
    setAutoRunning(true)
    renderProgress(res.done, res.total)
    pollProgress()
  }
})

async function checkApiStatus(url) {
  const el = $('stat-status')
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) })
    if (res.ok) {
      el.innerHTML = '<span class="dot green"></span>Connected'
    } else {
      el.innerHTML = `<span class="dot red"></span>Error ${res.status}`
    }
  } catch {
    el.innerHTML = '<span class="dot red"></span>Unreachable'
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function showMsg(text, type) {
  const el = $('msg')
  el.textContent = text
  el.className = `status ${type}`
  el.style.display = 'block'
  setTimeout(() => { el.style.display = 'none' }, 2500)
}
