import { t } from '../../shared/i18n'
import { reportTelegram } from '../externalActivity'
import { mkdir } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { ipcMain, Notification, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import type { IpcContract } from '../../shared/ipc-contract'
import { parseTelegramLinks, type TdlJob, type TdlStatus } from '../../shared/telegram'
import type { ResolvedPrefs } from '../../shared/types'
import { uiUpdateDelay } from '../../shared/uiThrottle'
import { getDefaultDownloadsDir } from '../download/paths'
import { log } from '../logger'
import { loadSettings, prefsOf } from '../settings'
import { testKnobs } from '../testKnobs'
import {
  deleteSession,
  proxyArg,
  readAccount,
  tdlExportsDir,
  tdlVersion
} from '../telegram/tdlBinary'
import { exportPreview, listChats } from '../telegram/tdlExport'
import { TdlJobManager } from '../telegram/tdlJobs'
import { TdlLogin } from '../telegram/tdlLogin'

export interface TelegramHandlers {
  /** Stops tdl processes and writes the job list; for quitting. */
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

export async function telegramDirectory(): Promise<string> {
  const { telegramDir } = await loadSettings()
  return telegramDir && isAbsolute(telegramDir)
    ? telegramDir
    : join(getDefaultDownloadsDir(), 'Lightning Telegram')
}

export async function registerTelegramHandlers(
  getWindow: () => BrowserWindow | null
): Promise<TelegramHandlers> {
  const send = (channel: string, ...args: unknown[]): void => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(channel, ...args)
  }

  // Progress goes to the window at the rate its visibility allows, the latest job state only.
  const pending = new Map<string, { job: TdlJob; timer?: NodeJS.Timeout; last: number }>()
  const push = (job: TdlJob): void => {
    reportTelegram(job)
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
      send(IpcChannels.tdlJobUpdated, entry.job)
    }, wait)
  }
  /** A finished job's last state goes out at once, so a status change is never late. */
  const flush = (job: TdlJob): void => {
    reportTelegram(job)
    const entry = pending.get(job.id)
    if (entry?.timer) clearTimeout(entry.timer)
    pending.set(job.id, { job, last: Date.now() })
    send(IpcChannels.tdlJobUpdated, job)
  }

  const prefs = currentPrefs
  const proxy = async (): Promise<string | undefined> => proxyArg(await prefs())

  const jobs = new TdlJobManager({
    getPrefs: prefs,
    onChange: push,
    onFinished: (job) => {
      flush(job)
      void notifyFinished(job, getWindow)
    }
  })
  await jobs.load()

  const login = new TdlLogin(proxy)

  handle('tdlStatus', async (): Promise<TdlStatus> => {
    const version = await tdlVersion()
    if (!version) return { binary: false, loggedIn: false }
    const account = await readAccount()
    return { binary: true, version, loggedIn: account !== null, account: account ?? undefined }
  })

  handle('tdlLoginStart', async (_event, mode, options) => {
    if (!['qr', 'code', 'desktop'].includes(mode)) throw new Error('Unknown sign-in method.')
    if (options?.desktopDir !== undefined && !isAbsolute(options.desktopDir)) {
      throw new Error('The Telegram Desktop folder must be an absolute path.')
    }
    return login.start(mode, options, (sessionId, event) =>
      send(IpcChannels.tdlLoginEvent, sessionId, event)
    )
  })
  handle('tdlLoginAnswer', (_event, sessionId, value) => login.answer(sessionId, String(value)))
  handle('tdlLoginCancel', (_event, sessionId) => login.cancel(sessionId))
  handle('tdlLogout', async () => {
    login.dispose()
    for (const job of jobs.list()) if (job.status === 'running') jobs.pause(job.id)
    await deleteSession()
    log.info('telegram', 'signed out')
  })

  handle('tdlListChats', async () => listChats(await proxy()))
  handle('tdlExportPreview', async (_event, input) => {
    if (typeof input?.chat !== 'string' || !['time', 'id', 'last'].includes(input.rangeType)) {
      throw new Error('Choose a chat and a range.')
    }
    return exportPreview(input, await proxy())
  })

  handle('tdlStartJob', async (_event, input) => {
    const dir = input.dir ?? (await telegramDirectory())
    if (!isAbsolute(dir)) throw new Error('The download folder must be an absolute path.')
    await mkdir(dir, { recursive: true })
    if (input.links?.length) {
      // Whatever the window sent, only message links reach tdl's command line.
      const links = parseTelegramLinks(input.links.join('\n'))
      return jobs.create({ links, dir })
    }
    if (input.exportFile) {
      // Only an export this app made: the window cannot point tdl at any file.
      const file = resolve(input.exportFile)
      if (!file.startsWith(resolve(tdlExportsDir()) + sep)) throw new Error('Unknown export file.')
      return jobs.create({ exportFile: file, keys: input.keys, dir })
    }
    throw new Error('Nothing to download.')
  })
  handle('tdlListJobs', () => jobs.list())
  handle('tdlPauseJob', (_event, id) => jobs.pause(id))
  handle('tdlResumeJob', (_event, id) => jobs.resume(id))
  handle('tdlCancelJob', (_event, id) => jobs.cancel(id))
  handle('tdlRetryJob', (_event, id) => jobs.retry(id))
  handle('tdlRemoveJob', (_event, id, options) => jobs.remove(id, options))
  handle('tdlRevealItem', (_event, jobId, key) => jobs.reveal(jobId, key))
  handle('tdlOpenItem', (_event, jobId, key) => jobs.open(jobId, key))

  return {
    async dispose() {
      login.dispose()
      for (const entry of pending.values()) if (entry.timer) clearTimeout(entry.timer)
      await jobs.dispose()
    }
  }
}

async function notifyFinished(job: TdlJob, getWindow: () => BrowserWindow | null): Promise<void> {
  if (job.status !== 'completed' && job.status !== 'error') return
  const settings = prefsOf(await loadSettings())
  const allowed = job.status === 'completed' ? settings.notifyCompleted : settings.notifyFailed
  if (!allowed || testKnobs.userDataDir || !Notification.isSupported()) return
  if (settings.notifyWhenInactive && getWindow()?.isFocused()) return
  const done = job.items.filter((item) => item.status === 'done').length
  const title =
    job.status === 'completed' ? t('Telegram download finished') : t('Telegram download failed')
  const body =
    job.status === 'completed'
      ? job.items.length === 1
        ? (job.items[0]?.fileName ?? t('1 file'))
        : t('{done} of {total} files', { done, total: job.items.length })
      : (job.error ?? t('Some files could not be downloaded.'))
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
    // Notifications are a courtesy.
  }
}
