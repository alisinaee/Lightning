import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

// The panel over System Settings that asks for a permission: it gets its state, can start the
// drag of the app, reopen the settings pane, and close. Nothing else of the app.
contextBridge.exposeInMainWorld('grantPanel', {
  onState: (callback: (state: unknown) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, state: unknown): void => callback(state)
    ipcRenderer.on('grant:state', listener)
    ipcRenderer.send('grant:ready')
    return () => ipcRenderer.removeListener('grant:state', listener)
  },
  drag: (): void => ipcRenderer.send('grant:drag'),
  reopen: (): void => ipcRenderer.send('grant:reopen'),
  close: (): void => ipcRenderer.send('grant:close')
})
