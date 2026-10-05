import { readFileSync } from 'fs'
import { app, Menu, Tray, nativeImage, type BrowserWindow } from 'electron'
import trayTemplate from '../../resources/trayTemplate.png?asset'
import { IpcChannels } from '../shared/ipc-channels'

export type AppCommand =
  | 'new-download'
  | 'several-links'
  | 'pause-all'
  | 'resume-all'
  | 'settings'
  | 'check-update'
  | 'logs'

function send(getWindow: () => BrowserWindow | null, command: AppCommand): void {
  const window = getWindow()
  if (!window || window.isDestroyed()) return
  if (!window.isVisible()) window.show()
  window.focus()
  window.webContents.send(IpcChannels.appCommand, command)
}

function show(getWindow: () => BrowserWindow | null): void {
  const window = getWindow()
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/** The Apple menu bar: the app's own actions, not only the stock File and Edit roles. */
export function installAppMenu(getWindow: () => BrowserWindow | null): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              {
                label: 'Settings…',
                accelerator: 'CommandOrControl+,',
                click: () => send(getWindow, 'settings')
              },
              {
                label: 'Check for Updates…',
                click: () => send(getWindow, 'check-update')
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Download…',
          accelerator: 'CommandOrControl+N',
          click: () => send(getWindow, 'new-download')
        },
        {
          label: 'Add Several Links…',
          accelerator: 'CommandOrControl+Shift+N',
          click: () => send(getWindow, 'several-links')
        },
        { type: 'separator' },
        { label: 'Pause All', click: () => send(getWindow, 'pause-all') },
        { label: 'Resume All', click: () => send(getWindow, 'resume-all') },
        { type: 'separator' },
        ...(process.platform === 'darwin'
          ? [{ role: 'close' as const }]
          : [{ role: 'quit' as const }])
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        { label: 'Logs', click: () => send(getWindow, 'logs') },
        { label: 'Settings…', click: () => send(getWindow, 'settings') }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** The menu-bar status icon: a filled bolt the system tints, like other menu-bar apps. */
export function installTray(getWindow: () => BrowserWindow | null): Tray {
  // 36px artwork at scale 2, so the menu bar shows an 18pt filled bolt and stays sharp.
  const image = nativeImage.createFromBuffer(readFileSync(trayTemplate), { scaleFactor: 2 })
  image.setTemplateImage(true)
  const tray = new Tray(image)
  tray.setToolTip(app.name)
  const menu = Menu.buildFromTemplate([
    { label: 'Show Lightning', click: () => show(getWindow) },
    { type: 'separator' },
    { label: 'New Download…', click: () => send(getWindow, 'new-download') },
    { label: 'Add Several Links…', click: () => send(getWindow, 'several-links') },
    { label: 'Pause All', click: () => send(getWindow, 'pause-all') },
    { label: 'Resume All', click: () => send(getWindow, 'resume-all') },
    { type: 'separator' },
    { label: 'Settings…', click: () => send(getWindow, 'settings') },
    { label: 'Check for Updates…', click: () => send(getWindow, 'check-update') },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => show(getWindow))
  return tray
}
