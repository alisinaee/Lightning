import { registerGlassWindow } from './glass'
import { BrowserWindow, nativeTheme } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'
import { IpcChannels } from '../shared/ipc-channels'

let current: BrowserWindow | null = null

/** Settings in a window of its own, so the main window stays usable beside it. One at a time:
 * asked again, the open one comes forward (on the page asked for). */
export function openSettingsWindow(page?: string): void {
  const hash = `settings/${encodeURIComponent(page ?? 'General')}`
  if (current && !current.isDestroyed()) {
    if (current.isMinimized()) current.restore()
    current.show()
    current.focus()
    if (page) current.webContents.send(IpcChannels.appCommand, 'settings-page', page)
    return
  }
  const window = new BrowserWindow({
    width: 900,
    height: 680,
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

/** Tells every window that settings were saved, so each reads them again. */
export function broadcastSettingsRefresh(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IpcChannels.settingsRefresh)
  }
}
