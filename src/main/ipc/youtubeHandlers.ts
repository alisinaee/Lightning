import { t } from '../../shared/i18n'
import { reportYoutube } from '../externalActivity'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import { log } from '../logger'
import { needsSignIn } from '../../shared/signIn'
import { IpcChannels } from '../../shared/ipc-channels'
import type { ResolvedPrefs } from '../../shared/types'
import { isYoutubeUrl, type YoutubeJob } from '../../shared/youtube'
import { sanitizeExtras } from '../../shared/requestHeaders'
import { loadSettings, prefsOf } from '../settings'
import { getYoutubeStatus, proxyArg, youtubeDataDir } from '../youtube/binary'
import { loadYoutubeOptions, saveYoutubeOptions } from '../youtube/options'
import { savedCookiesPath, sanitizeCookies, signInArgs, writeCookiesFile } from '../youtube/cookies'
import { installedBrowsers } from '../youtube/browsers'
import { YoutubeJobManager, type CookieFile } from '../youtube/jobs'
import { probeYoutube, type ProbeExtras } from '../youtube/probe'
import { guidePermission, permissionStatus } from '../permissions'
import { createJobThrottler, handle, sendToWindow, showAppNotification } from './ipcHelpers'

const OFFER_TTL_MS = 30 * 60 * 1000

export interface YoutubeHandlers {
  dispose(): Promise<void>
  /** A video the browser extension sent. False when the request is not valid. */
  fromBrowser(body: Record<string, unknown>): Promise<boolean>
  /** Video pages the browser's select mode picked. Returns how many downloads started. */
  fromBrowserBatch(body: Record<string, unknown>): Promise<number>
  /** What Lightning wants from the browser extension now (it asks every half minute). */
  browserRequests(): BrowserRequests
  /** The YouTube cookies the extension sent for downloads stuck on a sign-in. Returns how many
   * downloads started again. */
  fromBrowserCookies(body: Record<string, unknown>): Promise<number>
}

export interface BrowserRequests {
  /** A download failed for want of a YouTube sign-in: fresh cookies from the browser may fix it. */
  youtubeCookies: boolean
}

/** How long a download waits for the browser's sign-in before the usual fix shows. */
const ASK_BROWSER_MS = 90_000
/** The extension counts as there when it asked for requests this recently. */
const EXTENSION_SEEN_MS = 2 * 60_000
const YOUTUBE_COOKIE_DOMAIN = /(^|\.)youtube\.com$/i

const MAX_BATCH = 200
// Best video and audio, merged; the same default a single download uses when no quality is picked.
const BATCH_FORMAT = 'bv*+ba/b'

async function currentPrefs(): Promise<ResolvedPrefs> {
  return prefsOf(await loadSettings())
}

/** The page a browser offer came from, as a download's request extras. */
function pageExtras(offer: { referer?: string; userAgent?: string }): {
  referer?: string
  userAgent?: string
} {
  return { referer: offer.referer, userAgent: offer.userAgent }
}

export async function registerYoutubeHandlers(
  getWindow: () => BrowserWindow | null
): Promise<YoutubeHandlers> {
  const throttler = createJobThrottler<YoutubeJob>({
    getWindow,
    channel: IpcChannels.youtubeJobUpdated,
    onReport: reportYoutube
  })

  const prefs = currentPrefs
  const jobs = new YoutubeJobManager({
    getPrefs: prefs,
    getOptions: loadYoutubeOptions,
    onChange: throttler.push,
    onFinished: (job) => {
      void askBrowser(job)
      throttler.flush(job)
      void notifyFinished(job, getWindow)
    }
  })

  // A download that stopped for want of a YouTube sign-in asks the browser extension for fresh
  // cookies (once per download), and starts again by itself when they come.
  let extensionSeenAt = 0
  const asking = new Set<string>()
  async function askBrowser(job: YoutubeJob): Promise<void> {
    if (job.status !== 'error' || job.browserSignInTried || !needsSignIn(job.error)) return
    if (Date.now() - extensionSeenAt > EXTENSION_SEEN_MS) return
    // A cookies.txt the person chose is theirs: the browser's sign-in does not replace it.
    if ((await loadYoutubeOptions()).cookieMode === 'manual') return
    job.askingBrowserUntil = Date.now() + ASK_BROWSER_MS
    asking.add(job.id)
    log.info('youtube', 'asking the browser extension for a fresh YouTube sign-in', { id: job.id })
    throttler.push(job)
  }
  const stillAsking = (): YoutubeJob[] => {
    const now = Date.now()
    const waiting: YoutubeJob[] = []
    for (const id of asking) {
      const job = jobs.getJob(id)
      if (job?.status === 'error' && (job.askingBrowserUntil ?? 0) > now) waiting.push(job)
      else asking.delete(id)
    }
    return waiting
  }
  const browserRequests = (): BrowserRequests => {
    extensionSeenAt = Date.now()
    return { youtubeCookies: stillAsking().length > 0 }
  }
  const fromBrowserCookies = async (body: Record<string, unknown>): Promise<number> => {
    const waiting = stillAsking()
    asking.clear()
    if (waiting.length === 0) return 0
    const cookies = sanitizeCookies(body.cookies).filter((cookie) =>
      YOUTUBE_COOKIE_DOMAIN.test(cookie.domain.replace(/^\./, ''))
    )
    for (const job of waiting) {
      job.browserSignInTried = true
      job.askingBrowserUntil = undefined
    }
    if (cookies.length === 0) {
      // Not signed in to YouTube in the browser: the usual fix shows.
      log.info('youtube', 'the browser sent no YouTube sign-in')
      for (const job of waiting) throttler.flush(job)
      return 0
    }
    await mkdir(youtubeDataDir(), { recursive: true })
    // 'send': for these downloads only. Otherwise it becomes Lightning's YouTube sign-in.
    const temporary = body.mode === 'send'
    if (!temporary) {
      await writeCookiesFile(savedCookiesPath(), cookies)
      await saveYoutubeOptions({ cookieMode: 'saved' })
    }
    for (const job of waiting) {
      if (temporary) {
        const file = join(youtubeDataDir(), `cookies-${randomUUID()}.txt`)
        await writeCookiesFile(file, cookies)
        await jobs.retryJob(job.id, { file, temporary: true })
      } else {
        await jobs.retryJob(job.id)
      }
    }
    log.info('youtube', 'fresh YouTube sign-in from the browser: trying again', {
      count: waiting.length,
      saved: !temporary
    })
    return waiting.length
  }
  await jobs.load()

  handle('youtubeStatus', async () => getYoutubeStatus())

  handle('youtubeProbe', async (_event, url, offerId) => {
    const currentPreferences = await prefs()
    const proxy = proxyArg(currentPreferences)
    // A browser offer probes with the cookies and page it came with (they stay with the offer).
    const offer = offerId ? offers.get(offerId) : undefined
    const extras: ProbeExtras | undefined = offer
      ? {
          cookieFile: offer.cookies?.file,
          referer: offer.referer,
          userAgent: offer.userAgent,
          title: offer.title
        }
      : undefined
    // Signed in the way the person set up in Options, so a sign-in wall can be got past.
    return probeYoutube(url, proxy, signInArgs(await loadYoutubeOptions()), extras)
  })

  handle('youtubeBrowsers', async () => installedBrowsers())

  handle('openFullDiskAccess', () => guidePermission('fullDisk'))
  handle('permissionStatus', () => permissionStatus())
  handle('guidePermission', (_event, kind) => guidePermission(kind))

  handle('youtubeStart', async (_event, request) => {
    // yt-dlp must never read an address as one of its own options.
    if (!/^https?:\/\//i.test(request.url)) throw new Error('Only web addresses can be downloaded.')
    const offer = request.offerId ? offers.get(request.offerId) : undefined
    if (request.offerId && offer) {
      // The cookies now belong to this download: keep them out of the offer's cleanup.
      clearTimeout(offer.timer)
      offers.delete(request.offerId)
    }
    // A playlist link with the Playlists option on: every video of it becomes a group.
    const options = await loadYoutubeOptions()
    if (options.playlist === 'full' && /[?&]list=/.test(request.url)) {
      const created = await jobs.startPlaylist(request, offer?.cookies)
      return created[0]
    }
    return jobs.startJob(request, offer?.cookies, offer ? pageExtras(offer) : undefined)
  })
  handle('youtubeCancelOffer', async (_event, id) => discardOffer(id))
  handle('youtubeGetOptions', async () => loadYoutubeOptions())
  handle('youtubeSetOptions', async (_event, change) => saveYoutubeOptions(change))
  handle('youtubeChooseFolder', async (_event, defaultPath) => {
    const window = getWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      defaultPath,
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })
  handle('youtubeChooseCookies', async () => {
    const window = getWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [{ name: 'Cookies', extensions: ['txt'] }]
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  // Videos the browser sent that wait for the person to confirm in the add dialog.
  const offers = new Map<
    string,
    {
      url: string
      title: string
      cookies?: CookieFile
      referer?: string
      userAgent?: string
      timer: NodeJS.Timeout
    }
  >()
  const discardOffer = async (id: string): Promise<void> => {
    const offer = offers.get(id)
    if (!offer) return
    clearTimeout(offer.timer)
    offers.delete(id)
    if (offer.cookies?.temporary) await rm(offer.cookies.file, { force: true })
  }

  // A video the browser extension sent. Nothing downloads yet: the app opens its add dialog with the
  // link, and the download starts when the person confirms it there (see 'youtubeStart').
  // The cookie mode says what the browser shares: 'send' (for this download only), 'save' (kept in
  // Lightning), 'saved' (use what was saved) or 'none'.
  const fromBrowser = async (body: Record<string, unknown>): Promise<boolean> => {
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    if (!/^https?:\/\/\S+$/i.test(url) || url.length > 8192) return false
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : ''
    const youtube = isYoutubeUrl(url)
    let mode = typeof body.cookieMode === 'string' ? body.cookieMode : 'none'
    // Only YouTube's sign-in is kept in Lightning. Any other site gets a temporary file, so the
    // saved YouTube cookies.txt is never written over by a page of another site.
    if (!youtube && mode === 'save') mode = 'send'
    // The page the video is on: its address and user agent go with the video, for this download only.
    const pageExtras = sanitizeExtras({
      referer: typeof body.referer === 'string' ? body.referer : body.pageUrl,
      userAgent: body.userAgent
    })

    let cookies: CookieFile | undefined
    if (mode === 'send' || mode === 'save') {
      await mkdir(youtubeDataDir(), { recursive: true })
      const temporary = mode === 'send'
      const file = temporary
        ? join(youtubeDataDir(), `cookies-${randomUUID()}.txt`)
        : savedCookiesPath()
      await writeCookiesFile(file, sanitizeCookies(body.cookies))
      cookies = { file, temporary }
      // Saved cookies are the app-wide sign-in: pasted links and probes read them from options too.
      if (!temporary) await saveYoutubeOptions({ cookieMode: 'saved' })
    } else if (mode === 'saved') {
      if (existsSync(savedCookiesPath())) cookies = { file: savedCookiesPath(), temporary: false }
    } else if (mode !== 'none') {
      return false
    }

    const id = randomUUID()
    const timer = setTimeout(() => discardOffer(id), OFFER_TTL_MS)
    offers.set(id, {
      url,
      title: title || url,
      cookies,
      referer: pageExtras.referer,
      userAgent: pageExtras.userAgent,
      timer
    })

    const window = getWindow()
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
      sendToWindow(
        window,
        IpcChannels.appCommand,
        'youtube-offer',
        JSON.stringify({ id, url, title: title || url })
      )
    }
    return true
  }
  // The select mode picked several videos: each starts with the default quality, no dialog.
  const fromBrowserBatch = async (body: Record<string, unknown>): Promise<number> => {
    const entries = Array.isArray(body.videos) ? body.videos.slice(0, MAX_BATCH) : []
    const seen = new Set<string>()
    let started = 0
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null) continue
      const item = entry as Record<string, unknown>
      const url = typeof item.url === 'string' ? item.url.trim() : ''
      // Only YouTube addresses: the batch starts downloads with no dialog, so it must not take any site.
      if (!isYoutubeUrl(url) || url.length > 8192 || seen.has(url)) continue
      seen.add(url)
      const title = typeof item.title === 'string' ? item.title.trim().slice(0, 300) : ''
      await jobs.startJob({ url, title: title || url, formatId: BATCH_FORMAT, resolution: 'best' })
      started++
    }
    return started
  }
  handle('youtubeListJobs', async () => jobs.listJobs())
  handle('youtubePauseJob', async (_event, id) => jobs.pauseJob(id))
  handle('youtubeResumeJob', async (_event, id) => jobs.resumeJob(id))
  handle('youtubeCancelJob', async (_event, id) => jobs.cancelJob(id))
  handle('youtubeRetryJob', async (_event, id) => jobs.retryJob(id))
  handle('youtubeRemoveJob', async (_event, id, deleteFile) => jobs.removeJob(id, deleteFile))
  handle('youtubeRevealJob', (_event, id) => jobs.revealJob(id))
  handle('youtubeOpenJob', (_event, id) => jobs.openJob(id))

  return {
    async dispose() {
      throttler.dispose()
      for (const offer of offers.values()) {
        clearTimeout(offer.timer)
        if (offer.cookies?.temporary) {
          await rm(offer.cookies.file, { force: true }).catch(() => undefined)
        }
      }
      offers.clear()
      await jobs.dispose()
    },
    fromBrowser,
    fromBrowserBatch,
    browserRequests,
    fromBrowserCookies
  }
}

async function notifyFinished(
  job: YoutubeJob,
  getWindow: () => BrowserWindow | null
): Promise<void> {
  if (job.status !== 'completed' && job.status !== 'error') return
  const title =
    job.status === 'completed' ? t('YouTube download finished') : t('YouTube download failed')
  const body =
    job.status === 'completed'
      ? job.title || t('1 video downloaded')
      : job.error || t('The download could not be completed.')
  await showAppNotification({ getWindow, kind: job.status, title, body })
}
