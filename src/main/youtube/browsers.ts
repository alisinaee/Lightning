import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { YoutubeOptions } from '../../shared/youtube'

type BrowserId = Exclude<YoutubeOptions['cookiesBrowser'], ''>

const MAC_APPS: Record<BrowserId, string> = {
  chrome: 'Google Chrome.app',
  safari: 'Safari.app',
  firefox: 'Firefox.app',
  edge: 'Microsoft Edge.app',
  brave: 'Brave Browser.app'
}

const WINDOWS_EXES: Record<Exclude<BrowserId, 'safari'>, string[]> = {
  chrome: ['Google\\Chrome\\Application\\chrome.exe'],
  firefox: ['Mozilla Firefox\\firefox.exe'],
  edge: ['Microsoft\\Edge\\Application\\msedge.exe'],
  brave: ['BraveSoftware\\Brave-Browser\\Application\\brave.exe']
}

const LINUX_BINS: Record<Exclude<BrowserId, 'safari'>, string[]> = {
  chrome: ['google-chrome', 'google-chrome-stable', 'chromium'],
  firefox: ['firefox'],
  edge: ['microsoft-edge', 'microsoft-edge-stable'],
  brave: ['brave-browser', 'brave']
}

/** The browsers yt-dlp can read a sign-in from that are installed on this computer, most common first. */
export function installedBrowsers(): BrowserId[] {
  const order: BrowserId[] = ['chrome', 'safari', 'firefox', 'edge', 'brave']
  return order.filter((id) => {
    if (process.platform === 'darwin') {
      const app = MAC_APPS[id]
      return (
        existsSync(join('/Applications', app)) || existsSync(join(homedir(), 'Applications', app))
      )
    }
    if (id === 'safari') return false
    if (process.platform === 'win32') {
      const roots = [
        process.env['ProgramFiles'],
        process.env['ProgramFiles(x86)'],
        process.env['LOCALAPPDATA']
      ]
      return WINDOWS_EXES[id].some((exe) =>
        roots.some((root) => root && existsSync(join(root, exe)))
      )
    }
    return LINUX_BINS[id].some((bin) =>
      (process.env.PATH ?? '').split(':').some((dir) => dir && existsSync(join(dir, bin)))
    )
  })
}
