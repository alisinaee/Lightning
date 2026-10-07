import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, screen, type Tray } from 'electron'
import { is } from '@electron-toolkit/utils'
import { shouldClosePanel } from '../shared/panelFocus'
import { buildPanelState, type PanelAction } from '../shared/trayPanel'
import type { DownloadState } from '../shared/types'
import { getTrayConfig } from './trayConfig'

const WIDTH = 340
const MIN_HEIGHT = 160
const MAX_HEIGHT = 640
const HISTORY_POINTS = 60
/** A click on the icon while the panel is open first blurs the panel (which hides it); this long
 * after that, the click is the same one, not a request to open it again. */
const REOPEN_GUARD_MS = 250

const ACTIONS = new Set([
  'new-download',
  'several-links',
  'pause-all',
  'resume-all',
  'settings',
  'show',
  'quit'
])

function validAction(value: unknown): value is PanelAction {
  if (typeof value !== 'object' || value === null) return false
  const { type, id } = value as { type?: unknown; id?: unknown }
  if (type === 'open-download' || type === 'pause') return typeof id === 'string' && id.length < 100
  return typeof type === 'string' && ACTIONS.has(type)
}

export interface TrayPanel {
  window: BrowserWindow
  /** Opens it under the icon, or closes it if it is open. */
  toggle: (tray: Tray) => void
  hide: () => void
}

/** The panel under the menu-bar icon: a small window of its own, with the live bars, colours,
 * graph and buttons a native menu cannot have. It is built once and shown and hidden. `always`
 * keeps it supplied with snapshots while hidden (the test suite reads it that way). */
export function createTrayPanel(deps: {
  downloads: () => readonly DownloadState[]
  version: string
  act: (action: PanelAction) => void
  always?: boolean
}): TrayPanel {
  let current: BrowserWindow | null = null
  let hiddenAt = 0
  let shownAt = 0
  let watch: NodeJS.Timeout | null = null

  /** The window, made the first time it is wanted. */
  function ensure(): BrowserWindow {
    if (current && !current.isDestroyed()) return current
    const window = (current = make())
    return window
  }

  function make(): BrowserWindow {
    const window = new BrowserWindow({
      width: WIDTH,
      height: 420,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      transparent: process.platform === 'darwin',
      backgroundColor: process.platform === 'darwin' ? '#00000000' : undefined,
      ...(process.platform === 'darwin'
        ? { vibrancy: 'popover' as const, visualEffectState: 'active' as const }
        : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/tray.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Hidden, it need not draw; it is told when it is shown.
        backgroundThrottling: !deps.always
      }
    })
    window.setAlwaysOnTop(true, 'pop-up-menu')
    // The page is the panel's own: nowhere else to go, and no new windows.
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/tray.html`)
    } else {
      void window.loadFile(join(__dirname, '../renderer/tray.html'))
    }

    window.on('blur', () => {
      if (!window.isVisible()) return
      hiddenAt = Date.now()
      window.hide()
    })
    window.on('hide', () => {
      hiddenAt = Date.now()
      if (watch) clearInterval(watch)
      watch = null
    })
    window.on('closed', () => {
      current = null
    })
    window.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') window.hide()
    })
    return window
  }

  // The total speed once a second, for the graph. Taken whether or not the panel exists.
  const history: number[] = []
  const sample = setInterval(() => {
    const speed = deps
      .downloads()
      .reduce((sum, d) => sum + (d.status === 'downloading' ? d.speedBytesPerSec : 0), 0)
    history.push(speed)
    if (history.length > HISTORY_POINTS) history.shift()
    if (current && !current.isDestroyed() && (current.isVisible() || deps.always)) push()
  }, 1000)
  sample.unref()

  function push(): void {
    if (!current || current.isDestroyed()) return
    const config = getTrayConfig()
    current.webContents.send(
      'tray:state',
      buildPanelState({
        downloads: deps.downloads(),
        history: [...history],
        prefs: config.prefs,
        names: config.names,
        networkPreferences: config.networkPreferences,
        accent: config.accent,
        version: deps.version
      })
    )
  }

  // Only the panel's own page may ask, and only for what a person could press there.
  const fromPanel = (event: { sender: Electron.WebContents }): boolean =>
    current !== null && !current.isDestroyed() && event.sender === current.webContents
  ipcMain.on('tray:ready', (event) => {
    if (fromPanel(event)) push()
  })
  ipcMain.on('tray:resize', (event, height: unknown) => {
    if (!fromPanel(event) || typeof height !== 'number' || !current) return
    const next = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)))
    if (next !== current.getSize()[1]) current.setSize(WIDTH, next, false)
  })
  ipcMain.on('tray:action', (event, action: unknown) => {
    if (!fromPanel(event) || !validAction(action) || !current) return
    // What opens the main window or ends the app closes the panel first.
    if (action.type !== 'pause') current.hide()
    deps.act(action)
  })

  function place(window: BrowserWindow, tray: Tray): void {
    const bounds = tray.getBounds()
    const size = window.getBounds()
    const area = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea
    const x = Math.round(bounds.x + bounds.width / 2 - size.width / 2)
    const clampedX = Math.min(Math.max(x, area.x + 6), area.x + area.width - size.width - 6)
    const below = bounds.y < area.y + area.height / 2
    const y = below ? bounds.y + bounds.height + 4 : bounds.y - size.height - 4
    window.setPosition(clampedX, Math.round(y), false)
  }

  if (deps.always) ensure()

  return {
    get window() {
      return ensure()
    },
    hide: () => current?.hide(),
    toggle: (tray) => {
      const window = ensure()
      if (window.isVisible()) {
        window.hide()
        return
      }
      if (Date.now() - hiddenAt < REOPEN_GUARD_MS) return
      place(window, tray)
      push()
      // An app that is not the active one (its Dock icon hidden, its window closed) must be made
      // active, or the panel never has the focus it would lose when someone clicks elsewhere.
      if (process.platform === 'darwin') app.focus({ steal: true })
      window.show()
      window.focus()
      shownAt = Date.now()
      // The "blur" event is not always sent, so a click elsewhere is also noticed here.
      if (watch) clearInterval(watch)
      watch = setInterval(() => {
        if (
          shouldClosePanel({
            visible: window.isVisible(),
            focused: window.isFocused(),
            shownAt,
            now: Date.now()
          })
        ) {
          window.hide()
        }
      }, 250)
      watch.unref()
    }
  }
}
