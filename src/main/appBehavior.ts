import { app, session } from 'electron'
import type { AppSettings } from '../shared/types'
import { isProxyAddress } from '../shared/networks'
import { prefsOf } from './settings'

/** What Settings asked of the process itself: hiding on close, the Dock, and the proxy. */
export const behavior = {
  closeHides: true
}

/** Applies the parts of Settings that live outside a download: the Dock, and the proxy the
 * app's own requests use. */
export async function applyBehavior(settings: AppSettings): Promise<void> {
  const prefs = prefsOf(settings)
  behavior.closeHides = prefs.closeToBackground
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
