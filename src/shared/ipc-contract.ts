import type { LabPlanInfo, LabPlanRun, LabState } from './lab'
import type {
  AppSettings,
  CreateGroupInput,
  DownloadUpdate,
  FinishedDownload,
  GroupInfo,
  GroupPatch,
  NetworkInterfaceInfo,
  ProbeResult,
  StartDownloadRequest,
  TorrentFileEntry,
  UpdateInfo
} from './types'

/** The request/response half of the IPC surface (every IpcChannels entry except the
 * main->renderer push events, downloadUpdated, networksChanged, historyChanged, groupsChanged, labEvent, settingsChanged and linkReceived) — one source of truth for
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
  /** Opens a finished download's file with the app the OS has for it. */
  openDownloadedFile: { args: [id: string]; result: void }
  startDownload: { args: [request: StartDownloadRequest]; result: string }
  /** Every download, oldest first, each as a snapshot. */
  listDownloads: { args: []; result: DownloadUpdate[] }
  /** Finished downloads, newest first. One is forgotten with removeDownload. */
  listHistory: { args: []; result: FinishedDownload[] }
  /** Forgets every finished download; their files stay. */
  clearHistory: { args: []; result: void }
  /** Bytes each network has received in its selected calendar period, by id (see NetworkPreference.dataLimit). */
  networkUsage: { args: []; result: Record<string, number> }
  resetNetworkUsage: { args: [id: string]; result: void }
  /** Bytes free on the drive holding `dir`; null when it can't be told. */
  freeSpace: { args: [dir: string]; result: number | null }
  /** A torrent download's files, in the torrent's order; empty for any other download. */
  torrentFiles: { args: [id: string]; result: TorrentFileEntry[] }
  pauseDownload: { args: [id: string]; result: void }
  resumeDownload: { args: [id: string]; result: void }
  /** A fresh link to the same file, for a download whose link stopped working; it resumes. */
  relinkDownload: { args: [id: string, url: string]; result: void }
  setDownloadNetwork: { args: [id: string, networkId: string, enabled: boolean]; result: void }
  cancelDownload: { args: [id: string]; result: void }
  /** Removes a download, cancelling one under way. A finished one's file stays, unless
   * `trashFile`: then it goes to the Trash. */
  removeDownload: { args: [id: string, options?: { trashFile?: boolean }]; result: void }
  /** Every group, with the files of an auto group still waiting to start. */
  listGroups: { args: []; result: GroupInfo[] }
  /** Makes a group of the requests and starts it; `failed` says which files couldn't start. */
  createGroup: { args: [input: CreateGroupInput]; result: { group: GroupInfo; failed: string[] } }
  updateGroup: { args: [id: string, patch: GroupPatch]; result: void }
  /** Removes the group and its downloads, cancelling those under way. Finished files stay,
   * unless `trashFiles`: then they go to the Trash. */
  removeGroup: { args: [id: string, options?: { trashFiles?: boolean }]; result: void }
  /** Adds files to a group: started at once in a manual group, queued for a network in an auto one. */
  addGroupItems: {
    args: [id: string, requests: StartDownloadRequest[]]
    result: { failed: string[] }
  }
  /** Drops a file of an auto group that hasn't started. */
  removeGroupItem: { args: [id: string, itemId: string]; result: void }
  /** The user chose the networks of one file of an auto group (`pin`) or gave it back to Auto
   * (`null`). For a file still waiting its networks are `networks`; a running one was already
   * switched with setDownloadNetwork. */
  setGroupFileChoice: {
    args: [id: string, fileId: string, networks: string[] | null]
    result: void
  }
  checkForUpdate: { args: []; result: UpdateInfo | null }
  /** A link the OS handed over (main/openLinks.ts), once; null when there's none. */
  takePendingLink: { args: []; result: string | null }
  /** The Test lab (main/debug/lab.ts): its plans, and what a run (or the last run) has done. */
  labList: { args: []; result: LabPlanInfo[] }
  labGetState: { args: []; result: LabState }
  /** Runs one plan to its end and gives how it went; the window follows it through labEvent. */
  labRun: { args: [planId: string]; result: LabPlanRun }
  labRunAll: { args: []; result: LabState }
  /** The second half of a plan that needed Plexo restarted. */
  labVerify: { args: [planId: string]; result: LabPlanRun }
  /** Stops the running plan (it cleans up first) and brings the real networks back. */
  labStop: { args: []; result: void }
}
