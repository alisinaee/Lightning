import type { DuplicateMatch, DuplicateOptions } from './duplicates'
import type { DnsTestResult } from './dnsRecommend'
import type { LabPlanInfo, LabPlanRun, LabState } from './lab'
import type {
  AppSettings,
  CreateGroupInput,
  DnsConfig,
  DnsProfile,
  DownloadUpdate,
  FinishedDownload,
  GroupInfo,
  GroupPatch,
  IntegrationInfo,
  NetworkInterfaceInfo,
  PendingLink,
  ProbeResult,
  RequestExtras,
  StartDownloadRequest,
  TorrentFileEntry,
  UpdateInfo
} from './types'

/** The request/response half of the IPC surface (every IpcChannels entry except the
 * main->renderer push events, downloadUpdated, networksChanged, historyChanged, groupsChanged, labEvent, settingsChanged and linkReceived) — one source of truth for
 * both lightningApi (preload) and registerIpcHandlers (main), so a signature drift between the two
 * is a compile error instead of a runtime one. */
export interface IpcContract {
  listInterfaces: { args: []; result: NetworkInterfaceInfo[] }
  pingInterfaces: { args: []; result: Record<string, number | null> }
  deviceBindingSupported: { args: []; result: boolean }
  openNetworkSettings: { args: []; result: void }
  updateSettings: { args: [patch: AppSettings]; result: void }
  /** The saved DNS profiles and the app's default. */
  getDns: { args: []; result: DnsConfig }
  /** Looks the link's host up with every DNS (the system's, saved and well-known ones), measures
   * each server they lead to, and says which DNS suits it. The winner is remembered for Auto. */
  testDns: {
    args: [url: string, currentDnsId: string | null, extras?: RequestExtras]
    result: DnsTestResult
  }
  /** Adds or replaces a profile; servers are IP addresses, as a list or typed text. */
  saveDns: {
    args: [input: { id?: string; name: string; servers: string[] | string }]
    result: DnsProfile
  }
  removeDns: { args: [id: string]; result: void }
  /** The DNS the whole app uses; null is the system's. */
  setDefaultDns: { args: [id: string | null]; result: void }
  /** The DNS one download uses ('system' for the system's); null follows its group and the app. */
  setDownloadDns: { args: [id: string, dnsId: string | null]; result: void }
  /** `extras`: headers, Referer, Cookie or sign-in details the request needs. */
  /** The browser extension's pairing details; port is null while the integration is off. */
  getIntegration: { args: []; result: IntegrationInfo }
  /** A new pairing key: the extension paired with the old one has to be paired again. */
  regenerateIntegrationKey: { args: []; result: string }
  openExtensionFolder: { args: []; result: void }
  probeUrl: { args: [url: string, extras?: RequestExtras]; result: ProbeResult }
  chooseDestinationFolder: { args: [defaultPath: string]; result: string | null }
  chooseTorrentFile: { args: []; result: string | null }
  readClipboardText: { args: []; result: string }
  openLogs: { args: []; result: void }
  /** The newest `limit` lines of the app log, oldest first. */
  readLog: { args: [limit: number]; result: string[] }
  openLogFolder: { args: []; result: void }
  clearLog: { args: []; result: void }
  /** A text report for support: versions, networks, settings, counts, recent log and errors. */
  diagnosticReport: { args: []; result: string }
  /** Existing downloads, group files, finished entries and files on disk that these links repeat. */
  findDuplicates: {
    args: [urls: string[], destinationDir?: string, options?: DuplicateOptions]
    result: DuplicateMatch[]
  }
  /** Shows a download's file in its folder, by the download's own path. False when nothing is
   * there any more: history is re-sent, with it marked missing. */
  revealDownload: { args: [id: string]; result: boolean }
  /** Opens a finished download's file with the app the OS has for it. */
  openDownloadedFile: { args: [id: string]; result: void }
  startDownload: { args: [request: StartDownloadRequest]; result: string }
  /** Every download, oldest first, each as a snapshot. */
  listDownloads: { args: []; result: DownloadUpdate[] }
  /** Finished downloads, newest first. One is forgotten with removeDownload. */
  listHistory: { args: []; result: FinishedDownload[] }
  /** Forgets every finished download; their files stay. */
  clearHistory: { args: []; result: void }
  updateHistory: { args: [id: string, fileName: string]; result: void }
  /** Bytes each network has received in its selected calendar period, by id (see NetworkPreference.dataLimit). */
  networkUsage: { args: []; result: Record<string, number> }
  resetNetworkUsage: { args: [id: string]; result: void }
  /** Bytes free on the drive holding `dir`; null when it can't be told. */
  freeSpace: { args: [dir: string]; result: number | null }
  /** A torrent download's files, in the torrent's order; empty for any other download. */
  torrentFiles: { args: [id: string]; result: TorrentFileEntry[] }
  /** Which of a torrent download's files to fetch, by index, as it runs or not. Refused for one
   * already downloaded, or with no room on disk for what's added. */
  chooseTorrentFiles: { args: [id: string, selected: number[]]; result: void }
  pauseDownload: { args: [id: string]; result: void }
  resumeDownload: { args: [id: string]; result: void }
  /** A fresh link to the same file, for a download whose link stopped working; it resumes. */
  relinkDownload: { args: [id: string, url: string]; result: void }
  setDownloadNetwork: { args: [id: string, networkId: string, enabled: boolean]; result: void }
  cancelDownload: { args: [id: string]; result: void }
  /** Removes a download, cancelling one under way. A finished one's file stays, unless
   * `trashFile`: then it goes to the Trash. */
  removeDownload: {
    args: [id: string, options?: { trashFile?: boolean; keepEntry?: boolean }]
    result: void
  }
  /** Every group, with the files of an auto group still waiting to start. */
  listGroups: { args: []; result: GroupInfo[] }
  /** Makes a group of the requests and starts it; `failed` says which files couldn't start. */
  createGroup: { args: [input: CreateGroupInput]; result: { group: GroupInfo; failed: string[] } }
  updateGroup: { args: [id: string, patch: GroupPatch]; result: void }
  /** Removes the group and its downloads, cancelling those under way. Finished files stay,
   * unless `trashFiles`: then they go to the Trash. Unfinished files are cancelled and their
   * partial data deleted only with `deletePartial`; otherwise they stay in the list, paused and
   * out of the group. `removeFolder` also removes the group's folder when it ends up empty. */
  removeGroup: {
    args: [
      id: string,
      options?: { trashFiles?: boolean; deletePartial?: boolean; removeFolder?: boolean }
    ]
    result: void
  }
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
  /** Tries a group's failed files again: those that can continue do, the rest start over from a
   * fresh look at their link. `only` names the files (downloads or waiting ones); left out, all. */
  retryGroup: { args: [id: string, only?: string[]]; result: { failed: string[] } }
  checkForUpdate: { args: []; result: UpdateInfo | null }
  /** The user pressed Check for updates: asks GitHub now (not the startup answer) and says
   * whether that worked. A found update is never marked dismissed. */
  checkForUpdateNow: { args: []; result: { ok: boolean; update: UpdateInfo | null } }
  /** A link the OS handed over (main/openLinks.ts), once; null when there's none. */
  takePendingLink: { args: []; result: PendingLink | null }
  /** The Test lab (main/debug/lab.ts): its plans, and what a run (or the last run) has done. */
  labList: { args: []; result: LabPlanInfo[] }
  labGetState: { args: []; result: LabState }
  /** Runs one plan to its end and gives how it went; the window follows it through labEvent. */
  labRun: { args: [planId: string]; result: LabPlanRun }
  labRunAll: { args: []; result: LabState }
  /** The second half of a plan that needed Lightning restarted. */
  labVerify: { args: [planId: string]; result: LabPlanRun }
  /** Stops the running plan (it cleans up first) and brings the real networks back. */
  labStop: { args: []; result: void }
}
