import { BrowserWindow, clipboard, Notification } from 'electron'
import { downloadableLink } from '../shared/clipboardLinks'
import { redactUrl } from '../shared/urlTools'
import { parseTelegramLinks } from '../shared/telegram'
import { offerLink, offerTelegram } from './openLinks'

const POLL_MS = 1000

/** Watches the clipboard for a link to a file and offers to download it, as download managers do.
 * Quiet by design: it only speaks while Lightning is in the background, with a notification the
 * user may ignore, and never offers the same link twice in a row. */
export class ClipboardWatcher {
  private timer: NodeJS.Timeout | null = null
  private last = ''
  private active: Notification | null = null
  private files = false
  private telegram = false

  constructor(private getWindow: () => BrowserWindow | null) {}

  /** Starts or stops watching to match the settings: `files` offers links to files, `telegram`
   * offers Telegram message links. Either one keeps the clipboard watched. */
  setEnabled({ files, telegram }: { files: boolean; telegram: boolean }): void {
    this.files = files
    this.telegram = telegram
    const enabled = files || telegram
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
    // In the window already: the New download dialog reads the clipboard itself.
    if (BrowserWindow.getFocusedWindow()) return
    if (!Notification.isSupported()) return
    if (this.telegram) {
      const links = parseTelegramLinks(text)
      if (links.length > 0) {
        this.offerMessages(links)
        return
      }
    }
    const link = this.files ? downloadableLink(text) : null
    if (link) this.offer(link)
  }

  private offerMessages(links: string[]): void {
    this.active?.close()
    const notification = new Notification({
      title:
        links.length === 1
          ? 'Download this Telegram message?'
          : `Download ${links.length} Telegram messages?`,
      body: links.length === 1 ? redactUrl(links[0]) : 'Click to review the links.',
      silent: true
    })
    notification.on('click', () => offerTelegram(links, this.getWindow()))
    notification.show()
    this.active = notification
  }

  private offer(link: string): void {
    this.active?.close()
    const notification = new Notification({
      title: 'Download this link?',
      body: redactUrl(link),
      silent: true
    })
    notification.on('click', () => offerLink(link, this.getWindow()))
    notification.show()
    this.active = notification
  }

  stop(): void {
    this.setEnabled({ files: false, telegram: false })
    this.active?.close()
  }
}
