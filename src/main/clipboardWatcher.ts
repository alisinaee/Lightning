import { BrowserWindow, clipboard, Notification } from 'electron'
import { downloadableLink } from '../shared/clipboardLinks'
import { redactUrl } from '../shared/urlTools'
import { offerLink } from './openLinks'

const POLL_MS = 1000

/** Watches the clipboard for a link to a file and offers to download it, as download managers do.
 * Quiet by design: it only speaks while Lightning is in the background, with a notification the
 * user may ignore, and never offers the same link twice in a row. */
export class ClipboardWatcher {
  private timer: NodeJS.Timeout | null = null
  private last = ''
  private active: Notification | null = null

  constructor(private getWindow: () => BrowserWindow | null) {}

  /** Starts or stops watching to match the setting. */
  setEnabled(enabled: boolean): void {
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
    const link = downloadableLink(text)
    if (!link || !Notification.isSupported()) return
    this.offer(link)
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
    this.setEnabled(false)
    this.active?.close()
  }
}
