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
