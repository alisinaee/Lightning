// Lightning's browser extension: hands downloads to the desktop app over 127.0.0.1.
// The same file runs as a service worker (Chromium) and a background script (Firefox).
const api = typeof browser !== 'undefined' ? browser : chrome

const PORTS = [17891, 17892, 17893, 17894, 17895, 17896, 17897, 17898, 17899, 17900]
const DEFAULTS = { enabled: true, key: '', minSizeMB: 0, excluded: '' }

let cachedPort = null
// Links the browser is allowed to download itself (the app was not there to take them).
const letThrough = new Set()

async function settings() {
  return { ...DEFAULTS, ...(await api.storage.local.get(DEFAULTS)) }
}

/** Finds the port Lightning answers on; null when the app is not running. */
async function findPort(force = false) {
  if (cachedPort && !force) return cachedPort
  for (const port of cachedPort ? [cachedPort, ...PORTS] : PORTS) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/ping`, {
        signal: AbortSignal.timeout(800)
      })
      if (response.ok && (await response.json()).app === 'Lightning') {
        cachedPort = port
        return port
      }
    } catch {
      // Nothing on this port.
    }
  }
  cachedPort = null
  return null
}

/** Which features Lightning's Settings has on; all on when it cannot be asked (an older Lightning). */
async function features() {
  const all = { capture: true, menuDownload: true, menuScan: true }
  const { key } = await settings()
  const port = await findPort()
  if (!port || !key) return all
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/config`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(1500)
    })
    if (!response.ok) return all
    return { ...all, ...(await response.json()) }
  } catch {
    return all
  }
}

/** Shows or hides the right-click items to match Settings. */
async function refreshMenus() {
  const on = await features()
  const update = (id, visible) => api.contextMenus.update(id, { visible }).catch(() => {})
  update('lightning-download', on.menuDownload)
  update('lightning-scan', on.menuScan)
  return on
}
refreshMenus()

/** Sends a link to Lightning. Resolves 'ok', or why not: 'down' (app not running), 'key' (not
 * paired or the key is old), 'error'. */
async function sendToLightning(payload) {
  const { key } = await settings()
  const port = await findPort()
  if (!port) return 'down'
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload)
    })
    if (response.status === 401) return 'key'
    return response.ok ? 'ok' : 'error'
  } catch {
    cachedPort = null
    return 'down'
  }
}

/** Whether the key is right, without sending a link: 'ok', 'key', 'down' or 'error'. */
async function checkKey() {
  const { key } = await settings()
  const port = await findPort()
  if (!port) return 'down'
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/auth`, {
      headers: { Authorization: `Bearer ${key}` }
    })
    if (response.status === 401) return 'key'
    return response.ok ? 'ok' : 'error'
  } catch {
    return 'down'
  }
}

async function cookieHeader(url) {
  try {
    const cookies = await api.cookies.getAll({ url })
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
  } catch {
    return ''
  }
}

function problem(result) {
  if (result === 'down') return 'Lightning is not running.'
  if (result === 'key')
    return 'Pair the extension with Lightning: open its popup and paste the key.'
  return 'Lightning could not take the link.'
}

function notify(message) {
  api.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon.png',
    title: 'Lightning',
    message
  })
}

/** Hands one link over, with the page it came from and the cookies the browser holds for it. */
async function handOver(url, referrer, extra = {}) {
  const payload = {
    url,
    referer: referrer || undefined,
    cookie: (await cookieHeader(url)) || undefined,
    userAgent: navigator.userAgent,
    ...extra
  }
  return sendToLightning(payload)
}

function excluded(url, list) {
  const host = new URL(url).hostname.toLowerCase()
  return list
    .split(/[\s,]+/)
    .filter(Boolean)
    .some((entry) => host === entry.toLowerCase() || host.endsWith(`.${entry.toLowerCase()}`))
}

// Every download the browser starts: cancelled, and given to Lightning if it is paired and there.
api.downloads.onCreated.addListener(async (item) => {
  const url = item.finalUrl || item.url
  if (!/^https?:/i.test(url)) return
  if (letThrough.delete(url) || letThrough.delete(item.url)) return
  const options = await settings()
  if (!options.enabled || !options.key) return
  if (!(await features()).capture) return
  if (excluded(url, options.excluded)) return
  if (
    options.minSizeMB > 0 &&
    item.totalBytes > 0 &&
    item.totalBytes < options.minSizeMB * 1048576
  ) {
    return
  }
  const result = await handOver(url, item.referrer, { source: 'download' })
  if (result === 'ok') {
    // Lightning has it: the browser's own copy is stopped and forgotten.
    await api.downloads.cancel(item.id).catch(() => {})
    await api.downloads.erase({ id: item.id }).catch(() => {})
    return
  }
  // Not taken: the browser carries on with the download it started.
  if (result !== 'down') notify(problem(result))
})

// Right-click → Download with Lightning.
api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({
    id: 'lightning-download',
    title: 'Download with Lightning',
    contexts: ['link', 'video', 'audio', 'image']
  })
  api.contextMenus.create({
    id: 'lightning-scan',
    title: 'Scan this page with Lightning',
    contexts: ['page', 'frame', 'selection']
  })
})

/** Every link and media address on the page the person is looking at, as the browser sees it
 * (so pages that build their links with JavaScript work too). Runs inside the page. */
function collectLinks() {
  const found = new Set()
  for (const element of document.querySelectorAll('a[href], source[src], video[src], audio[src], [data-href], [data-url], [data-download]')) {
    for (const name of ['href', 'src', 'data-href', 'data-url', 'data-download']) {
      const value = element.getAttribute(name)
      if (!value) continue
      try {
        found.add(new URL(value, document.baseURI).href)
      } catch {
        // Not an address.
      }
    }
  }
  return [...found]
}

/** The links inside what the person has selected on the page (several files selected in a
 * listing, say). Runs inside the page. */
function collectSelectedLinks() {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return []
  const found = new Set()
  for (const element of document.querySelectorAll('a[href]')) {
    if (selection.containsNode(element, true)) {
      try {
        found.add(new URL(element.getAttribute('href'), document.baseURI).href)
      } catch {
        // Not an address.
      }
    }
  }
  return [...found]
}

async function selectedLinks(tab, frameId) {
  if (!tab?.id) return []
  try {
    const results = await api.scripting.executeScript({
      target: frameId ? { tabId: tab.id, frameIds: [frameId] } : { tabId: tab.id },
      func: collectSelectedLinks
    })
    return results.flatMap((entry) => entry.result ?? [])
  } catch {
    return []
  }
}

async function scanPage(tab, frameId) {
  if (!tab?.id) return
  let links = []
  try {
    const results = await api.scripting.executeScript({
      target: frameId ? { tabId: tab.id, frameIds: [frameId] } : { tabId: tab.id },
      func: collectLinks
    })
    links = results.flatMap((entry) => entry.result ?? [])
  } catch {
    notify('Lightning cannot read this page.')
    return
  }
  const pageUrl = tab.url
  const result = await sendLinksToLightning(links, pageUrl)
  if (result !== 'ok') notify(problem(result))
}

/** Sends the links of a page to Lightning's several-links dialog. */
async function sendLinksToLightning(links, pageUrl) {
  const { key } = await settings()
  const port = await findPort()
  if (!port) return 'down'
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        links,
        referer: pageUrl,
        cookie: (pageUrl && (await cookieHeader(pageUrl))) || undefined,
        userAgent: navigator.userAgent
      })
    })
    if (response.status === 401) return 'key'
    return response.ok ? 'ok' : 'error'
  } catch {
    cachedPort = null
    return 'down'
  }
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  const on = await refreshMenus()
  if (info.menuItemId === 'lightning-scan') {
    if (on.menuScan) await scanPage(tab, info.frameId)
    return
  }
  if (!on.menuDownload) return
  const url = info.linkUrl || info.srcUrl
  if (!url || !/^(https?:|magnet:)/i.test(url)) return
  // Several links selected, and the click is on one of them: all of them are offered together.
  if (info.linkUrl) {
    const chosen = await selectedLinks(tab, info.frameId)
    if (chosen.length > 1 && chosen.includes(info.linkUrl)) {
      const sent = await sendLinksToLightning(chosen, info.pageUrl || tab?.url)
      if (sent !== 'ok') notify(problem(sent))
      return
    }
  }
  const result = await handOver(url, info.pageUrl || tab?.url)
  if (result !== 'ok') notify(problem(result))
})

// The popup asks for the app's state.
api.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === 'status') {
    refreshMenus()
    findPort(true).then(async (port) => respond({ port, paired: !!(await settings()).key }))
    return true
  }
  if (message?.type === 'test') {
    checkKey().then((result) => respond({ result }))
    return true
  }
  return false
})
