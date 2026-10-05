import { app, session, type BrowserWindow } from 'electron'
import type { AppSettings } from '../shared/types'
import { isProxyAddress } from '../shared/networks'
import { ClipboardWatcher } from './clipboardWatcher'
import { integrationToken } from './integration'
import { LocalApi } from './localApi'
import { offerLink } from './openLinks'
import { prefsOf } from './settings'

/** What Settings asked of the process itself: hiding on close, the Dock, and the proxy. */
export const behavior = {
  closeHides: true
}

let clipboardWatcher: ClipboardWatcher | null = null
let localApi: LocalApi | null = null

/** The port the browser extension's server listens on, or null while it is off. */
export const integrationPort = (): number | null => localApi?.port ?? null

/** Starts the server the browser extension talks to (when Settings has it on). A link it hands over
 * opens in the window, for the user to start. */
export function installLocalApi(getWindow: () => BrowserWindow | null): void {
  localApi = new LocalApi({
    version: app.getVersion(),
    token: integrationToken,
    onAdd: (url, extras) => offerLink(url, getWindow(), extras)
  })
}

/** Gives the clipboard watcher the window a link it offers should open in. Called once, at startup. */
export function installClipboardWatcher(getWindow: () => BrowserWindow | null): void {
  clipboardWatcher = new ClipboardWatcher(getWindow)
}

/** The argument a login-started Lightning carries, so it can stay in the tray. */
export const LOGIN_ARG = '--hidden'

/** True when the OS started Lightning at sign-in rather than the user opening it. */
export function startedAtLogin(): boolean {
  if (process.argv.includes(LOGIN_ARG)) return true
  try {
    return app.getLoginItemSettings().wasOpenedAtLogin === true
  } catch {
    return false
  }
}

/** Registers or removes the sign-in item. Skipped for an unpackaged build, which would register the
 * bare Electron binary. Linux has no login-item API, so it is a no-op there. */
function applyLoginItem(enabled: boolean): void {
  if (!app.isPackaged) return
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, args: [LOGIN_ARG] })
  } catch {
    // The OS refusing leaves the previous registration as it was.
  }
}

/** Applies the parts of Settings that live outside a download: the Dock, and the proxy the
 * app's own requests use. */
export async function applyBehavior(settings: AppSettings): Promise<void> {
  const prefs = prefsOf(settings)
  behavior.closeHides = prefs.closeToBackground
  applyLoginItem(prefs.openAtLogin)
  clipboardWatcher?.setEnabled(prefs.watchClipboard)
  await localApi?.setEnabled(prefs.browserIntegration)
  if (process.platform === 'darwin' && app.dock) {
    if (prefs.hideDock) app.dock.hide()
    else app.dock.show()
  }
  // Checked again here, for the text that becomes the rules (prefsOf already dropped the rest).
  const valid = (value: string): string => (isProxyAddress(value) ? value : '')
  prefs.proxyHttp = valid(prefs.proxyHttp)
  prefs.proxyHttps = valid(prefs.proxyHttps)
  prefs.proxyFtp = valid(prefs.proxyFtp)
  prefs.proxySocks = valid(prefs.proxySocks)
  const manual = [prefs.proxyHttp, prefs.proxyHttps, prefs.proxyFtp, prefs.proxySocks].some(
    (value) => value.length > 0
  )
  try {
    if (prefs.proxyMode === 'direct') {
      await session.defaultSession.setProxy({ mode: 'direct' })
    } else if (prefs.proxyMode === 'manual' && manual) {
      const rules = [
        prefs.proxyHttp && `http=${prefs.proxyHttp}`,
        prefs.proxyHttps && `https=${prefs.proxyHttps}`,
        prefs.proxyFtp && `ftp=${prefs.proxyFtp}`,
        prefs.proxySocks && `socks=${prefs.proxySocks}`
      ]
        .filter(Boolean)
        .join(';')
      await session.defaultSession.setProxy({ proxyRules: rules })
    } else {
      await session.defaultSession.setProxy({ mode: 'system' })
    }
  } catch {
    // A proxy the OS rejects leaves the previous one in place.
  }
}
