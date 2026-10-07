import { contextBridge, ipcRenderer, webFrame, webUtils, type IpcRendererEvent } from 'electron'
import { IpcChannels } from '../shared/ipc-channels'
import type { IpcContract } from '../shared/ipc-contract'
import type { LabEvent } from '../shared/lab'
import type { ScheduleStatus } from '../shared/schedule'
import type {
  AppSettings,
  DnsConfig,
  DownloadUpdate,
  GroupPatch,
  InitialState,
  NetworkInterfaceInfo,
  RequestExtras,
  SettingsPush
} from '../shared/types'

/** Typed wrapper around ipcRenderer.invoke — the channel name picks its args/result shape out of
 * IpcContract, so a call here that doesn't match what registerIpcHandlers (main) actually handles
 * is a compile error instead of a silent runtime mismatch. */
function invoke<K extends keyof IpcContract>(
  channel: K,
  ...args: IpcContract[K]['args']
): Promise<IpcContract[K]['result']> {
  return ipcRenderer.invoke(IpcChannels[channel], ...args)
}

const lightningApi = {
  platform: process.platform,
  // Sync on purpose — see InitialState. One small read, once, before the renderer's first paint.
  initialState: ipcRenderer.sendSync(IpcChannels.getInitialState) as InitialState,

  listInterfaces: () => invoke('listInterfaces'),
  pingInterfaces: () => invoke('pingInterfaces'),
  deviceBindingSupported: () => invoke('deviceBindingSupported'),
  openNetworkSettings: () => invoke('openNetworkSettings'),
  updateSettings: (patch: AppSettings) => invoke('updateSettings', patch),
  getDns: () => invoke('getDns'),
  testDns: (url: string, currentDnsId: string | null, extras?: RequestExtras) =>
    invoke('testDns', url, currentDnsId, extras),
  saveDns: (input: IpcContract['saveDns']['args'][0]) => invoke('saveDns', input),
  removeDns: (id: string) => invoke('removeDns', id),
  setDefaultDns: (id: string | null) => invoke('setDefaultDns', id),
  setDownloadDns: (id: string, dnsId: string | null) => invoke('setDownloadDns', id, dnsId),
  getIntegration: () => invoke('getIntegration'),
  regenerateIntegrationKey: () => invoke('regenerateIntegrationKey'),
  openExtensionFolder: () => invoke('openExtensionFolder'),
  probeUrl: (url: string, extras?: RequestExtras) => invoke('probeUrl', url, extras),
  chooseDestinationFolder: (defaultPath: string) => invoke('chooseDestinationFolder', defaultPath),
  chooseTorrentFile: () => invoke('chooseTorrentFile'),
  /** Where a file dropped on the window is on disk ('' for one that isn't a file). */
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  readClipboardText: () => invoke('readClipboardText'),
  openLogs: () => invoke('openLogs'),
  readLog: (limit: number) => invoke('readLog', limit),
  openLogFolder: () => invoke('openLogFolder'),
  clearLog: () => invoke('clearLog'),
  diagnosticReport: () => invoke('diagnosticReport'),
  findDuplicates: (
    urls: string[],
    destinationDir?: string,
    options?: IpcContract['findDuplicates']['args'][2]
  ) => invoke('findDuplicates', urls, destinationDir, options),
  revealDownload: (id: string) => invoke('revealDownload', id),
  openDownloadedFile: (id: string) => invoke('openDownloadedFile', id),
  startDownload: (request: IpcContract['startDownload']['args'][0]) =>
    invoke('startDownload', request),
  listDownloads: () => invoke('listDownloads'),
  listHistory: () => invoke('listHistory'),
  clearHistory: () => invoke('clearHistory'),
  updateHistory: (id: string, fileName: string) => invoke('updateHistory', id, fileName),
  networkUsage: () => invoke('networkUsage'),
  resetNetworkUsage: (id) => invoke('resetNetworkUsage', id),
  freeSpace: (dir: string) => invoke('freeSpace', dir),
  torrentFiles: (downloadId: string) => invoke('torrentFiles', downloadId),
  chooseTorrentFiles: (downloadId: string, selected: number[]) =>
    invoke('chooseTorrentFiles', downloadId, selected),
  pauseDownload: (downloadId: string) => invoke('pauseDownload', downloadId),
  resumeDownload: (downloadId: string) => invoke('resumeDownload', downloadId),
  relinkDownload: (downloadId: string, url: string) => invoke('relinkDownload', downloadId, url),
  setDownloadNetwork: (downloadId: string, networkId: string, enabled: boolean) =>
    invoke('setDownloadNetwork', downloadId, networkId, enabled),
  cancelDownload: (downloadId: string) => invoke('cancelDownload', downloadId),
  removeDownload: (downloadId: string, options?: { trashFile?: boolean; keepEntry?: boolean }) =>
    invoke('removeDownload', downloadId, options),
  listGroups: () => invoke('listGroups'),
  createGroup: (input: IpcContract['createGroup']['args'][0]) => invoke('createGroup', input),
  updateGroup: (id: string, patch: GroupPatch) => invoke('updateGroup', id, patch),
  removeGroup: (id: string, options?: IpcContract['removeGroup']['args'][1]) =>
    invoke('removeGroup', id, options),
  addGroupItems: (id: string, requests: IpcContract['addGroupItems']['args'][1]) =>
    invoke('addGroupItems', id, requests),
  removeGroupItem: (id: string, itemId: string) => invoke('removeGroupItem', id, itemId),
  setGroupFileChoice: (id: string, fileId: string, networks: string[] | null) =>
    invoke('setGroupFileChoice', id, fileId, networks),
  retryGroup: (id: string, only?: string[]) => invoke('retryGroup', id, only),
  startGroup: (id: string) => invoke('startGroup', id),
  /** The text size choice (Settings → Appearance). Electron's own zoom, not CSS `zoom`: with CSS
   * zoom the page's coordinates stop matching the pointer's, and popups land in the wrong place. */
  setZoom: (factor: number) => webFrame.setZoomFactor(factor),
  checkForUpdate: () => invoke('checkForUpdate'),
  checkForUpdateNow: () => invoke('checkForUpdateNow'),
  takePendingLink: () => invoke('takePendingLink'),
  labList: () => invoke('labList'),
  labGetState: () => invoke('labGetState'),
  labRun: (planId: string) => invoke('labRun', planId),
  labRunAll: () => invoke('labRunAll'),
  labVerify: (planId: string) => invoke('labVerify', planId),
  labStop: () => invoke('labStop'),

  /** Settings were changed from main (the Test lab): the switches must follow. */
  onSettingsChanged: (callback: (settings: SettingsPush) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, settings: SettingsPush): void => callback(settings)
    ipcRenderer.on(IpcChannels.settingsChanged, listener)
    return () => ipcRenderer.removeListener(IpcChannels.settingsChanged, listener)
  },

  /** The Test lab's state changed (a step, an assertion, a sample). */
  onLabEvent: (callback: (event: LabEvent) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, event: LabEvent): void => callback(event)
    ipcRenderer.on(IpcChannels.labEvent, listener)
    return () => ipcRenderer.removeListener(IpcChannels.labEvent, listener)
  },

  /** The OS handed Lightning a link (a magnet link, a .torrent): takePendingLink() has it. */
  onAppCommand: (callback: (command: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, command: string): void => callback(command)
    ipcRenderer.on(IpcChannels.appCommand, listener)
    return () => ipcRenderer.removeListener(IpcChannels.appCommand, listener)
  },

  /** The schedule opened or closed (or its cap changed). */
  onScheduleChanged: (callback: (status: ScheduleStatus) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, status: ScheduleStatus): void => callback(status)
    ipcRenderer.on(IpcChannels.scheduleChanged, listener)
    return () => ipcRenderer.removeListener(IpcChannels.scheduleChanged, listener)
  },

  onLinkReceived: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IpcChannels.linkReceived, listener)
    return () => ipcRenderer.removeListener(IpcChannels.linkReceived, listener)
  },

  onDownloadUpdated: (callback: (update: DownloadUpdate) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, update: DownloadUpdate): void => callback(update)
    ipcRenderer.on(IpcChannels.downloadUpdated, listener)
    return () => ipcRenderer.removeListener(IpcChannels.downloadUpdated, listener)
  },

  /** A download was added to the finished ones or forgotten: listHistory() has them. */
  onHistoryChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IpcChannels.historyChanged, listener)
    return () => ipcRenderer.removeListener(IpcChannels.historyChanged, listener)
  },

  /** The saved DNS profiles or the app's default changed. */
  onDnsChanged: (callback: (config: DnsConfig) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, config: DnsConfig): void => callback(config)
    ipcRenderer.on(IpcChannels.dnsChanged, listener)
    return () => ipcRenderer.removeListener(IpcChannels.dnsChanged, listener)
  },

  /** A group was made, changed or removed: listGroups() has them. */
  onGroupsChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IpcChannels.groupsChanged, listener)
    return () => ipcRenderer.removeListener(IpcChannels.groupsChanged, listener)
  },

  onNetworksChanged: (callback: (networks: NetworkInterfaceInfo[]) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, networks: NetworkInterfaceInfo[]): void =>
      callback(networks)
    ipcRenderer.on(IpcChannels.networksChanged, listener)
    return () => ipcRenderer.removeListener(IpcChannels.networksChanged, listener)
  }
}

export type LightningApi = typeof lightningApi

// Nothing in the renderer needs raw Electron/Node access — only the typed lightningApi above is
// exposed. The @electron-toolkit/preload electronAPI (which hands the renderer an unrestricted
// ipcRenderer.invoke/send/on on any channel) is deliberately not bridged.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('lightning', lightningApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.lightning = lightningApi
}
