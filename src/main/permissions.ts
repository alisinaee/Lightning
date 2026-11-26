import { app, BrowserWindow, ipcMain, nativeImage, screen, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { open, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { getLanguage } from '../shared/i18n'
import type { GrantPanelState, PermissionKind, PermissionStatus } from '../shared/permissions'
import { getDefaultDownloadsDir } from './download/paths'
import { log } from './logger'
import dragIcon from '../../resources/icon-drag.png?asset'
import { loadSettings } from './settings'

// macOS privacy permissions, and the small panel that floats over System Settings so the person
// can drag Lightning into the list (the way modern Mac apps ask for Full Disk Access).

const PANE: Record<PermissionKind, string> = {
  fullDisk: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
  folder: 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders',
  notifications: 'x-apple.systempreferences:com.apple.Notifications-Settings.extension'
}

const WIDTH = 480
const HEIGHT = 184
/** Room between the panel and the bottom of the screen's free area. */
const BOTTOM_GAP = 28
/** How often the panel checks whether the permission was given. */
const POLL_MS = 1200
/** How long "Allowed" stays up before the panel closes. */
const DONE_MS = 1600

/** Full Disk Access: reading the privacy database itself is allowed only with it. */
async function hasFullDiskAccess(): Promise<boolean> {
  try {
    const file = await open(
      join(homedir(), 'Library/Application Support/com.apple.TCC/TCC.db'),
      'r'
    )
    await file.close()
    return true
  } catch {
    return false
  }
}

async function hasFolderAccess(): Promise<boolean> {
  const settings = await loadSettings().catch(() => null)
  try {
    await readdir(settings?.destinationDir ?? getDefaultDownloadsDir())
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code !== 'EPERM' && code !== 'EACCES'
  }
}

/** What Lightning holds now. Off macOS there is nothing to ask for. */
export async function permissionStatus(): Promise<PermissionStatus> {
  if (process.platform !== 'darwin') return { fullDisk: true, folder: true, notifications: null }
  // A folder check can wait on a macOS prompt the person has not answered: past a moment it
  // reads as unknown, so the other rows still show.
  const [fullDisk, folder] = await Promise.all([
    hasFullDiskAccess(),
    Promise.race([
      hasFolderAccess(),
      new Promise<null>((resolve) => setTimeout(resolve, 1500, null))
    ])
  ])
  // macOS reports notification permission to no one outside the app's own notification center.
  return { fullDisk, folder, notifications: null }
}

async function granted(kind: PermissionKind): Promise<boolean | null> {
  if (kind === 'fullDisk') return hasFullDiskAccess()
  if (kind === 'folder') return hasFolderAccess()
  return null
}

/** Lightning's icon, small, for the drag. (A 1024 px icon decoded here takes Electron 44 down,
 * as app.getFileIcon does; the panel shows its own copy.) */
function iconImage(): Electron.NativeImage {
  return nativeImage.createFromPath(dragIcon)
}

/** The app bundle System Settings must list: Lightning.app, or Electron.app in a dev run. */
function appBundle(): string | null {
  let path = app.getPath('exe')
  while (path !== dirname(path)) {
    if (path.endsWith('.app')) return path
    path = dirname(path)
  }
  return null
}

let panel: BrowserWindow | null = null
let poll: NodeJS.Timeout | null = null
let state: GrantPanelState | null = null

function closePanel(): void {
  if (poll) clearInterval(poll)
  poll = null
  state = null
  if (panel && !panel.isDestroyed()) panel.close()
  panel = null
}

function send(): void {
  if (panel && !panel.isDestroyed() && state) panel.webContents.send('grant:state', state)
}

/** Opens System Settings at `kind`'s list, with the drag panel over it until it is allowed. */
export async function guidePermission(kind: PermissionKind): Promise<void> {
  if (process.platform !== 'darwin') return
  await shell.openExternal(PANE[kind])
  log.info('app', `guiding the ${kind} permission`)
  const bundle = appBundle()
  // Notifications have no status to watch, and a list the person can't drop into.
  if (kind === 'notifications') return
  if (await granted(kind)) return
  state = {
    kind,
    status: 'waiting',
    // Only Full Disk Access takes an app dropped on it; Files and Folders lists it by itself.
    draggable: kind === 'fullDisk' && bundle !== null,
    appName: app.getName(),
    language: getLanguage()
  }
  showPanel()
  if (poll) clearInterval(poll)
  poll = setInterval(() => {
    void granted(kind).then((ok) => {
      if (!ok || !state || state.kind !== kind || state.status === 'allowed') return
      state = { ...state, status: 'allowed' }
      send()
      log.info('app', `${kind} permission allowed`)
      setTimeout(closePanel, DONE_MS)
    })
  }, POLL_MS)
}

function showPanel(): void {
  if (panel && !panel.isDestroyed()) {
    send()
    panel.showInactive()
    return
  }
  const area = screen.getPrimaryDisplay().workArea
  const window = (panel = new BrowserWindow({
    x: Math.round(area.x + area.width / 2 - WIDTH / 2),
    y: Math.round(area.y + area.height - HEIGHT - BOTTOM_GAP),
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    // Never takes the focus: System Settings stays in front and keeps it. (Not type: 'panel',
    // which crashes Electron 44 on macOS when the window is made.)
    focusable: false,
    acceptFirstMouse: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: 'hud',
    visualEffectState: 'active',
    roundedCorners: true,
    webPreferences: {
      preload: join(__dirname, '../preload/grant.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  }))
  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.once('ready-to-show', () => window.showInactive())
  window.on('closed', () => {
    if (panel === window) {
      panel = null
      if (poll) clearInterval(poll)
      poll = null
      state = null
    }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/grant.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/grant.html'))
  }
}

/** The panel's own messages: its state when it loads, the drag of the app, and closing. */
export function registerGrantPanel(): void {
  ipcMain.on('grant:ready', (event) => {
    if (state && panel && event.sender === panel.webContents) send()
  })
  ipcMain.on('grant:drag', (event) => {
    if (!panel || event.sender !== panel.webContents) return
    const bundle = appBundle()
    if (!bundle) return
    // The app's icon goes with the drag, as it would from Finder.
    panel.webContents.startDrag({
      file: bundle,
      icon: iconImage().resize({ width: 64, height: 64 })
    })
  })
  ipcMain.on('grant:close', (event) => {
    if (panel && event.sender === panel.webContents) closePanel()
  })
  ipcMain.on('grant:reopen', (event) => {
    if (state && panel && event.sender === panel.webContents) {
      void shell.openExternal(PANE[state.kind])
    }
  })
}
