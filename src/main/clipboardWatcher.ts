import { t, tn } from '../shared/i18n'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, BrowserWindow, clipboard, Notification } from 'electron'
import { downloadableLink } from '../shared/clipboardLinks'
import { redactUrl } from '../shared/urlTools'
import { parseTelegramLinks } from '../shared/telegram'
import { offerLink, offerTelegram } from './openLinks'
import { isYoutubeUrl } from '../shared/youtube'
import { IpcChannels } from '../shared/ipc-channels'
import type { ClipboardHistoryEntry, ClipboardLinkKind } from '../shared/types'
import { readJson, updateJson } from './jsonFile'

const POLL_MS = 1000
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
 * Clipboard.
 *
 * Honest limit: when Lightning is focused and "only in the background" is off, links are still
 * recorded in the history but no in-app offer is shown (the New download dialog reads the
 * clipboard itself); notifications are only ever sent in the background. */
export class ClipboardWatcher {
  private timer: NodeJS.Timeout | null = null
  private last = ''
  private active: Notification | null = null
  private options: ClipboardWatchOptions = OFF
  private entries: ClipboardHistoryEntry[] = []
  private loaded: Promise<void>

  constructor(private getWindow: () => BrowserWindow | null) {
    this.loaded = this.load()
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
      return
    }
    // What is already on the clipboard now was copied before the user asked to be told.
    void this.read().then((text) => (this.last = text))
    this.timer = setInterval(() => void this.poll(), POLL_MS)
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
    if (text === this.last) return
    this.last = text
    const focused = BrowserWindow.getFocusedWindow() !== null
    // In the window already: the New download dialog reads the clipboard itself.
    if (focused && this.options.onlyInBackground) return
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
    const link = files ? downloadableLink(text) : null
    if (link) {
      this.record('file', link)
      if (!focused) this.offer(link)
    }
  }

  private notify(title: string, body: string, onClick: () => void): void {
    if (!Notification.isSupported()) return
    this.active?.close()
    const notification = new Notification({ title, body, silent: true })
    notification.on('click', onClick)
    notification.show()
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

  private offer(link: string): void {
    this.notify(t('Download this link?'), redactUrl(link), () => offerLink(link, this.getWindow()))
  }

  stop(): void {
    this.setEnabled(OFF)
    this.active?.close()
  }
}
