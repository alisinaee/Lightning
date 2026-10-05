export type NetworkInterfaceKind = 'wifi' | 'usb' | 'ethernet' | 'bridge' | 'vpn' | 'other'
export type IpFamily = 4 | 6

export interface NetworkAddress {
  address: string
  family: IpFamily
  netmask?: string
  /** Used by the existing IPv4 same-subnet warning. */
  subnet?: string
}

export type ThemeSource = 'light' | 'dark'

export interface NetworkInterfaceInfo {
  /** Stable identifier for this interface (currently the OS device name, e.g. "en0"). */
  id: string
  device: string
  displayName: string
  addresses: NetworkAddress[]
  kind: NetworkInterfaceKind
  mac?: string
}

interface ProbeResultBase {
  requestedUrl: string
  /** URL after following redirects — this is what the download should actually fetch. */
  finalUrl: string
  supportsRanges: boolean
  /** null when the server did not report a size. */
  totalBytes: number | null
  suggestedFileName: string
  contentType: string | null
  /** Strong validators, used to detect if the remote content changes between pause and resume. */
  etag: string | null
  lastModified: string | null
}

export interface HttpProbeResult extends ProbeResultBase {
  kind: 'http'
}

export interface TorrentProbeResult extends ProbeResultBase {
  kind: 'torrent'
  torrent: TorrentInfo
}

export type ProbeResult = HttpProbeResult | TorrentProbeResult

export interface TorrentInfo {
  infoHash: string
  pieceLength: number
  /** Where each file will be written, relative to the destination folder, already checked to be
   * safe (see main/download/torrent/paths.ts). */
  files: { path: string; length: number }[]
}

/** One of a torrent download's files, for listing them while it runs. */
export interface TorrentFileEntry {
  /** As TorrentInfo's: relative to the destination folder, the torrent's own folder first. */
  path: string
  length: number
  /** Chosen to be downloaded. */
  chosen: boolean
}

/** `queued`: waiting for one of the downloads running at once to end (see
 * AppSettings.downloadsAtOnce). */
export type DownloadStatus =
  'queued' | 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'

/** An HTTP stream's state. `pending` means it is waiting for work: it holds no block, either because
 * none is free for it right now or because it hasn't started. `downloading` always means it is
 * fetching one (`currentBlockIndex` says which). A stream that fails for good leaves the list;
 * what went wrong is its network's to report (see DownloadNetwork). */
export type HttpStreamStatus =
  'pending' | 'downloading' | 'retrying' | 'paused' | 'completed' | 'cancelled'

/** One connection to the server, through one network. Streams come and go as the download
 * runs; what a network has done is kept on its DownloadNetwork. */
export interface HttpStreamState {
  id: number
  /** The network it runs on: a DownloadNetwork's id. */
  interfaceId: string
  rangeStart: number
  /** null means an open-ended range (download to end of file). */
  rangeEnd: number | null
  /** New bytes it has delivered. */
  bytesDownloaded: number
  speedBytesPerSec: number
  status: HttpStreamStatus
  /** The block this stream is fetching. Unset whenever it holds none (idle, retrying, paused, done). */
  currentBlockIndex?: number
  /** True while this stream is racing another stream for `currentBlockIndex`, because that one
   * was too slow — see main/download/scheduler.ts. Whichever finishes first wins. */
  hedge?: boolean
}

/** A live BitTorrent peer connection. A peer does not own a piece: it may contribute blocks to
 * several pieces, and several peers may contribute to one piece. */
export interface TorrentPeerState {
  /** Unique in the download, in the order its peers connected: "Peer #(id + 1)". */
  id: number
  interfaceId: string
  status: 'connected' | 'receiving'
  /** The client it runs, as its peer id names it ("qBittorrent 4.6.2"); null when unknown. */
  client: string | null
  bytesDownloaded: number
  speedBytesPerSec: number
  bytesUploaded: number
  uploadSpeedBytesPerSec: number
}

export type HttpBlockStatus = 'pending' | 'downloading' | 'completed'
/** `skipped`: a piece that none of the files chosen for this torrent needs. */
export type TorrentPieceStatus = HttpBlockStatus | 'skipped'

interface WorkUnitState {
  index: number
  rangeStart: number
  rangeEnd: number | null
  /** The network currently leasing this block (or the last one to touch it). Only meaningful
   * as "who is working on it now" — for who actually *delivered* the bytes, read
   * `bytesByInterface`, since a block can be started on one network and finished on another
   * after a retry or a pause/resume. */
  interfaceId?: string
  bytesDownloaded: number
  /** Bytes of this block delivered by each network, keyed by interface id. Summing to
   * `bytesDownloaded`, this is what the block grid colors by, so a block split across
   * networks is attributed to all of them instead of only the one that happened to finish it. */
  bytesByInterface: Record<string, number>
}

export interface HttpBlockState extends WorkUnitState {
  kind: 'http'
  status: HttpBlockStatus
}

export interface TorrentPieceState extends WorkUnitState {
  kind: 'torrent'
  status: TorrentPieceStatus
  /** Bytes received in this run but not yet hash-verified. This is live activity, not durable
   * progress, and may fall back to zero after a failed verification. */
  provisionalBytes: number
}

export type DownloadUnitState = HttpBlockState | TorrentPieceState

/**
 * - on: in use.
 * - off: the user switched it off. A network that turns up mid-download starts off.
 * A VPN network is off unless its preference says `off: false`.
 * - offline: not connected to this computer. It's used again as soon as it is.
 * - unreachable: connected, but the server can't be reached through it. One connection keeps
 *   trying, and the rest follow once it gets through.
 * - failed: the server kept refusing requests over it (`error` says how). Switching it off and
 *   on, reconnecting it, or resuming tries again.
 * - limit: it has used up its data for the chosen period (NetworkPreference.dataLimit). It's used again
 *   once the period ends or the limit is raised.
 */
export type NetworkStatus = 'on' | 'off' | 'offline' | 'unreachable' | 'failed' | 'limit'

/** A network as one download sees it: whether the user has it on, and how it is doing. */
interface DownloadNetworkBase {
  /** A NetworkInterfaceInfo id. */
  id: string
  /** Its name and kind as the OS last reported them. */
  label: string
  kind: NetworkInterfaceKind
  /** The user's choice; `status` is what came of it. */
  enabled: boolean
  status: NetworkStatus
  error?: string
  /** Bytes of the file it delivered. */
  bytesDownloaded: number
  speedBytesPerSec: number
  /** Requests over it that failed and were tried again. */
  retries: number
}

export interface HttpDownloadNetwork extends DownloadNetworkBase {
  transfer: 'http'
}

export interface TorrentDownloadNetwork extends DownloadNetworkBase {
  transfer: 'torrent'
  bytesUploaded: number
  uploadSpeedBytesPerSec: number
}

export type DownloadNetwork = HttpDownloadNetwork | TorrentDownloadNetwork

interface DownloadStateBase {
  id: string
  url: string
  fileName: string
  destinationPath: string
  /** 0 means the size could not be determined ahead of time. */
  totalBytes: number
  bytesDownloaded: number
  speedBytesPerSec: number
  /** Seconds left at this speed, smoothed (see updateTimeLeft); unset when there's no telling:
   * the size unknown, or nothing moving. */
  timeLeftSeconds?: number
  status: DownloadStatus
  error?: string
  /** For an error: whether resuming can pick up where it stopped. False when the progress was
   * thrown away, e.g. the file changed on the server. */
  resumable?: boolean
  /** An error Lightning will try again by itself: when (ms since epoch) and which try it is. */
  retryAt?: number
  retryAttempt?: number
  startedAt: number
  /** While queued: its place in the queue, lowest first. */
  queuedAt?: number
  pausedAt?: number
  totalPausedMs?: number
  completedAt?: number
  /** Each network's speed, by network id, sampled once a second over the last minute it ran.
   * Every series is as long as the others, so they line up in time. */
  speedHistory?: Record<string, number[]>
  /** The best combined speed held for a few seconds, so it only ever rises; unset until it has
   * run that long. A download done sooner gets the best speed it showed. */
  peakSpeedBytesPerSec?: number
  /** The group (an "Add several links" batch) it belongs to, if any; see DownloadGroup. */
  groupId?: string
  /** The DNS it resolves names with (a DnsProfile id, or 'system'); unset follows its group, then
   * the app's default. */
  dnsId?: string
  /** The update this state is as of (see DownloadUpdate). */
  seq?: number
}

export interface HttpDownloadState extends DownloadStateBase {
  kind: 'http'
  networks: HttpDownloadNetwork[]
  streams: HttpStreamState[]
  peakStreams: number
  blocks: HttpBlockState[]
  totalBlocks: number
  blockSizeBytes: number
}

export interface TorrentDownloadState extends DownloadStateBase {
  kind: 'torrent'
  networks: TorrentDownloadNetwork[]
  peers: TorrentPeerState[]
  peakPeers: number
  pieces: TorrentPieceState[]
  totalPieces: number
  pieceLength: number
  /** How many files it has, how many are chosen, and which (by index; unset: every one). */
  files: { chosen: number; total: number; selected?: number[] }
  /** Its files come in the torrent's folder (`fileName`), rather than as one file. */
  folder: boolean
  /** Of `totalBytes`, the bytes of pieces that no chosen file needs. */
  skippedBytes: number
  bytesUploaded: number
  uploadSpeedBytesPerSec: number
}

export type DownloadState = HttpDownloadState | TorrentDownloadState

/** A finished download as history keeps it: its state without the work units and connections,
 * which only a running download needs. */
export type FinishedDownload = (
  Omit<HttpDownloadState, 'blocks' | 'streams'> | Omit<TorrentDownloadState, 'pieces' | 'peers'>
) & {
  /** The blocks or pieces it was written in (a torrent's: those its chosen files needed). */
  unitsWritten: number
  /** Set when listed: its file or folder is no longer where it was saved. */
  missing?: boolean
  /** Chosen torrent files relative to its destination folder, retained for safe file removal. */
  downloadedFiles?: string[]
}

/** What the main process sends as a download changes: everything but its blocks, and only the
 * blocks that changed since it last sent. A download can have tens of thousands of blocks, and
 * copying every one several times a second would cost the process that carries every byte. A
 * snapshot is the same with every block in it. */
export interface HttpDownloadUpdate {
  seq: number
  state: Omit<HttpDownloadState, 'blocks'>
  blocks: HttpBlockState[]
}

export interface TorrentDownloadUpdate {
  seq: number
  state: Omit<TorrentDownloadState, 'pieces'>
  pieces: TorrentPieceState[]
}

export type DownloadUpdate = HttpDownloadUpdate | TorrentDownloadUpdate

/** User customization for one physical network, keyed by NetworkInterfaceInfo.id — lets a
 * cryptic OS device name (e.g. "feth0") get a real label, and a color distinct from its
 * kind's default. Persisted in the main process, independent of any single download. */
export type DataLimitPeriod = 'day' | 'week' | 'month'

export interface NetworkPreference {
  customName?: string
  /** One of the app's curated swatch ids (see NETWORK_COLOR_SWATCHES) — not a raw hex, so every
   * swatch is guaranteed to have a legible on-solid text color already picked out for it. */
  colorId?: string
  /** Left out of new downloads by default (see the title bar's networks). A download can still
   * be started on it. */
  off?: boolean
  /** Bytes a second all downloads together may take over it. */
  speedLimit?: number
  /** Bytes Lightning may receive in the chosen calendar period. */
  dataLimit?: number
  /** Defaults to month for existing settings. Weeks start Monday in local time. */
  dataLimitPeriod?: DataLimitPeriod
}

export type NetworkPreferences = Record<string, NetworkPreference>

export interface UpdateInfo {
  version: string
  /** Where clicking the notification should take the user — the landing page's downloads. */
  url: string
  /** True once the user has dismissed the banner for this exact version (persisted, so it stays
   * dismissed across relaunches) — the app then falls back to a quiet titlebar icon instead. */
  dismissed: boolean
}

/** Choices from Settings. Absent fields mean the defaults in DEFAULT_PREFS. */
export type AccentId = 'amber' | 'blue' | 'teal' | 'green' | 'violet' | 'rose'

export interface AppPrefs {
  uiScale?: number
  accent?: AccentId
  notifyAdded?: boolean
  notifyCompleted?: boolean
  notifyFailed?: boolean
  notifyWhenInactive?: boolean
  preventSleep?: boolean
  closeToBackground?: boolean
  hideDock?: boolean
  /** The Logs and Debug (Test lab) buttons in the title bar; both off until switched on. */
  showLogs?: boolean
  showDebug?: boolean
  /** system: the OS proxy. direct: none. manual: the addresses below. */
  proxyMode?: 'system' | 'direct' | 'manual'
  proxyHttp?: string
  proxyHttps?: string
  proxyFtp?: string
  proxySocks?: string
}

export const DEFAULT_PREFS: Required<AppPrefs> = {
  uiScale: 1,
  accent: 'amber',
  notifyAdded: true,
  notifyCompleted: true,
  notifyFailed: false,
  notifyWhenInactive: true,
  preventSleep: true,
  closeToBackground: true,
  hideDock: false,
  showLogs: false,
  showDebug: false,
  proxyMode: 'system',
  proxyHttp: '',
  proxyHttps: '',
  proxyFtp: '',
  proxySocks: ''
}

/** What app-settings.json holds, and what the renderer sends to change it (merged over the saved
 * values, `undefined` clearing one). A missing field was never set. */
export interface AppSettings {
  themeSource?: ThemeSource
  dismissedUpdateVersion?: string
  prefs?: AppPrefs
  /** The last destination folder picked. */
  destinationDir?: string
  /** User customizations (name/color) per network interface id. */
  networkPreferences?: NetworkPreferences
  /** How many downloads run at once; the rest wait in the queue. */
  downloadsAtOnce?: number
  /** Bytes a second every download together may take, over every network; unset: no limit. */
  speedLimit?: number
  /** While on, slowModeSpeed stands in for speedLimit: a one-click lower limit for calls. */
  slowMode?: boolean
  slowModeSpeed?: number
  /** Whether downloads may use VPN tunnels as connections. Off: they use the real networks. */
  useVpn?: boolean
}

export const DOWNLOADS_AT_ONCE = { default: 2, min: 1, max: 8 }
export const DEFAULT_SLOW_MODE_SPEED = 2 * 1024 ** 2

/** Everything the renderer needs for its first paint, read synchronously by the preload so no
 * saved value flashes in over a default a moment after launch. */
export interface InitialState {
  /** "Lightning", or "Lightning" for that build. */
  appName?: string
  homeDir: string
  downloadsDir: string
  themeSource: ThemeSource
  networkPreferences: NetworkPreferences
  downloadsAtOnce: number
  speedLimit?: number
  slowMode: boolean
  slowModeSpeed: number
  useVpn: boolean
  /** The last folder picked, if it still exists — otherwise the renderer uses downloadsDir. */
  destinationDir?: string
  version: string
  prefs: Required<AppPrefs>
  /** The Test lab (the title bar's Debug button) is there: not in a packaged build. */
  labEnabled: boolean
}

interface StartDownloadRequestBase {
  url: string
  destinationDir: string
  suggestedFileName: string
  /** 0 means unknown. */
  totalBytes: number
  supportsRanges: boolean
  /** The networks to start on. Every other one starts switched off. */
  interfaceIds: string[]
  etag: string | null
  lastModified: string | null
  /** The group it belongs to, if any. */
  groupId?: string
  /** The DNS to resolve with; see DownloadState.dnsId. */
  dnsId?: string
  /** Added to the list and left paused, for the user to start later. */
  startPaused?: boolean
  /** Set for a download an auto group runs on one network of its own: it doesn't count towards
   * downloadsAtOnce, which would otherwise keep two networks from each running a file. */
  groupLane?: boolean
}

export interface StartHttpDownloadRequest extends StartDownloadRequestBase {
  kind: 'http'
  /** Streams per network the user picked; left out, the count is decided automatically. */
  streamsPerNetwork?: number
}

export interface StartTorrentDownloadRequest extends StartDownloadRequestBase {
  kind: 'torrent'
  /** The download starts from the .torrent retained when this info hash was probed. */
  infoHash: string
  /** For a torrent: the files to download, as indexes into its probe's `files`. Left out: all. */
  selectedFiles?: number[]
}

export type StartDownloadRequest = StartHttpDownloadRequest | StartTorrentDownloadRequest

/** `auto`: Lightning gives each file a network of its own to finish the group soonest. `manual`: each
 * file uses the networks the user picked for it. */
export type GroupMode = 'auto' | 'manual'

/** In a manual group: `general`, every file uses the group's networks; `perFile`, only what is
 * set on each file counts (a file nobody set uses the group's networks to begin with). */
export type GroupRule = 'general' | 'perFile'

/** A batch of links added together, kept in one folder. */
export interface DownloadGroup {
  id: string
  name: string
  destinationDir: string
  mode: GroupMode
  createdAt: number
  /** The networks the group uses: all of them in a general rule, or the ones an auto group may
   * use. */
  interfaceIds: string[]
  /** How many of its files run at once; unset, the group follows the general limit (manual) or
   * runs one file on each network (auto). */
  maxAtOnce?: number
  /** Manual groups only; unset means `perFile`, as groups were before there was a choice. */
  rule?: GroupRule
  /** The DNS its files use (a DnsProfile id, or 'system'); unset follows the app's default. */
  dnsId?: string
  /** Lightning made the folder for this group: it may take it away again once it is empty. */
  ownsFolder?: boolean
}

/** A file of an auto group that hasn't started yet: it starts when a network is free for it. */
export interface PendingGroupItem {
  id: string
  request: StartDownloadRequest
  /** Why it couldn't start; it then stays here for the user to remove. */
  error?: string
}

/** One thing the auto planner did or noticed, in plain words. */
export interface PlanEvent {
  at: number
  kind: 'measure' | 'plan' | 'slow' | 'recover' | 'faster' | 'lost' | 'help' | 'release' | 'drop'
  text: string
}

export type PlanNetworkState = 'fast' | 'slow' | 'idle' | 'lost'

export interface PlanNetwork {
  id: string
  name?: string
  /** What it delivers now (sustained), bytes a second. */
  speedBps: number
  /** The best sustained speed it has shown. */
  baselineBps: number
  state: PlanNetworkState
}

/** How a group is being downloaded and why, for the "How Lightning is downloading this group" panel. */
export interface GroupPlan {
  mode: GroupMode
  measuring: boolean
  networks: PlanNetwork[]
  summary: string
  /** Newest last, at most 50. */
  log: PlanEvent[]
}

export interface GroupInfo extends DownloadGroup {
  pending: PendingGroupItem[]
  plan: GroupPlan
  /** For each file still waiting (by item id), the network the plan has for it; auto only. */
  plannedNetworks: Record<string, string>
  /** Files (downloads or waiting items, by id) whose networks the user chose; Auto leaves them. */
  pinned: string[]
}

export interface CreateGroupInput {
  /** Empty: a name is made up from the file count and the date. */
  name: string
  destinationDir: string
  mode: GroupMode
  interfaceIds: string[]
  maxAtOnce?: number
  rule?: GroupRule
  dnsId?: string
  requests: StartDownloadRequest[]
  ownsFolder?: boolean
}

export interface GroupPatch {
  name?: string
  mode?: GroupMode
  interfaceIds?: string[]
  /** `null` goes back to no limit of its own. */
  maxAtOnce?: number | null
  rule?: GroupRule
  /** `null` goes back to following the app's default. */
  dnsId?: string | null
}

/** The settings the window shows, as main pushes them when something other than the window
 * changed them (the Test lab). */
export type SettingsPush = Pick<
  InitialState,
  'downloadsAtOnce' | 'speedLimit' | 'slowMode' | 'slowModeSpeed' | 'useVpn'
>

/** A DNS setup the user named: the servers names are looked up with instead of the system's. */
export interface DnsProfile {
  id: string
  name: string
  /** One to four IP addresses (IPv4 or IPv6). */
  servers: string[]
  /** When it was last picked; the most recent come first in lists. */
  usedAt?: number
}

/** The saved DNS profiles, and which one the app uses unless a group or download says otherwise. */
export interface DnsConfig {
  profiles: DnsProfile[]
  /** A profile id; unset is the system's DNS. */
  defaultId?: string
}
