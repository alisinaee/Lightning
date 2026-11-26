import { contextBridge, ipcRenderer, webFrame, webUtils, type IpcRendererEvent } from 'electron'
import { IpcChannels } from '../shared/ipc-channels'
import type { IpcContract } from '../shared/ipc-contract'
import type { LabEvent } from '../shared/lab'
import type { ScheduleStatus } from '../shared/schedule'
import type { TdlJob, TdlLoginEvent } from '../shared/telegram'
import type {
  StartYoutubeRequest,
  YoutubeJob,
  YoutubeOptions,
  YoutubeStatus,
  YoutubeVideoMeta
} from '../shared/youtube'
import type {
  AppSettings,
  ClipboardHistoryEntry,
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

/** Typed wrapper around ipcRenderer.on + removeListener so each push subscription strips the
 * Electron event argument and returns a stable unsubscribe function. */
function subscribe<Args extends unknown[]>(
  channel: keyof typeof IpcChannels,
  callback: (...args: Args) => void
): () => void {
  const ipcChannel = IpcChannels[channel]
  const listener = (_event: IpcRendererEvent, ...args: unknown[]): void => {
    callback(...(args as Args))
  }
  ipcRenderer.on(ipcChannel, listener)
  return () => ipcRenderer.removeListener(ipcChannel, listener)
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
  openSettingsWindow: (page?: string) => invoke('openSettingsWindow', page),
  runMainCommand: (command: 'limits' | 'tour' | 'intro') => invoke('runMainCommand', command),
  /** The saved state as it is now (initialState is the one read at start). */
  readInitialState: () => ipcRenderer.sendSync(IpcChannels.getInitialState) as InitialState,
  /** Settings were saved from some window: read them again. */
  onSettingsRefresh: (callback: () => void): (() => void) => subscribe('settingsRefresh', callback),
  tdlStatus: () => invoke('tdlStatus'),
  tdlLoginStart: (...args: IpcContract['tdlLoginStart']['args']) =>
    invoke('tdlLoginStart', ...args),
  tdlLoginAnswer: (sessionId: string, value: string) => invoke('tdlLoginAnswer', sessionId, value),
  tdlLoginCancel: (sessionId: string) => invoke('tdlLoginCancel', sessionId),
  tdlLogout: () => invoke('tdlLogout'),
  tdlListChats: () => invoke('tdlListChats'),
  tdlExportPreview: (input: IpcContract['tdlExportPreview']['args'][0]) =>
    invoke('tdlExportPreview', input),
  tdlStartJob: (input: IpcContract['tdlStartJob']['args'][0]) => invoke('tdlStartJob', input),
  tdlListJobs: () => invoke('tdlListJobs'),
  tdlPauseJob: (id: string) => invoke('tdlPauseJob', id),
  tdlResumeJob: (id: string) => invoke('tdlResumeJob', id),
  tdlCancelJob: (id: string) => invoke('tdlCancelJob', id),
  tdlRetryJob: (id: string) => invoke('tdlRetryJob', id),
  tdlRemoveJob: (id: string, options?: { trashFiles?: boolean }) =>
    invoke('tdlRemoveJob', id, options),
  tdlRevealItem: (jobId: string, key: string) => invoke('tdlRevealItem', jobId, key),
  tdlOpenItem: (jobId: string, key: string) => invoke('tdlOpenItem', jobId, key),

  youtubeStatus: (): Promise<YoutubeStatus> => invoke('youtubeStatus'),
  youtubeProbe: (url: string, offerId?: string): Promise<YoutubeVideoMeta> =>
    invoke('youtubeProbe', url, offerId),
  youtubeStart: (request: StartYoutubeRequest): Promise<YoutubeJob> =>
    invoke('youtubeStart', request),
  youtubeListJobs: (): Promise<YoutubeJob[]> => invoke('youtubeListJobs'),
  youtubePauseJob: (id: string): Promise<void> => invoke('youtubePauseJob', id),
  youtubeResumeJob: (id: string): Promise<void> => invoke('youtubeResumeJob', id),
  youtubeCancelJob: (id: string): Promise<void> => invoke('youtubeCancelJob', id),
  youtubeRetryJob: (id: string): Promise<void> => invoke('youtubeRetryJob', id),
  youtubeRemoveJob: (id: string, deleteFile?: boolean): Promise<void> =>
    invoke('youtubeRemoveJob', id, deleteFile),
  youtubeRevealJob: (id: string): Promise<void> => invoke('youtubeRevealJob', id),
  youtubeOpenJob: (id: string): Promise<void> => invoke('youtubeOpenJob', id),
  youtubeGetOptions: (): Promise<YoutubeOptions> => invoke('youtubeGetOptions'),
  youtubeSetOptions: (options: Partial<YoutubeOptions>): Promise<YoutubeOptions> =>
    invoke('youtubeSetOptions', options),
  youtubeChooseFolder: (defaultPath?: string): Promise<string | null> =>
    invoke('youtubeChooseFolder', defaultPath),
  youtubeChooseCookies: (): Promise<string | null> => invoke('youtubeChooseCookies'),
  youtubeBrowsers: () => invoke('youtubeBrowsers'),
  openFullDiskAccess: (): Promise<void> => invoke('openFullDiskAccess'),
  permissionStatus: () => invoke('permissionStatus'),
  guidePermission: (kind: IpcContract['guidePermission']['args'][0]): Promise<void> =>
    invoke('guidePermission', kind),
  youtubeCancelOffer: (id: string): Promise<void> => invoke('youtubeCancelOffer', id),
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
  listBrowsers: () => invoke('listBrowsers'),
  addExtensionToBrowser: (id: string) => invoke('addExtensionToBrowser', id),
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
  usageHistory: (query) => invoke('usageHistory', query),
  scanPage: (url, all, extras) => invoke('scanPage', url, all, extras),
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
  getClipboardHistory: () => invoke('getClipboardHistory'),
  removeClipboardEntry: (id: string) => invoke('removeClipboardEntry', id),
  clearClipboardHistory: () => invoke('clearClipboardHistory'),
  downloadClipboardEntry: (id: string) => invoke('downloadClipboardEntry', id),
  /** The clipboard history changed (a link was noticed, removed or cleared): the new list. */
  onClipboardHistoryChanged: (callback: (entries: ClipboardHistoryEntry[]) => void): (() => void) =>
    subscribe('clipboardHistoryChanged', callback),
  labList: () => invoke('labList'),
  labGetState: () => invoke('labGetState'),
  labRun: (planId: string) => invoke('labRun', planId),
  labRunAll: () => invoke('labRunAll'),
  labVerify: (planId: string) => invoke('labVerify', planId),
  labStop: () => invoke('labStop'),

  /** Settings were changed from main (the Test lab): the switches must follow. */
  onSettingsChanged: (callback: (settings: SettingsPush) => void): (() => void) =>
    subscribe('settingsChanged', callback),

  /** The Test lab's state changed (a step, an assertion, a sample). */
  onLabEvent: (callback: (event: LabEvent) => void): (() => void) =>
    subscribe('labEvent', callback),

  /** The OS handed Lightning a link (a magnet link, a .torrent): takePendingLink() has it. */
  onAppCommand: (callback: (command: string, argument?: string) => void): (() => void) =>
    subscribe('appCommand', callback),

  /** A Telegram job changed (throttled in main); the whole job is sent. */
  onTdlJobUpdated: (callback: (job: TdlJob) => void): (() => void) =>
    subscribe('tdlJobUpdated', callback),

  onYoutubeJobUpdated: (callback: (job: YoutubeJob) => void): (() => void) =>
    subscribe('youtubeJobUpdated', callback),

  /** What a Telegram sign-in needs or has reached. */
  onTdlLoginEvent: (callback: (sessionId: string, event: TdlLoginEvent) => void): (() => void) =>
    subscribe('tdlLoginEvent', callback),

  /** The schedule opened or closed (or its cap changed). */
  onScheduleChanged: (callback: (status: ScheduleStatus) => void): (() => void) =>
    subscribe('scheduleChanged', callback),

  onLinkReceived: (callback: () => void): (() => void) => subscribe('linkReceived', callback),

  onDownloadUpdated: (callback: (update: DownloadUpdate) => void): (() => void) =>
    subscribe('downloadUpdated', callback),

  /** A download was added to the finished ones or forgotten: listHistory() has them. */
  onHistoryChanged: (callback: () => void): (() => void) => subscribe('historyChanged', callback),

  /** The saved DNS profiles or the app's default changed. */
  onDnsChanged: (callback: (config: DnsConfig) => void): (() => void) =>
    subscribe('dnsChanged', callback),

  /** A group was made, changed or removed: listGroups() has them. */
  onGroupsChanged: (callback: () => void): (() => void) => subscribe('groupsChanged', callback),

  onNetworksChanged: (callback: (networks: NetworkInterfaceInfo[]) => void): (() => void) =>
    subscribe('networksChanged', callback),

  /** How a magnet link's check is going, while it waits: noPeersYet once its first search came back empty. */
  onMagnetStatus: (
    callback: (status: { link: string; noPeersYet: boolean }) => void
  ): (() => void) => subscribe('magnetStatus', callback)
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
