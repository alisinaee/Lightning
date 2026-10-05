import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { BrowserWindow } from 'electron'
import { IpcChannels } from '../shared/ipc-channels'
import type { PendingLink, RequestExtras } from '../shared/types'

// Links the OS hands Lightning — a magnet link clicked in a browser, a .torrent opened from the file
// manager — for the window's link field. They're never started on their own: the user still sees
// what the link is and presses Start.

/** The latest link handed over and not yet taken by the window. */
let pending: PendingLink | null = null

/** A magnet link, or the path of a .torrent file that exists; anything else isn't taken. */
export function acceptedLink(candidate: string): string | null {
  if (/^magnet:\?/i.test(candidate)) return candidate
  if (!isAbsolute(candidate) || !/\.torrent$/i.test(candidate)) return null
  try {
    return statSync(candidate).isFile() ? candidate : null
  } catch {
    return null
  }
}

/** The link in a command line (Windows and Linux hand one over as an argument). */
export function linkFromArgs(argv: readonly string[]): string | null {
  for (const argument of argv.slice(1)) {
    const link = acceptedLink(argument)
    if (link) return link
  }
  return null
}

/**
 * Hands `link` to the window: it's kept until the window takes it (takePendingLink), so one that
 * arrives before the window is ready isn't lost. The window is brought forward.
 */
export function offerLink(
  link: string,
  window: BrowserWindow | null,
  extras?: RequestExtras
): void {
  pending = { url: link, extras }
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  window.webContents.send(IpcChannels.linkReceived)
}

/** The link handed over, once: whoever takes it puts it in the link field. */
export function takePendingLink(): PendingLink | null {
  const link = pending
  pending = null
  return link
}
