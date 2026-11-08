import { reportYoutube } from '../externalActivity'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  dialog,
  ipcMain,
  Notification,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent
} from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import type { IpcContract } from '../../shared/ipc-contract'
import type { ResolvedPrefs } from '../../shared/types'
import { isYoutubeUrl, type YoutubeJob } from '../../shared/youtube'
import { uiUpdateDelay } from '../../shared/uiThrottle'
import { loadSettings, prefsOf } from '../settings'
import { testKnobs } from '../testKnobs'
import { getYoutubeStatus, proxyArg, youtubeDataDir } from '../youtube/binary'
import { loadYoutubeOptions, saveYoutubeOptions } from '../youtube/options'
import { savedCookiesPath, sanitizeCookies, signInArgs, writeCookiesFile } from '../youtube/cookies'
import { installedBrowsers } from '../youtube/browsers'
import { YoutubeJobManager, type CookieFile } from '../youtube/jobs'
import { probeYoutube } from '../youtube/probe'

const OFFER_TTL_MS = 30 * 60 * 1000

export interface YoutubeHandlers {
  dispose(): Promise<void>
  /** A video the browser extension sent. False when the request is not valid. */
  fromBrowser(body: Record<string, unknown>): Promise<boolean>
  /** Video pages the browser's select mode picked. Returns how many downloads started. */
  fromBrowserBatch(body: Record<string, unknown>): Promise<number>
}

const MAX_BATCH = 200
// Best video and audio, merged; the same default a single download uses when no quality is picked.
const BATCH_FORMAT = 'bv*+ba/b'

function handle<K extends keyof IpcContract>(
  channel: K,
  listener: (
    event: IpcMainInvokeEvent,
    ...args: IpcContract[K]['args']
  ) => IpcContract[K]['result'] | Promise<IpcContract[K]['result']>
): void {
  ipcMain.handle(
    IpcChannels[channel],
    listener as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  )
}

async function currentPrefs(): Promise<ResolvedPrefs> {
  return prefsOf(await loadSettings())
}

export async function registerYoutubeHandlers(
  getWindow: () => BrowserWindow | null
): Promise<YoutubeHandlers> {
  const send = (channel: string, ...args: unknown[]): void => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(channel, ...args)
  }

  const pending = new Map<string, { job: YoutubeJob; timer?: NodeJS.Timeout; last: number }>()

  const push = (job: YoutubeJob): void => {
    reportYoutube(job)
    const entry = pending.get(job.id) ?? { job, last: 0 }
    entry.job = job
    pending.set(job.id, entry)
    if (entry.timer) return

    const window = getWindow()
    const delay = window
      ? uiUpdateDelay({
          visible: window.isVisible(),
          minimized: window.isMinimized(),
          focused: window.isFocused()
        })
      : 2000

    const wait = Math.max(0, entry.last + delay - Date.now())
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      entry.last = Date.now()
      send(IpcChannels.youtubeJobUpdated, entry.job)
    }, wait)
  }

  const flush = (job: YoutubeJob): void => {
    reportYoutube(job)
    const entry = pending.get(job.id)
    if (entry?.timer) clearTimeout(entry.timer)
    pending.set(job.id, { job, last: Date.now() })
    send(IpcChannels.youtubeJobUpdated, job)
  }

  const prefs = currentPrefs
  const jobs = new YoutubeJobManager({
    getPrefs: prefs,
    getOptions: loadYoutubeOptions,
    onChange: push,
    onFinished: (job) => {
      flush(job)
      void notifyFinished(job, getWindow)
    }
  })
  await jobs.load()

  handle('youtubeStatus', async () => getYoutubeStatus())

  handle('youtubeProbe', async (_event, url) => {
    const currentPreferences = await prefs()
    const proxy = proxyArg(currentPreferences)
    // Signed in the way the person set up in Options, so a sign-in wall can be got past.
    return probeYoutube(url, proxy, signInArgs(await loadYoutubeOptions()))
  })

  handle('youtubeBrowsers', async () => installedBrowsers())

  handle('openFullDiskAccess', async () => {
    if (process.platform === 'darwin') {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
      )
    }
  })

  handle('youtubeStart', async (_event, request) => {
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
    return jobs.startJob(request, offer?.cookies)
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
    { url: string; title: string; cookies?: CookieFile; timer: NodeJS.Timeout }
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
    const mode = typeof body.cookieMode === 'string' ? body.cookieMode : 'none'

    let cookies: CookieFile | undefined
    if (mode === 'send' || mode === 'save') {
      await mkdir(youtubeDataDir(), { recursive: true })
      const temporary = mode === 'send'
      const file = temporary
        ? join(youtubeDataDir(), `cookies-${randomUUID()}.txt`)
        : savedCookiesPath()
      await writeCookiesFile(file, sanitizeCookies(body.cookies))
      cookies = { file, temporary }
    } else if (mode === 'saved') {
      if (existsSync(savedCookiesPath())) cookies = { file: savedCookiesPath(), temporary: false }
    } else if (mode !== 'none') {
      return false
    }

    const id = randomUUID()
    const timer = setTimeout(() => discardOffer(id), OFFER_TTL_MS)
    offers.set(id, { url, title: title || url, cookies, timer })

    const window = getWindow()
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
      window.webContents.send(
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
      for (const entry of pending.values()) {
        if (entry.timer) clearTimeout(entry.timer)
      }
    },
    fromBrowser,
    fromBrowserBatch
  }
}

async function notifyFinished(
  job: YoutubeJob,
  getWindow: () => BrowserWindow | null
): Promise<void> {
  if (job.status !== 'completed' && job.status !== 'error') return
  const settings = prefsOf(await loadSettings())
  const allowed = job.status === 'completed' ? settings.notifyCompleted : settings.notifyFailed
  if (!allowed || testKnobs.userDataDir || !Notification.isSupported()) return
  if (settings.notifyWhenInactive && getWindow()?.isFocused()) return

  const title = job.status === 'completed' ? 'YouTube download finished' : 'YouTube download failed'
  const body =
    job.status === 'completed'
      ? job.title || '1 video downloaded'
      : job.error || 'The download could not be completed.'

  try {
    const notification = new Notification({ title, body, silent: true })
    notification.on('click', () => {
      const window = getWindow()
      if (window && !window.isDestroyed()) {
        if (window.isMinimized()) window.restore()
        window.show()
        window.focus()
      }
    })
    notification.show()
  } catch {
    // ignore
  }
}
