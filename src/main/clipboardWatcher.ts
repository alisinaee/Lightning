import { t, tn } from '../shared/i18n'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { app, BrowserWindow, clipboard, Notification } from 'electron'
import { downloadableLink } from '../shared/clipboardLinks'
import { redactUrl } from '../shared/urlTools'
import { parseTelegramLinks } from '../shared/telegram'
import { offerLink, offerSeveralLinks, offerTelegram } from './openLinks'
import { isYoutubeUrl } from '../shared/youtube'
import { IpcChannels } from '../shared/ipc-channels'
import type { ClipboardHistoryEntry, ClipboardLinkKind } from '../shared/types'
import { readJson, updateJson } from './jsonFile'
import { log } from './logger'

const POLL_MS = 1000
/** How long a copy waits for its text to be written before it is given up. */
const PENDING_MS = 3000
/** Two or more links copied together, separated by line breaks or spaces, and nothing else. */
function linksCopiedTogether(text: string): string[] | null {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length < 2 || words.length > 200) return null
  const links = words.map((word) => downloadableLink(word))
  return links.every((link): link is string => link !== null) ? links : null
}

/** macOS: prints a line each time the pasteboard's change count moves. It moves on every copy, even
 * one of the same text, so copying a link again is noticed. The lines go to stderr. */
const COUNT_SCRIPT =
  'ObjC.import("AppKit"); const pb = $.NSPasteboard.generalPasteboard; let last = -1; ' +
  'while (true) { const c = pb.changeCount; if (c !== last) { last = c; console.log(String(c)); } delay(0.4); }'
/** How many noticed links the history keeps. */
export const HISTORY_MAX = 50

export interface ClipboardWatchOptions {
  /** The main switch: off, the clipboard is not read at all. */
  track: boolean
  /** Read (and offer) only while Lightning is not the focused app. */
  onlyInBackground: boolean
  files: boolean
  youtube: boolean
  telegram: boolean
}

const OFF: ClipboardWatchOptions = {
  track: false,
  onlyInBackground: true,
  files: false,
  youtube: false,
  telegram: false
}

function historyPath(): string {
  return join(app.getPath('userData'), 'clipboard-history.json')
}

function isEntry(value: unknown): value is ClipboardHistoryEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.id === 'string' &&
    typeof entry.url === 'string' &&
    typeof entry.at === 'number' &&
    (entry.kind === 'file' || entry.kind === 'youtube' || entry.kind === 'telegram')
  )
}

/** Watches the clipboard for links to download and offers them, as download managers do. Quiet by
 * design: it only notifies while Lightning is in the background, with a notification the user may
 * ignore, and never offers the same link twice in a row. Every link it notices (a file, YouTube or
 * Telegram link) is also kept in a capped history, saved in the userData folder, for Settings →
 * Clipboard. The history records every noticed link, whether or not Lightning is in front.
 *
 * Notifications are only sent while Lightning is in the background. When it is in front, the New
 * download dialog reads the clipboard itself, so no notification is needed. */
export class ClipboardWatcher {
  private timer: NodeJS.Timeout | null = null
  private last = ''
  private active: Notification | null = null
  private options: ClipboardWatchOptions = OFF
  private entries: ClipboardHistoryEntry[] = []
  private loaded: Promise<void>
  /** The macOS change-count helper, while it runs; `copies` counts the copies it has seen. */
  private counter: ChildProcess | null = null
  private copies = 0
  private seenCopies = 0
  /** When a copy was seen whose text has not been read yet; 0 when none is waiting. */
  private pendingSince = 0

  constructor(private getWindow: () => BrowserWindow | null) {
    this.loaded = this.load()
    app.once('will-quit', () => this.stopCounter())
  }

  private async load(): Promise<void> {
    try {
      const saved = await readJson(historyPath())
      if (Array.isArray(saved)) {
        // Entries noticed before the file was read are newer than what it holds.
        this.entries = [...this.entries, ...saved.filter(isEntry)].slice(0, HISTORY_MAX)
      }
    } catch {
      // An unreadable file is the same as no history.
    }
  }

  private save(): void {
    const entries = this.entries
    void updateJson(historyPath(), () => entries).catch(() => {})
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed())
        window.webContents.send(IpcChannels.clipboardHistoryChanged, entries)
    }
  }

  history(): ClipboardHistoryEntry[] {
    return this.entries
  }

  async ready(): Promise<void> {
    await this.loaded
  }

  remove(id: string): void {
    this.entries = this.entries.filter((entry) => entry.id !== id)
    this.save()
  }

  clear(): void {
    this.entries = []
    this.save()
  }

  /** Opens an entry's link in the Add dialog (or the Telegram / YouTube one), as its notification would. */
  download(id: string): void {
    const entry = this.entries.find((candidate) => candidate.id === id)
    if (!entry) return
    const window = this.getWindow()
    if (entry.kind === 'telegram') offerTelegram([entry.url], window)
    else if (entry.kind === 'youtube') this.openYoutube(entry.url)
    else offerLink(entry.url, window)
  }

  private record(kind: ClipboardLinkKind, url: string): void {
    log.info('clipboard', 'noticed a link', { kind, url: redactUrl(url) })
    this.entries = [
      { id: randomUUID(), kind, url, at: Date.now() },
      // Copying a link again moves it to the top rather than listing it twice.
      ...this.entries.filter((entry) => !(entry.kind === kind && entry.url === url))
    ].slice(0, HISTORY_MAX)
    this.save()
  }

  /** Starts or stops watching to match the settings. With `track` off the clipboard is never read. */
  setEnabled(options: ClipboardWatchOptions): void {
    this.options = options
    const enabled = options.track && (options.files || options.youtube || options.telegram)
    if (enabled === (this.timer !== null)) return
    if (!enabled) {
      clearInterval(this.timer!)
      this.timer = null
      this.stopCounter()
      return
    }
    // What is already on the clipboard now was copied before the user asked to be told.
    void this.read().then((text) => (this.last = text))
    this.seenCopies = this.copies
    this.startCounter()
    this.timer = setInterval(() => void this.poll(), POLL_MS)
  }

  /** Starts the macOS change-count helper. Without it (other systems, or if it fails) a copy counts
   * only when the text changes. */
  private startCounter(): void {
    if (process.platform !== 'darwin' || this.counter) return
    try {
      const child = spawn('osascript', ['-l', 'JavaScript', '-e', COUNT_SCRIPT], {
        stdio: ['ignore', 'ignore', 'pipe']
      })
      this.counter = child
      // Its first line is the count when it started: the baseline, not a copy.
      let primed = false
      createInterface({ input: child.stderr! }).on('line', () => {
        if (primed) this.copies++
        else primed = true
      })
      child.on('exit', () => {
        if (this.counter === child) this.counter = null
      })
      child.on('error', () => {
        if (this.counter === child) this.counter = null
      })
    } catch {
      this.counter = null
    }
  }

  private stopCounter(): void {
    const child = this.counter
    this.counter = null
    child?.kill()
  }

  private async read(): Promise<string> {
    try {
      return await clipboard.readText()
    } catch {
      return ''
    }
  }

  private async poll(): Promise<void> {
    const text = await this.read()
    // With the change counter, a copy of the same text again still counts. Without it, only a change.
    const copiedAgain = this.copies !== this.seenCopies
    this.seenCopies = this.copies
    // Some apps clear the clipboard first and write the link a moment later. The count moves at the
    // clear, so the copy is held until its text arrives, for a few seconds.
    if (copiedAgain) this.pendingSince = Date.now()
    const pending = this.pendingSince !== 0 && Date.now() - this.pendingSince < PENDING_MS
    if (!pending) this.pendingSince = 0
    if (text === '' && pending) return
    if (this.counter ? !pending : text === this.last) return
    this.last = text
    this.pendingSince = 0
    // Recorded whether or not Lightning is in front. Only the notification waits for the background.
    const focused = BrowserWindow.getFocusedWindow() !== null
    await this.loaded
    const { files, youtube, telegram } = this.options
    if (telegram) {
      const links = parseTelegramLinks(text)
      if (links.length > 0) {
        for (const link of [...links].reverse()) this.record('telegram', link)
        if (!focused) this.offerMessages(links)
        return
      }
    }
    // A YouTube video opens the YouTube add dialog, where its quality is chosen.
    if (youtube && isYoutubeUrl(text)) {
      this.record('youtube', text.trim())
      if (!focused) this.offerYoutube(text.trim())
      return
    }
    // Several links copied together (a batch copy): Add several links opens with all of them.
    const batch = files ? linksCopiedTogether(text) : null
    if (batch) {
      for (const each of [...batch].reverse()) this.record('file', each)
      offerSeveralLinks(batch, this.getWindow())
      return
    }
    const link = files ? downloadableLink(text) : null
    if (link) {
      this.record('file', link)
      // The download dialog opens in the app, whichever app is in front; it closes by itself if ignored.
      offerLink(link, this.getWindow(), undefined, true)
    } else {
      // Only the size is logged: a copied text may be anything, a password included.
      log.info('clipboard', 'copied text is not a download link', {
        length: text.length,
        fileLinks: files
      })
    }
  }

  private notify(title: string, body: string, onClick: () => void): void {
    if (!Notification.isSupported()) {
      log.warn('clipboard', 'system notifications are not supported on this computer')
      return
    }
    this.active?.close()
    const notification = new Notification({ title, body, silent: true })
    notification.on('click', onClick)
    notification.show()
    log.info('clipboard', 'showed a notification', { title })
    this.active = notification
  }

  private openYoutube(url: string): void {
    const window = this.getWindow()
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    window.webContents.send(IpcChannels.appCommand, 'youtube-link', url)
  }

  private offerYoutube(url: string): void {
    this.notify(t('Download this YouTube video?'), redactUrl(url), () => this.openYoutube(url))
  }

  private offerMessages(links: string[]): void {
    this.notify(
      tn(links.length, 'Download this Telegram message?', 'Download {count} Telegram messages?'),
      links.length === 1 ? redactUrl(links[0]) : t('Click to review the links.'),
      () => offerTelegram(links, this.getWindow())
    )
  }

  stop(): void {
    this.setEnabled(OFF)
    this.active?.close()
  }
}
