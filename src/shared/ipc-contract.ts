import type {
  AppSettings,
  DownloadUpdate,
  NetworkInterfaceInfo,
  ProbeResult,
  StartDownloadRequest,
  TorrentFileEntry,
  UpdateInfo
} from './types'

/** The request/response half of the IPC surface (every IpcChannels entry except the
 * main->renderer push events, downloadUpdated, networksChanged and linkReceived) — one source of truth for
 * both plexoApi (preload) and registerIpcHandlers (main), so a signature drift between the two
 * is a compile error instead of a runtime one. */
export interface IpcContract {
  listInterfaces: { args: []; result: NetworkInterfaceInfo[] }
  pingInterfaces: { args: []; result: Record<string, number | null> }
  deviceBindingSupported: { args: []; result: boolean }
  openNetworkSettings: { args: []; result: void }
  updateSettings: { args: [patch: AppSettings]; result: void }
  probeUrl: { args: [url: string]; result: ProbeResult }
  chooseDestinationFolder: { args: [defaultPath: string]; result: string | null }
  chooseTorrentFile: { args: []; result: string | null }
  readClipboardText: { args: []; result: string }
  revealInFolder: { args: [filePath: string]; result: void }
  startDownload: { args: [request: StartDownloadRequest]; result: string }
  getCurrentDownload: { args: []; result: DownloadUpdate | null }
  /** A torrent download's files, in the torrent's order; empty for any other download. */
  torrentFiles: { args: [id: string]; result: TorrentFileEntry[] }
  pauseDownload: { args: [id: string]; result: void }
  resumeDownload: { args: [id: string]; result: void }
  setDownloadNetwork: { args: [id: string, networkId: string, enabled: boolean]; result: void }
  cancelDownload: { args: [id: string]; result: void }
  removeDownload: { args: [id: string]; result: void }
  checkForUpdate: { args: []; result: UpdateInfo | null }
  /** A link the OS handed over (main/openLinks.ts), once; null when there's none. */
  takePendingLink: { args: []; result: string | null }
}
