// Lightning's browser extension: hands downloads to the desktop app over 127.0.0.1.
// The same file runs as a service worker (Chromium) and a background script (Firefox).
const api = typeof browser !== 'undefined' ? browser : chrome
// Texts and the video finder (Firefox loads them from the manifest's scripts list; a Chromium service
// worker imports them).
if (typeof importScripts === 'function') importScripts('i18n.js', 'media.js')
const I18N = self.LightningI18n
const MEDIA = self.LightningMedia

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

/** Lightning carries a newer extension than the one running: loads the files on disk again, once per
 * version (a copy that was not refreshed on disk stays as it is). */
async function reloadIfNewer(version) {
  const parts = (value) => value.split('.').map(Number)
  if (typeof version !== 'string' || !/^\d+(\.\d+)*$/.test(version)) return
  const [theirs, ours] = [parts(version), parts(api.runtime.getManifest().version)]
  const at = theirs.findIndex((part, index) => part !== (ours[index] ?? 0))
  if (at < 0 || theirs[at] < (ours[at] ?? 0)) return
  const { reloadedFor } = await api.storage.local.get({ reloadedFor: '' })
  if (reloadedFor === version) return
  await api.storage.local.set({ reloadedFor: version })
  // After what is being sent has gone out.
  setTimeout(() => api.runtime.reload(), 5000)
}

/** Finds the port Lightning answers on; null when the app is not running. */
async function findPort(force = false) {
  if (cachedPort && !force) return cachedPort
  const order = cachedPort ? [cachedPort, ...PORTS.filter((port) => port !== cachedPort)] : PORTS
  for (const port of order) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/ping`, {
        signal: AbortSignal.timeout(800)
      })
      if (response.ok) {
        const info = await response.json()
        if (info.app === 'Lightning') {
          cachedPort = port
          lastPing = info
          reloadIfNewer(info.extensionVersion)
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

// The features answer is kept for half a minute: the menus and every download ask for it.
const FEATURES_TTL_MS = 30000
let featuresCache = null
let featuresAt = 0

/** Which features Lightning's Settings has on; all on when it cannot be asked (an older Lightning). */
async function features() {
  if (featuresCache && Date.now() - featuresAt < FEATURES_TTL_MS) return featuresCache
  featuresCache = await loadFeatures()
  featuresAt = Date.now()
  return featuresCache
}

async function loadFeatures() {
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
  'lightning-clipboard': 'm_clip',
  'lightning-video': 'm_video'
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
  update('lightning-video', on.menuDownload)
  return on
}

// Lightning registers the lightning:// scheme: opening it starts the app when it is closed.
const APP_LINK = 'lightning://open'
const APP_WAIT_MS = 20000
let launching = null

/** Starts Lightning when it is not running and waits until it answers. Resolves its port, or null
 * when it did not come up in time. One start at a time. */
function launchApp() {
  if (launching) return launching
  launching = (async () => {
    const running = await findPort(true)
    if (running) return running
    // The browser asks (once) whether to open Lightning. That prompt belongs to this tab, so the tab
    // is active while it is up and is closed only after the app answers, never before.
    let tab
    try {
      tab = await api.tabs.create({ url: APP_LINK, active: true })
    } catch {
      // The browser refused the link (no app registered for it): nothing more to try.
      return null
    }
    const closeTab = () => {
      if (tab?.id != null) api.tabs.remove(tab.id).catch(() => {})
    }
    const until = Date.now() + APP_WAIT_MS
    while (Date.now() < until) {
      await new Promise((done) => setTimeout(done, 500))
      const port = await findPort(true)
      if (port) {
        closeTab()
        return port
      }
    }
    closeTab()
    return null
  })().finally(() => {
    launching = null
  })
  return launching
}

/** Posts to one of the app's routes, starting the app when it is closed. A stale port (the app was
 * restarted) or an old key is put right and tried once more. `result` is 'ok', or why not: 'down' (app
 * not running and could not be started), 'key' (not paired), 'off' (off in Settings), 'nothing' (no
 * links on the clipboard), 'error'. `body` is the app's answer. */
async function callApp(path, payload, retried = false) {
  const { key } = await settings()
  const port = (await findPort()) || (await launchApp())
  if (!port) return { result: 'down' }
  let response
  try {
    response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    })
  } catch {
    cachedPort = null
    return retried ? { result: 'down' } : callApp(path, payload, true)
  }
  if (response.status === 401) {
    if (!retried && (await repair(key))) return callApp(path, payload, true)
    return { result: 'key' }
  }
  if (response.status === 403) return { result: 'off' }
  if (!response.ok) return { result: 'error', status: response.status }
  return { result: 'ok', body: await response.json().catch(() => ({})) }
}

async function postToApp(path, payload) {
  return (await callApp(path, payload)).result
}

/** Sends a link to Lightning. Resolves 'ok', or why not (see postToApp). */
function sendToLightning(payload) {
  return postToApp('/v1/add', payload)
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

/** How a video's cookies are sent, as the Video cookies setting in the popup allows: 'save' (YouTube
 * only, kept in Lightning), 'send' (this download only; every other site), 'saved' or 'none'. */
async function videoCookieMode(url) {
  // An older 'send' setting counts as 'save' for YouTube.
  const { videoCookies } = await settings()
  if (videoCookies === 'none' || videoCookies === 'saved') return videoCookies
  return isYoutubeHost(url) ? 'save' : 'send'
}

/** The cookies the browser holds for these addresses, merged, in the shape the app reads. */
async function cookiesFor(urls) {
  const seen = new Map()
  for (const url of urls) {
    try {
      for (const cookie of await api.cookies.getAll({ url })) {
        const key = `${cookie.domain}|${cookie.path}|${cookie.name}`
        if (seen.has(key)) continue
        seen.set(key, {
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          expirationDate: cookie.expirationDate,
          name: cookie.name,
          value: cookie.value
        })
      }
    } catch {
      // No cookies for this address.
    }
  }
  return [...seen.values()]
}

/** The cookie fields a video link carries: the mode, and the cookies when they are sent. */
async function youtubeCookies(url) {
  const mode = await videoCookieMode(url)
  if (mode !== 'save' && mode !== 'send') return { cookieMode: mode }
  return { cookieMode: mode, cookies: await cookiesFor([url]) }
}

// Lightning cannot call the extension, so the extension asks it what it wants: every half minute,
// and when the browser starts. Today that is only a fresh YouTube sign-in, for downloads that
// stopped on one. Asking never starts the app.
const REQUESTS_ALARM = 'lightning-requests'

async function checkRequests() {
  const { enabled, key } = await settings()
  if (!enabled || !key) return
  const port = await findPort()
  if (!port) return
  let wants
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/requests`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(2000)
    })
    if (!response.ok) return
    wants = await response.json()
  } catch {
    cachedPort = null
    return
  }
  if (wants?.youtubeCookies) await sendFreshYoutubeSignIn()
}

/** The browser's YouTube cookies, as the Video cookies setting allows. With sharing off, an empty
 * answer tells Lightning at once to show its usual sign-in fix instead of waiting. */
async function sendFreshYoutubeSignIn() {
  const mode = await videoCookieMode('https://www.youtube.com/')
  const share = mode === 'save' || mode === 'send'
  const cookies = share ? await cookiesFor(['https://www.youtube.com/']) : []
  await callApp('/v1/cookies', { mode: share ? mode : 'none', cookies })
}

api.alarms.create(REQUESTS_ALARM, { periodInMinutes: 0.5 })
api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REQUESTS_ALARM) checkRequests()
})
api.runtime.onStartup.addListener(() => checkRequests())
api.runtime.onStartup.addListener(() => refreshMenus())

/** Hands one link over, with the page it came from and the cookies the browser holds for it. */
async function handOver(url, referrer, extra = {}) {
  const payload = {
    url,
    referer: referrer || undefined,
    cookie: (await cookieHeader(url)) || undefined,
    userAgent: navigator.userAgent,
    ...(isYoutubeHost(url) || MEDIA.isStreamLink(url) ? await youtubeCookies(url) : {}),
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
  // Items of an earlier version are replaced: one that is left would keep its old places.
  await new Promise((done) => api.contextMenus.removeAll(() => done()))
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
  // The video on any web page: the app looks for it there, with this page's cookies.
  api.contextMenus.create({
    id: 'lightning-video',
    title: tr(MENU_TITLES['lightning-video']),
    contexts: ['page', 'frame'],
    documentUrlPatterns: ['http://*/*', 'https://*/*']
  })
  await refreshMenus()
})

// Pages already open get the page scripts too: theirs stopped answering when the extension was loaded.
api.runtime.onInstalled.addListener(async () => {
  const tabs = await api.tabs.query({ url: ['http://*/*', 'https://*/*'] }).catch(() => [])
  for (const tab of tabs) {
    if (!tab.id || tab.discarded) continue
    const files = /^https:\/\/www\.youtube\.com\//i.test(tab.url || '')
      ? ['context-capture.js', 'i18n.js', 'youtube-select.js']
      : ['context-capture.js']
    api.scripting.executeScript({ target: { tabId: tab.id }, files }).catch(() => {})
  }
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
  return postToApp('/v1/links', {
    links,
    referer: pageUrl,
    cookie: (pageUrl && (await cookieHeader(pageUrl))) || undefined,
    userAgent: navigator.userAgent
  })
}

/** The YouTube video an address stands for, as a plain watch or Shorts page; null when it is none. */
function youtubeVideo(value) {
  const embedded = /^https:\/\/www\.youtube-nocookie\.com\/embed\//i.test(value || '')
  if (!embedded && !isYoutubeHost(value)) return null
  const url = new URL(value)
  const [, kind, part] = url.pathname.split('/')
  const id =
    url.hostname.toLowerCase() === 'youtu.be'
      ? kind
      : kind === 'watch'
        ? url.searchParams.get('v')
        : ['shorts', 'embed', 'live'].includes(kind)
          ? part
          : null
  if (!id || !/^[\w-]{6,}$/.test(id)) return null
  return kind === 'shorts'
    ? `https://www.youtube.com/shorts/${id}`
    : `https://www.youtube.com/watch?v=${id}`
}

/** The YouTube video right-clicked: the player's own (theater and full screen too), an embedded one,
 * or the preview that plays over a card in a list. */
async function clickedYoutubeVideo(info, tab) {
  const frame = youtubeVideo(info.frameUrl) || youtubeVideo(info.pageUrl) || youtubeVideo(tab?.url)
  if (tab?.id && isYoutubeHost(tab.url || info.pageUrl)) {
    try {
      const reply = await api.tabs.sendMessage(
        tab.id,
        { type: 'video-near' },
        { frameId: info.frameId ?? 0 }
      )
      const near = youtubeVideo(reply?.url)
      if (near) return near
    } catch {
      // The page was open before the extension: its address is all there is.
    }
  }
  return frame
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  await langReady
  const on = await features()
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
  if (info.menuItemId === 'lightning-video') {
    if (!on.menuDownload) return
    const page = info.pageUrl || tab?.url
    if (!isHttpAddress(page)) return
    const result = await sendVideoPage(page, tab?.title, page)
    if (result !== 'ok') notify(problem(result))
    return
  }
  if (info.menuItemId === 'lightning-youtube') {
    if (!on.menuDownload || !info.pageUrl) return
    // The video alone, without the list or mix it plays from.
    const result = await handOver(youtubeVideo(info.pageUrl) || info.pageUrl, tab?.url)
    if (result !== 'ok') notify(problem(result))
    return
  }
  if (!on.menuDownload) return
  // A <video> whose source is a blob (a player's own stream) cannot be downloaded itself: the page is sent.
  if (info.mediaType === 'video' && !isHttpAddress(info.srcUrl)) {
    const youtube = await clickedYoutubeVideo(info, tab)
    if (youtube) {
      const result = await handOver(youtube, youtube)
      if (result !== 'ok') notify(problem(result))
      return
    }
    const page = info.pageUrl || tab?.url
    if (!isHttpAddress(page)) return
    const result = await sendVideoPage(page, tab?.title, page)
    if (result !== 'ok') notify(problem(result))
    return
  }
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
  const { result, status } = await callApp('/v1/clipboard', {})
  return status === 400 ? 'nothing' : result
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

/** Turns select mode on in the page: YouTube's own on YouTube, links on any other site. The page script
 * is injected only when asked. */
async function startSelect(tab, frameId) {
  if (!tab?.id) return
  try {
    if (!frameId && /^https:\/\/(www|m)\.youtube\.com\//i.test(tab.url || '')) {
      await startYoutubeSelect(tab.id)
      return
    }
    await api.scripting.executeScript({
      target: frameId ? { tabId: tab.id, frameIds: [frameId] } : { tabId: tab.id },
      files: ['i18n.js', 'page-select.js']
    })
  } catch {
    notify(tr('n_cantselect'))
  }
}

async function startYoutubeSelect(tabId) {
  const message = { type: 'youtube-select', on: true }
  try {
    await api.tabs.sendMessage(tabId, message, { frameId: 0 })
  } catch {
    // The page was open before the extension: put the script in, then switch the mode on.
    await api.scripting.executeScript({
      target: { tabId },
      files: ['i18n.js', 'youtube-select.js']
    })
    await api.tabs.sendMessage(tabId, message, { frameId: 0 })
  }
}

/** Sends the videos the select mode picked to Lightning's YouTube downloader, as one batch. */
async function sendYoutubeBatch(videos) {
  const { result, body } = await callApp('/v1/youtube-batch', { videos: videos.slice(0, 200) })
  return result === 'ok' ? { result, started: body.started ?? videos.length } : { result }
}

/** Whether an address is a web address (http or https). */
function isHttpAddress(value) {
  return !!value && /^https?:\/\//i.test(value)
}

// ---- Videos on a page. What the page's responses carried, kept per tab until the page changes.
// Session storage where the browser has it (Chromium, Firefox 115+); memory otherwise.
let memoryVideos = {}
let videoWrites = Promise.resolve()
const sessionStore = () => api.storage?.session ?? null

async function readVideos() {
  const store = sessionStore()
  if (!store) return memoryVideos
  try {
    const { videos } = await store.get({ videos: {} })
    return videos && typeof videos === 'object' ? videos : {}
  } catch {
    return memoryVideos
  }
}

/** Changes the video lists one write at a time, so two responses cannot overwrite each other. */
function changeVideos(change) {
  videoWrites = videoWrites
    .then(async () => {
      const videos = await readVideos()
      // A change that finds nothing to do returns false: nothing is written.
      if (change(videos) === false) return
      memoryVideos = videos
      const store = sessionStore()
      if (store) await store.set({ videos }).catch(() => {})
    })
    .catch(() => {})
  return videoWrites
}

function showBadge(tabId, count) {
  try {
    const action = api.action || api.browserAction
    const pending = action?.setBadgeText({ tabId, text: count > 0 ? String(count) : '' })
    if (pending?.catch) pending.catch(() => {})
  } catch {
    // This browser shows no badge for the tab.
  }
}

function forgetVideos(tabId) {
  let forgotten = false
  return changeVideos((videos) => {
    if (!videos[String(tabId)]) return false
    delete videos[String(tabId)]
    forgotten = true
  }).then(() => {
    if (forgotten) showBadge(tabId, 0)
  })
}

const MEDIA_URLS = ['http://*/*', 'https://*/*']
const headerOf = (headers, name) =>
  (headers || []).find((header) => header.name.toLowerCase() === name)?.value

if (api.webRequest?.onResponseStarted) {
  // A video is noticed as its response starts; the body is never read.
  api.webRequest.onResponseStarted.addListener(
    (details) => {
      if (details.tabId < 0) return
      const found = MEDIA.classify({
        url: details.url,
        tabId: details.tabId,
        statusCode: details.statusCode,
        contentType: headerOf(details.responseHeaders, 'content-type'),
        contentLength: headerOf(details.responseHeaders, 'content-length'),
        contentRange: headerOf(details.responseHeaders, 'content-range')
      })
      if (!found) return
      const key = String(details.tabId)
      let count = 0
      changeVideos((videos) => {
        videos[key] = MEDIA.addEntry(videos[key] || [], found)
        count = videos[key].length
      }).then(() => showBadge(details.tabId, count))
    },
    { urls: MEDIA_URLS, types: ['media', 'xmlhttprequest', 'other'] },
    ['responseHeaders']
  )
  // A new page in the tab: the videos of the old one are forgotten.
  api.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.tabId >= 0) forgetVideos(details.tabId)
    },
    { urls: MEDIA_URLS, types: ['main_frame'] }
  )
}
api.tabs.onRemoved.addListener((tabId) => {
  forgetVideos(tabId)
})

/** The cookies of a video and of the page it is on, merged, for the app's video dialog. */
async function sendVideoPage(url, title, pageUrl) {
  const mode = await videoCookieMode(url)
  const cookies =
    mode === 'save' || mode === 'send'
      ? await cookiesFor([...new Set([url, pageUrl].filter(Boolean))])
      : []
  return postToApp('/v1/video', {
    url,
    title: title || undefined,
    pageUrl: pageUrl || undefined,
    referer: pageUrl || undefined,
    userAgent: navigator.userAgent,
    cookieMode: mode,
    cookies
  })
}

/** One video of the popup's list: a file goes to the downloader, a stream to the video dialog. */
async function sendVideoEntry(entry, pageUrl, title) {
  if (!entry || !isHttpAddress(entry.url)) return 'error'
  if (entry.stream) return sendVideoPage(entry.url, title, pageUrl)
  return handOver(entry.url, pageUrl)
}

// The popup asks for the app's state.
api.runtime.onMessage.addListener((message, _sender, respond) => {
  // The videos the page's responses carried (for the popup's list).
  if (message?.type === 'videos') {
    readVideos().then((videos) =>
      respond({ videos: MEDIA.sortEntries(videos[String(message.tabId)] || []) })
    )
    return true
  }
  if (message?.type === 'video-send') {
    sendVideoEntry(message.entry, message.pageUrl, message.title).then((result) =>
      respond({ result, message: result === 'ok' ? tr('v_sent') : problem(result) })
    )
    return true
  }
  // The popup's "Find video on this page": the page itself goes to the video dialog.
  if (message?.type === 'video-find') {
    const page = isHttpAddress(message.pageUrl) ? message.pageUrl : ''
    if (!page) return false
    sendVideoPage(page, message.title, page).then((result) =>
      respond({ result, message: result === 'ok' ? tr('v_sent') : problem(result) })
    )
    return true
  }
  if (message?.type === 'youtube-batch') {
    sendYoutubeBatch(Array.isArray(message.videos) ? message.videos : []).then((outcome) =>
      respond({ ...outcome, message: problem(outcome.result) })
    )
    return true
  }
  // The popup's Retry when Lightning is closed: starts it, then the popup checks again.
  if (message?.type === 'launch') {
    launchApp().then((port) => respond({ port }))
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
  // The popup's "Select videos" on YouTube.
  if (message?.type === 'youtube-select-tab') {
    startYoutubeSelect(message.tabId)
      .catch(() => notify(tr('n_cantselect')))
      .then(() => respond({ ok: true }))
    return true
  }
  // The popup's "Scan this page".
  if (message?.type === 'scan-page') {
    api.tabs
      .get(message.tabId)
      .then((tab) => startSelect(tab))
      .then(() => respond({ ok: true }))
      .catch(() => respond({ ok: false }))
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
