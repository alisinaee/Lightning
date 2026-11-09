const api = typeof browser !== 'undefined' ? browser : chrome
const DEFAULTS = { enabled: true, key: '', minSizeMB: 0, excluded: '', videoCookies: 'save' }
const $ = (id) => document.getElementById(id)

async function load() {
  const saved = { ...DEFAULTS, ...(await api.storage.local.get(DEFAULTS)) }
  $('enabled').checked = saved.enabled
  $('key').value = saved.key
  $('minSizeMB').value = saved.minSizeMB
  $('excluded').value = saved.excluded
  // Downloads always save the sign-in in Lightning now; an older 'send' setting shows as 'save'.
  $('videoCookies').value = saved.videoCookies === 'send' ? 'save' : saved.videoCookies
}

async function refresh() {
  const status = $('status')
  const state = await api.runtime.sendMessage({ type: 'status' })
  status.className = 'status'
  if (!state.port) {
    status.textContent = 'Lightning is not running.'
    status.classList.add('bad')
  } else if (!state.paired) {
    status.textContent = 'Lightning found. Paste its pairing key below.'
  } else {
    const { result } = await api.runtime.sendMessage({ type: 'test' })
    status.textContent =
      result === 'key' ? 'The pairing key is not right.' : 'Connected to Lightning.'
    status.classList.add(result === 'key' ? 'bad' : 'ok')
  }
}

$('save').addEventListener('click', async () => {
  await api.storage.local.set({
    enabled: $('enabled').checked,
    key: $('key').value.trim(),
    minSizeMB: Math.max(0, Number($('minSizeMB').value) || 0),
    excluded: $('excluded').value,
    videoCookies: $('videoCookies').value
  })
  await refresh()
})

// The status check pairs from pairing.json first, so the key field shows the key it found.
refresh().then(load)
