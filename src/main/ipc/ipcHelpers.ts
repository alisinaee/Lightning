import { ipcMain, Notification, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import type { IpcContract } from '../../shared/ipc-contract'
import { UI_UPDATE_HIDDEN_MS, uiUpdateDelay } from '../../shared/uiThrottle'
import { log } from '../logger'
import { loadSettings, prefsOf } from '../settings'
import { testKnobs } from '../testKnobs'

/** Typed wrapper around ipcMain.handle — the channel name picks its args/result shape out of
 * IpcContract, so a handler here that doesn't match what lightningApi (preload) actually calls is a
 * compile error instead of a silent runtime mismatch. */
export function handle<K extends keyof IpcContract>(
  channel: K,
  listener: (
    event: IpcMainInvokeEvent,
    ...args: IpcContract[K]['args']
  ) => IpcContract[K]['result'] | Promise<IpcContract[K]['result']>
): void {
  const run = listener as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ipcMain.handle(IpcChannels[channel], async (event, ...args) => {
    // A window waiting on an answer that doesn't come looks frozen: the log says which call.
    const startedAt = Date.now()
    const stuck = setTimeout(
      () => log.warn('ipc', `${channel} still has no answer after ${SLOW_IPC_MS / 1000} s`),
      SLOW_IPC_MS
    )
    try {
      return await run(event, ...args)
    } finally {
      clearTimeout(stuck)
      const took = Date.now() - startedAt
      if (took >= SLOW_IPC_MS)
        log.warn('ipc', `${channel} answered after ${Math.round(took / 1000)} s`)
    }
  })
}

const SLOW_IPC_MS = 10_000

/** Sends an IPC push event to `window` if it still exists and is not destroyed. */
export function sendToWindow(
  window: BrowserWindow | null | undefined,
  channel: string,
  ...args: unknown[]
): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(channel, ...args)
  }
}

export interface JobThrottler<T> {
  push: (job: T) => void
  flush: (job: T) => void
  dispose: () => void
}

/** Throttles per-job progress pushes to the renderer based on window visibility, while letting
 * terminal state changes flush immediately. */
export function createJobThrottler<T extends { id: string }>(options: {
  getWindow: () => BrowserWindow | null
  channel: string
  onReport?: (job: T) => void
}): JobThrottler<T> {
  const pending = new Map<string, { job: T; timer?: NodeJS.Timeout; last: number }>()

  const push = (job: T): void => {
    options.onReport?.(job)
    const entry = pending.get(job.id) ?? { job, last: 0 }
    entry.job = job
    pending.set(job.id, entry)
    if (entry.timer) return

    const window = options.getWindow()
    const delay = window
      ? uiUpdateDelay({
          visible: window.isVisible(),
          minimized: window.isMinimized(),
          focused: window.isFocused()
        })
      : UI_UPDATE_HIDDEN_MS

    const wait = Math.max(0, entry.last + delay - Date.now())
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      entry.last = Date.now()
      sendToWindow(options.getWindow(), options.channel, entry.job)
    }, wait)
  }

  const flush = (job: T): void => {
    options.onReport?.(job)
    const entry = pending.get(job.id)
    if (entry?.timer) clearTimeout(entry.timer)
    pending.set(job.id, { job, last: Date.now() })
    sendToWindow(options.getWindow(), options.channel, job)
  }

  const dispose = (): void => {
    for (const entry of pending.values()) {
      if (entry.timer) clearTimeout(entry.timer)
    }
    pending.clear()
  }

  return { push, flush, dispose }
}

/** Shows a desktop notification for a finished or failed job when preferences allow, focusing the
 * app window when clicked. */
export async function showAppNotification(options: {
  getWindow: () => BrowserWindow | null
  kind: 'completed' | 'error'
  title: string
  body: string
}): Promise<void> {
  const settings = prefsOf(await loadSettings())
  const allowed = options.kind === 'completed' ? settings.notifyCompleted : settings.notifyFailed
  if (!allowed || testKnobs.userDataDir || !Notification.isSupported()) return
  if (settings.notifyWhenInactive && options.getWindow()?.isFocused()) return

  try {
    const notification = new Notification({
      title: options.title,
      body: options.body,
      silent: true
    })
    notification.on('click', () => {
      const window = options.getWindow()
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
