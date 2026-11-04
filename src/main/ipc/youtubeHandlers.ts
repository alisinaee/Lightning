import { ipcMain, Notification, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import type { IpcContract } from '../../shared/ipc-contract'
import type { ResolvedPrefs } from '../../shared/types'
import type { YoutubeJob } from '../../shared/youtube'
import { uiUpdateDelay } from '../../shared/uiThrottle'
import { loadSettings, prefsOf } from '../settings'
import { testKnobs } from '../testKnobs'
import { getYoutubeStatus, proxyArg } from '../youtube/binary'
import { YoutubeJobManager } from '../youtube/jobs'
import { probeYoutube } from '../youtube/probe'

export interface YoutubeHandlers {
  dispose(): Promise<void>
}

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
    const entry = pending.get(job.id)
    if (entry?.timer) clearTimeout(entry.timer)
    pending.set(job.id, { job, last: Date.now() })
    send(IpcChannels.youtubeJobUpdated, job)
  }

  const prefs = currentPrefs
  const jobs = new YoutubeJobManager({
    getPrefs: prefs,
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
    return probeYoutube(url, proxy)
  })

  handle('youtubeStart', async (_event, request) => jobs.startJob(request))
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
    }
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
