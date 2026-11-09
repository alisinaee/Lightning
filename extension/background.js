// Lightning's browser extension: hands downloads to the desktop app over 127.0.0.1.
// The same file runs as a service worker (Chromium) and a background script (Firefox).
const api = typeof browser !== 'undefined' ? browser : chrome
// Texts (Firefox loads i18n.js from the manifest's scripts list; a Chromium service worker imports it).
if (typeof importScripts === 'function') importScripts('i18n.js')
const I18N = self.LightningI18n

const PORTS = [17891, 17892, 17893, 17894, 17895, 17896, 17897, 17898, 17899, 17900]
const DEFAULTS = { enabled: true, key: '', minSizeMB: 0, excluded: '', videoCookies: 'save' }

let cachedPort = null
// What the app said at its last ping (its version and the extension version it carries).
let lastPing = null
// The language for menus and notifications: Lightning's setting, else the browser's, else English.
let lang = 'en'
const uiLanguage = () => {
  try {
    return api.i18n.getUILanguage()
  } catch {
    return navigator.language
  }
}
const tr = (key, vars) => I18N.t(lang, key, vars)

/** Picks the language from what Lightning last reported (kept in storage as `lang`). */
async function loadLang() {
  const { lang: saved } = await api.storage.local.get({ lang: '' })
  lang = I18N.pick(saved, uiLanguage())
}
const langReady = loadLang()
// Links the browser is allowed to download itself (the app was not there to take them).
const letThrough = new Set()

/** The key Lightning wrote beside these files when it set them up ('' when there is none). */
async function bundledKey() {
  try {
    const response = await fetch(api.runtime.getURL('pairing.json'), { cache: 'no-store' })
    if (!response.ok) return ''
    const { key } = await response.json()
    return typeof key === 'string' && /^[0-9a-f]{64}$/.test(key) ? key : ''
  } catch {
    return ''
  }
}

async function settings() {
  const saved = { ...DEFAULTS, ...(await api.storage.local.get(DEFAULTS)) }
  if (!saved.key) {
    // Pairs by itself when Lightning put its key here: nothing to paste.
    const key = await bundledKey()
    if (key) {
      await api.storage.local.set({ key })
      saved.key = key
    }
  }
  return saved
}

/** After Lightning made a new key it rewrites pairing.json: picks that up. True when it changed. */
async function repair(oldKey) {
  const key = await bundledKey()
  if (!key || key === oldKey) return false
  await api.storage.local.set({ key })
  return true
}

/** Finds the port Lightning answers on; null when the app is not running. */
async function findPort(force = false) {
  if (cachedPort && !force) return cachedPort
  for (const port of cachedPort ? [cachedPort, ...PORTS] : PORTS) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/ping`, {
        signal: AbortSignal.timeout(800)
      })
      if (response.ok) {
        const info = await response.json()
        if (info.app === 'Lightning') {
          cachedPort = port
          lastPing = info
          return port
        }
      }
    } catch {
      // Nothing on this port.
    }
  }
  cachedPort = null
  return null
}

/** Keeps Lightning's language (when /v1/config reports one) for the menus, popup and select bar. */
async function rememberLanguage(code) {
  const next = I18N.norm(code)
  const { lang: saved } = await api.storage.local.get({ lang: '' })
  if (next !== saved) await api.storage.local.set({ lang: next })
  lang = I18N.pick(next, uiLanguage())
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
    const config = await response.json()
    await rememberLanguage(config.language)
    return { ...all, ...config }
  } catch {
    return all
  }
}

const MENU_TITLES = {
  'lightning-download': 'm_download',
  'lightning-youtube': 'm_youtube',
  'lightning-select': 'm_select',
  'lightning-near': 'm_near',
  'lightning-clipboard': 'm_clip'
}

/** Shows or hides the right-click items to match Settings. */
async function refreshMenus() {
  await langReady
  const on = await features()
  const update = (id, visible) =>
    api.contextMenus.update(id, { visible, title: tr(MENU_TITLES[id]) }).catch(() => {})
  update('lightning-download', on.menuDownload)
  update('lightning-youtube', on.menuDownload)
  update('lightning-select', on.menuScan)
  update('lightning-near', on.menuScan)
  update('lightning-clipboard', on.menuScan)
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
    if (response.status === 401) {
      await repair(key)
      return 'key'
    }
    return response.ok ? 'ok' : 'error'
  } catch {
    cachedPort = null
    return 'down'
  }
}

/** Whether the key is right, without sending a link: 'ok', 'key', 'down' or 'error'. */
async function checkKey(retried = false) {
  const { key } = await settings()
  const port = await findPort()
  if (!port) return 'down'
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/auth`, {
      headers: { Authorization: `Bearer ${key}` }
    })
    if (response.status === 401) return !retried && (await repair(key)) ? checkKey(true) : 'key'
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
  if (result === 'down') return tr('p_down')
  if (result === 'key') return tr('p_key')
  if (result === 'off') return tr('p_off')
  if (result === 'nothing') return tr('p_nothing')
  return tr('p_fail')
}

function notify(message) {
  api.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon.png',
    title: 'Lightning',
    message
  })
}

/** Whether the address is a YouTube page (the app also checks; this only decides what is sent along). */
function isYoutubeHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')
  } catch {
    return false
  }
}

/** The cookies a YouTube page needs, as the Video cookies setting in the popup allows them. */
async function youtubeCookies(url) {
  // Downloads from the browser always keep the sign-in in Lightning, so pasted links work too.
  // An older 'send' setting counts as 'save'.
  const { videoCookies } = await settings()
  const mode = videoCookies === 'none' || videoCookies === 'saved' ? videoCookies : 'save'
  if (mode !== 'save') return { cookieMode: mode }
  try {
    const cookies = (await api.cookies.getAll({ url })).map((cookie) => ({
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expirationDate: cookie.expirationDate,
      name: cookie.name,
      value: cookie.value
    }))
    return { cookieMode: mode, cookies }
  } catch {
    return { cookieMode: mode, cookies: [] }
  }
}

/** Hands one link over, with the page it came from and the cookies the browser holds for it. */
async function handOver(url, referrer, extra = {}) {
  const payload = {
    url,
    referer: referrer || undefined,
    cookie: (await cookieHeader(url)) || undefined,
    userAgent: navigator.userAgent,
    ...(isYoutubeHost(url) ? await youtubeCookies(url) : {}),
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

// Right-click menu, five items (Scan was merged into Select; see the select mode in page-select.js).
api.runtime.onInstalled.addListener(async () => {
  await langReady
  // A link, video, audio or image: the app takes it (a YouTube link goes to the YouTube downloader).
  api.contextMenus.create({
    id: 'lightning-download',
    title: tr(MENU_TITLES['lightning-download']),
    contexts: ['link', 'video', 'audio', 'image']
  })
  // A YouTube page: the app sends it to the YouTube downloader.
  api.contextMenus.create({
    id: 'lightning-youtube',
    title: tr(MENU_TITLES['lightning-youtube']),
    contexts: ['page'],
    documentUrlPatterns: [
      'https://www.youtube.com/*',
      'https://m.youtube.com/*',
      'https://youtu.be/*'
    ]
  })
  // Pick several links and videos on any page.
  api.contextMenus.create({
    id: 'lightning-select',
    title: tr(MENU_TITLES['lightning-select']),
    contexts: ['page', 'frame']
  })
  // The selected links, or the link group around the spot right-clicked.
  api.contextMenus.create({
    id: 'lightning-near',
    title: tr(MENU_TITLES['lightning-near']),
    contexts: ['page', 'frame', 'selection']
  })
  // Whatever links the person copied (a separate group: it does not depend on the spot clicked).
  api.contextMenus.create({
    id: 'lightning-clipboard',
    title: tr(MENU_TITLES['lightning-clipboard']),
    contexts: ['page', 'frame', 'editable']
  })
})

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
    if (response.status === 401) {
      await repair(key)
      return 'key'
    }
    return response.ok ? 'ok' : 'error'
  } catch {
    cachedPort = null
    return 'down'
  }
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  const on = await refreshMenus()
  if (info.menuItemId === 'lightning-select') {
    if (on.menuScan) await startSelect(tab, info.frameId)
    return
  }
  if (info.menuItemId === 'lightning-clipboard') {
    if (on.menuScan) {
      const result = await sendClipboard()
      if (result !== 'ok') notify(problem(result))
    }
    return
  }
  if (info.menuItemId === 'lightning-near') {
    if (!on.menuScan) return
    // Text selected on the page: its links. Otherwise the group around the spot right-clicked.
    if (info.selectionText) {
      const chosen = await selectedLinks(tab, info.frameId)
      if (chosen.length > 0) {
        const sent = await sendLinksToLightning(chosen, tab?.url)
        if (sent !== 'ok') notify(problem(sent))
        return
      }
    }
    await linksNearClick(tab, info.frameId)
    return
  }
  if (info.menuItemId === 'lightning-youtube') {
    if (!on.menuDownload || !info.pageUrl) return
    const result = await handOver(info.pageUrl, tab?.url)
    if (result !== 'ok') notify(problem(result))
    return
  }
  if (!on.menuDownload) return
  // A link, video or image under the mouse. On a bare page only a YouTube page is taken: the app then
  // sends it to the YouTube downloader; other pages say what to right-click.
  const isAddress = (value) => !!value && /^(https?:|magnet:)/i.test(value)
  const url = [info.linkUrl, info.srcUrl].find(isAddress)
  if (!url) {
    notify(tr('n_rightclick'))
    return
  }
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

/** Asks the app to take the links on the clipboard: one goes to the Add dialog, several to the list. */
async function sendClipboard() {
  const { key } = await settings()
  const port = await findPort()
  if (!port) return 'down'
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/clipboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: '{}'
    })
    if (response.status === 401) {
      await repair(key)
      return 'key'
    }
    if (response.status === 403) return 'off'
    if (response.status === 400) return 'nothing'
    return response.ok ? 'ok' : 'error'
  } catch {
    cachedPort = null
    return 'down'
  }
}

/** Downloads the links of the group the person right-clicked (a "copy links" button's list). */
async function linksNearClick(tab, frameId) {
  if (!tab?.id) return
  let links = []
  try {
    const reply = await api.tabs.sendMessage(
      tab.id,
      { type: 'links-near' },
      frameId != null ? { frameId } : undefined
    )
    links = Array.isArray(reply?.links) ? reply.links : []
  } catch {
    notify(tr('n_cantread'))
    return
  }
  if (links.length === 0) {
    notify(tr('n_nolinks'))
    return
  }
  const result =
    links.length === 1
      ? await handOver(links[0], tab.url)
      : await sendLinksToLightning(links, tab.url)
  if (result !== 'ok') notify(problem(result))
}

/** Turns select mode on in the page (any site). The page script is injected only when asked. */
async function startSelect(tab, frameId) {
  if (!tab?.id) return
  try {
    await api.scripting.executeScript({
      target: frameId ? { tabId: tab.id, frameIds: [frameId] } : { tabId: tab.id },
      files: ['i18n.js', 'page-select.js']
    })
  } catch {
    notify(tr('n_cantselect'))
  }
}

/** Sends the videos the select mode picked to Lightning's YouTube downloader, as one batch. */
async function sendYoutubeBatch(videos) {
  const { key } = await settings()
  const port = await findPort()
  if (!port) return { result: 'down' }
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/youtube-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ videos: videos.slice(0, 200) })
    })
    if (response.status === 401) {
      await repair(key)
      return { result: 'key' }
    }
    if (response.status === 403) return { result: 'off' }
    if (!response.ok) return { result: 'error' }
    const body = await response.json().catch(() => ({}))
    return { result: 'ok', started: body.started ?? videos.length }
  } catch {
    cachedPort = null
    return { result: 'down' }
  }
}

// The popup asks for the app's state.
api.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === 'youtube-batch') {
    sendYoutubeBatch(Array.isArray(message.videos) ? message.videos : []).then((outcome) =>
      respond({ ...outcome, message: problem(outcome.result) })
    )
    return true
  }
  if (message?.type === 'status') {
    refreshMenus()
    findPort(true).then(async (port) =>
      respond({
        port,
        paired: !!(await settings()).key,
        version: lastPing?.version ?? null,
        // The extension version Lightning carries (older Lightning versions do not say).
        bundledVersion: lastPing?.extensionVersion ?? null,
        language: (await api.storage.local.get({ lang: '' })).lang
      })
    )
    return true
  }
  // Re-reads pairing.json (the popup's "Re-pair automatically"): true when the key changed.
  if (message?.type === 'repair') {
    settings().then(async ({ key }) => respond({ changed: await repair(key) }))
    return true
  }
  // The popup's "Scan this page".
  if (message?.type === 'scan-page') {
    startSelect({ id: message.tabId }).then(() => respond({ ok: true }))
    return true
  }
  if (message?.type === 'test') {
    checkKey().then((result) => respond({ result }))
    return true
  }
  // The select mode on a page sends its picked links here (the page cannot reach the app itself).
  if (message?.type === 'send-links') {
    const links = Array.isArray(message.links)
      ? message.links.filter((link) => /^https?:/i.test(link))
      : []
    sendLinksToLightning(links, _sender?.tab?.url).then((result) =>
      respond({ result, message: problem(result) })
    )
    return true
  }
  return false
})
