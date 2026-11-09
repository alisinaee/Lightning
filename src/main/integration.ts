import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access, cp, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, nativeImage, shell } from 'electron'
import type { BrowserInfo } from '@shared/types'
import { loadSettings, saveSettings } from './settings'

const TOKEN_FORMAT = /^[0-9a-f]{64}$/

/** The pairing key of the browser extension, made on first use and kept in the settings file. */
export async function integrationToken(): Promise<string> {
  const saved = (await loadSettings()).integrationToken
  if (saved && TOKEN_FORMAT.test(saved)) return saved
  return regenerateToken()
}

/** A new key: the extension paired with the old one is unpaired. */
export async function regenerateToken(): Promise<string> {
  const token = randomBytes(32).toString('hex')
  await saveSettings({ integrationToken: token })
  // The set-up extension reads its key from beside its files: it follows the new one.
  await refreshInstalledExtension().catch(() => {})
  return token
}

export function isTokenFormat(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_FORMAT.test(value)
}

/** Where the extension's files are: beside the app's resources when packaged, in the project
 * folder in development. */
export function extensionFolder(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'extension')
    : join(app.getAppPath(), 'extension')
}

/** Where the extension is set up for browsers to load: in Documents, since a browser's folder
 * picker cannot step inside the app bundle and hides ~/Library. It must never move: a browser
 * loads an unpacked extension from this path for good. */
export function installedExtensionFolder(): string {
  return join(app.getPath('documents'), 'Lightning Extension')
}

/** Copies the extension to its visible folder (replacing an older copy) with the pairing key
 * beside it, so the extension pairs itself. */
export async function installExtension(): Promise<string> {
  const target = installedExtensionFolder()
  await cp(extensionFolder(), target, { recursive: true, force: true })
  await writePairing(target)
  return target
}

/** Refreshes a copy made earlier (after an app update or a new key); makes none. */
export async function refreshInstalledExtension(): Promise<void> {
  const target = installedExtensionFolder()
  try {
    await access(join(target, 'manifest.json'))
  } catch {
    return
  }
  await installExtension()
}

async function writePairing(folder: string): Promise<void> {
  const key = await integrationToken()
  await writeFile(join(folder, 'pairing.json'), JSON.stringify({ key }) + '\n', { mode: 0o600 })
}

interface BrowserTarget {
  id: string
  name: string
  /** The app's file name in /Applications (macOS). */
  app: string
  /** Its extensions page. */
  page: string
  firefox?: boolean
  /** Loaded until the browser quits. */
  temporary?: boolean
}

const BROWSERS: BrowserTarget[] = [
  { id: 'chrome', name: 'Chrome', app: 'Google Chrome.app', page: 'chrome://extensions' },
  { id: 'edge', name: 'Edge', app: 'Microsoft Edge.app', page: 'edge://extensions' },
  { id: 'brave', name: 'Brave', app: 'Brave Browser.app', page: 'brave://extensions' },
  { id: 'arc', name: 'Arc', app: 'Arc.app', page: 'arc://extensions' },
  { id: 'vivaldi', name: 'Vivaldi', app: 'Vivaldi.app', page: 'vivaldi://extensions' },
  { id: 'opera', name: 'Opera', app: 'Opera.app', page: 'opera://extensions' },
  { id: 'chromium', name: 'Chromium', app: 'Chromium.app', page: 'chrome://extensions' },
  // Safari 18+: Develop → Developer Settings → Add Temporary Extension (no page to open).
  { id: 'safari', name: 'Safari', app: 'Safari.app', page: '', temporary: true },
  {
    id: 'firefox',
    name: 'Firefox',
    app: 'Firefox.app',
    // open(1) escapes a '#', so the page itself; the steps say to click This Firefox.
    page: 'about:debugging',
    firefox: true,
    temporary: true
  }
]

async function appPath(name: string): Promise<string | null> {
  for (const folder of ['/Applications', join(homedir(), 'Applications')]) {
    const path = join(folder, name)
    try {
      await access(path)
      return path
    } catch {
      // Not here.
    }
  }
  return null
}

/** The browsers on this Mac the extension can be added to (none listed on other systems). */
export async function installedBrowsers(): Promise<BrowserInfo[]> {
  if (process.platform !== 'darwin') return []
  const found = await Promise.all(
    BROWSERS.map(async (browser): Promise<BrowserInfo | null> => {
      const path = await appPath(browser.app)
      if (!path) return null
      // The browser's own app icon, as the Finder shows it (getFileIcon gives a generic one).
      const icon = await nativeImage
        .createThumbnailFromPath(path, { width: 64, height: 64 })
        .then((image) => image.toDataURL())
        .catch(() => '')
      return {
        id: browser.id,
        name: browser.name,
        firefox: browser.firefox === true,
        temporary: browser.temporary === true,
        icon
      }
    })
  )
  return found.filter((browser): browser is BrowserInfo => browser !== null)
}

/** Sets the extension up and opens the browser's extensions page beside the folder in Finder,
 * ready to drag in. Elsewhere, just shows the folder. */
export async function addExtensionToBrowser(id: string): Promise<string> {
  const folder = await installExtension()
  const browser = BROWSERS.find((entry) => entry.id === id)
  const path = browser && process.platform === 'darwin' ? await appPath(browser.app) : null
  if (!browser || !path) {
    const failure = await shell.openPath(folder)
    if (failure) throw new Error(failure)
    return folder
  }
  const args = browser.page ? ['-a', path, browser.page] : ['-a', path]
  await new Promise<void>((resolve, reject) =>
    execFile('open', args, (error) => (error ? reject(error) : resolve()))
  )
  // Firefox wants the manifest file itself; Chromium browsers and Safari take the whole folder.
  shell.showItemInFolder(browser.firefox ? join(folder, 'manifest.json') : folder)
  return folder
}
