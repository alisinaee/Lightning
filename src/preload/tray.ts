import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

// The panel under the menu-bar icon is its own small page: it gets a snapshot about once a second
// and can ask for a few things, and nothing else of the app.
contextBridge.exposeInMainWorld('trayPanel', {
  onState: (callback: (state: unknown) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, state: unknown): void => callback(state)
    ipcRenderer.on('tray:state', listener)
    ipcRenderer.send('tray:ready')
    return () => ipcRenderer.removeListener('tray:state', listener)
  },
  act: (action: unknown): void => ipcRenderer.send('tray:action', action),
  resize: (height: number): void => ipcRenderer.send('tray:resize', height)
})
