import { registerGlassWindow } from './glass'
import { BrowserWindow, nativeTheme, screen, type Display } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'
import { IpcChannels } from '../shared/ipc-channels'

let current: BrowserWindow | null = null

const SIZE = { width: 900, height: 680 }

/** The display Lightning is on: the window that asked, else the one the pointer is on. */
function displayFor(host: BrowserWindow | null | undefined): Display {
  if (host && !host.isDestroyed()) return screen.getDisplayMatching(host.getBounds())
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

/** Where a window of this size sits centered on that display's work area. */
function centeredOn(display: Display, width: number, height: number): { x: number; y: number } {
  const area = display.workArea
  return {
    x: area.x + Math.max(0, Math.round((area.width - width) / 2)),
    y: area.y + Math.max(0, Math.round((area.height - height) / 2))
  }
}

/** Settings in a window of its own, so the main window stays usable beside it. One at a time:
 * asked again, the open one comes forward (on the page asked for). It opens on the display the
 * asking window is on, not whichever display macOS picks. */
export function openSettingsWindow(page?: string, host?: BrowserWindow | null): void {
  const hash = `settings/${encodeURIComponent(page ?? 'General')}`
  const display = displayFor(host)
  if (current && !current.isDestroyed()) {
    if (current.isMinimized()) current.restore()
    if (screen.getDisplayMatching(current.getBounds()).id !== display.id) {
      const { x, y } = centeredOn(display, SIZE.width, SIZE.height)
      current.setBounds({ x, y, ...SIZE })
    }
    current.show()
    current.focus()
    if (page) current.webContents.send(IpcChannels.appCommand, 'settings-page', page)
    return
  }
  const { x, y } = centeredOn(display, SIZE.width, SIZE.height)
  const window = new BrowserWindow({
    ...SIZE,
    x,
    y,
    // Smaller than this and the pages' rows no longer fit.
    minWidth: 860,
    minHeight: 620,
    title: 'Settings',
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'darwin'
      ? { vibrancy: 'under-window' as const, visualEffectState: 'active' as const }
      : {}),
    backgroundColor:
      process.platform === 'darwin'
        ? '#00000000'
        : nativeTheme.shouldUseDarkColors
          ? '#1b1e20'
          : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  current = window
  registerGlassWindow(window)
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    current = null
  })
  // Its page is its own: no other place to go, and no new windows.
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#${hash}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }
}

/** Puts an open Settings window back above the main window, without taking focus. The main
 * window coming back from the Dock otherwise covers it. */
export function raiseSettingsWindow(): void {
  if (!current || current.isDestroyed() || current.isMinimized() || !current.isVisible()) return
  const window = current
  // After the restore animation, or macOS orders the main window over it again.
  setTimeout(() => {
    if (!window.isDestroyed() && window.isVisible()) window.moveTop()
  }, 350)
}

/** Tells every window that settings were saved, so each reads them again. */
export function broadcastSettingsRefresh(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IpcChannels.settingsRefresh)
  }
}
