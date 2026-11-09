const api = typeof browser !== 'undefined' ? browser : chrome
const DEFAULTS = { enabled: true, key: '', minSizeMB: 0, excluded: '', videoCookies: 'save' }
const $ = (id) => document.getElementById(id)
const I18N = window.LightningI18n

let lang = I18N.pick('', api.i18n?.getUILanguage?.() || navigator.language)
let state = 'checking'
let version = null
let activeTab = null

const t = (key, vars) => I18N.t(lang, key, vars)

/** Writes every translated text and sets the page direction (Persian reads right to left). */
function applyLang() {
  document.documentElement.lang = lang
  document.documentElement.dir = I18N.dir(lang)
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n)
  for (const node of document.querySelectorAll('[data-i18n-ph]'))
    node.placeholder = t(node.dataset.i18nPh)
  renderStatus()
}

function renderStatus() {
  $('card').dataset.state = state
  const titles = {
    checking: ['checking', null],
    down: ['down_t', 'down_h'],
    unpaired: ['unpaired_t', 'unpaired_h'],
    badkey: ['badkey_t', 'badkey_h'],
    ok: ['ok_t', null]
  }
  const [title, hint] = titles[state]
  $('st-title').textContent = t(title)
  $('st-hint').textContent = state === 'ok' ? (version ? t('ok_h', { v: version }) : '') : hint ? t(hint) : ''
  $('st-hint').hidden = !$('st-hint').textContent
  $('retry').hidden = state !== 'down'
  $('repair').hidden = state !== 'badkey'
  $('manual').hidden = state !== 'unpaired' && state !== 'badkey'
  $('scan').disabled = state !== 'ok' || !activeTab || !/^https?:/i.test(activeTab.url || '')
  $('yt').hidden = !(activeTab && isYoutube(activeTab.url))
  $('yt').disabled = state !== 'ok'
  $('ver').textContent = `v${api.runtime.getManifest().version}`
}

function isYoutube(url) {
  try {
    return new URL(url).hostname === 'www.youtube.com'
  } catch {
    return false
  }
}

async function load() {
  const saved = { ...DEFAULTS, ...(await api.storage.local.get(DEFAULTS)) }
  $('enabled').checked = saved.enabled
  $('key').value = saved.key
  $('minSizeMB').value = saved.minSizeMB
  $('excluded').value = saved.excluded
  // Downloads always save the sign-in in Lightning now; an older 'send' setting shows as 'save'.
  $('videoCookies').value = saved.videoCookies === 'send' ? 'save' : saved.videoCookies
}

/** Asks the background what it finds; the check pairs from pairing.json first. */
async function refresh() {
  state = 'checking'
  renderStatus()
  const info = await api.runtime.sendMessage({ type: 'status' })
  version = info.version || null
  if (!info.port) {
    state = 'down'
  } else if (!info.paired) {
    state = 'unpaired'
  } else {
    const { result } = await api.runtime.sendMessage({ type: 'test' })
    state = result === 'key' ? 'badkey' : result === 'ok' ? 'ok' : 'down'
  }
  // Lightning's language wins over the browser's once it has told us (see /v1/config).
  const language = info.language || (await api.storage.local.get({ lang: '' })).lang
  lang = I18N.pick(language, api.i18n?.getUILanguage?.() || navigator.language)
  applyLang()
  // A different extension version in Lightning's folder than the one running here: reload it.
  const running = api.runtime.getManifest().version
  $('update').hidden = !(info.bundledVersion && info.bundledVersion !== running)
  await load()
}

async function save(fields) {
  await api.storage.local.set(fields)
  $('saved').hidden = false
  setTimeout(() => ($('saved').hidden = true), 1500)
}

$('enabled').addEventListener('change', () => api.storage.local.set({ enabled: $('enabled').checked }))

$('save').addEventListener('click', () =>
  save({
    minSizeMB: Math.max(0, Number($('minSizeMB').value) || 0),
    excluded: $('excluded').value,
    videoCookies: $('videoCookies').value
  })
)

$('save-key').addEventListener('click', async () => {
  await api.storage.local.set({ key: $('key').value.trim() })
  await refresh()
})

$('retry').addEventListener('click', refresh)

$('repair').addEventListener('click', async () => {
  const { changed } = await api.runtime.sendMessage({ type: 'repair' })
  if (changed) return refresh()
  $('repair-msg').textContent = t('repair_none')
  $('repair-msg').hidden = false
})

$('scan').addEventListener('click', async () => {
  if (!activeTab) return
  await api.runtime.sendMessage({ type: 'scan-page', tabId: activeTab.id })
  window.close()
})

$('yt').addEventListener('click', async () => {
  if (!activeTab) return
  try {
    await api.tabs.sendMessage(activeTab.id, { type: 'youtube-select' })
  } catch {
    // The page was open before the extension: put the script in, then switch the mode on.
    await api.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ['i18n.js', 'youtube-select.js']
    })
    await api.tabs.sendMessage(activeTab.id, { type: 'youtube-select' })
  }
  window.close()
})

async function start() {
  applyLang()
  try {
    ;[activeTab] = await api.tabs.query({ active: true, currentWindow: true })
  } catch {
    activeTab = null
  }
  await load()
  await refresh()
}
start()
