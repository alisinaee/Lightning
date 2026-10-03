import { randomUUID } from 'node:crypto'
import { readFile, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { basename, join, sep } from 'node:path'
import type { BrowserWindow } from 'electron'
import { app, Notification, powerSaveBlocker } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import type {
  DownloadNetwork,
  DownloadState,
  DownloadStatus,
  DownloadUnitState,
  DownloadUpdate,
  HttpBlockState,
  HttpDownloadNetwork,
  HttpDownloadState,
  NetworkInterfaceInfo,
  NetworkStatus,
  StartDownloadRequest,
  StartHttpDownloadRequest,
  StartTorrentDownloadRequest,
  TorrentDownloadNetwork,
  TorrentDownloadState,
  TorrentInfo
} from '../../shared/types'
import { testKnobs } from '../testKnobs'
import { DownloadFile } from './downloadFile'
import { HttpTransfer, splittable } from './httpTransfer'
import { ensureDirectory, reserveDestinationPath } from './paths'
import { planBlocks, planDownload, planPieces } from './plan'
import { restoreBlocks, restorePieces, saveBlocks, type SavedBlocks } from './savedProgress'
import { chosenFiles, wantedPieces } from './torrent/files'
import { describeTorrent, probedTorrentFile } from './torrent/metadata'
import { StagingFolder } from './torrent/stagingFolder'
import { TorrentTransfer } from './torrent/torrentTransfer'
import {
  clearSpeeds,
  delay,
  recomputeAggregates,
  updateSpeeds,
  type Transfer,
  type TransferHost,
  type HttpTransferTarget,
  type SpeedSample,
  type TorrentTransferTarget
} from './transfer'
import type { NetworkMonitor } from '../network/interfaces'
import {
  compatibleInterfaces,
  NoCompatibleRouteError,
  resolveTargetWithin,
  targetHost
} from '../network/routes'

interface RuntimeFields {
  publicationPath?: string
  publicationIdentity?: { dev: number; ino: number }
  runPromise?: Promise<void>
  publishing: boolean
  pushScheduled: boolean
  persistenceTimer?: NodeJS.Timeout
  persistenceChain: Promise<void>
  removed: boolean
  /** Updates sent to the window so far (see DownloadUpdate). */
  sentUpdates: number
  /** Each block as the window was last sent it, by index — what tells a changed block apart. */
  sentUnits: (Pick<DownloadUnitState, 'status' | 'interfaceId' | 'bytesDownloaded'> & {
    provisionalBytes?: number
  })[]
  /** The network most recently switched off: what a resume switches back on if it finds none on.
   * Not persisted: after a restart, the first network present is used instead. */
  lastSwitchedOff?: string
  /** Paused by switching off its last network, rather than by Pause: switching one back on
   * resumes it. */
  pausedForNoNetwork?: boolean
}

interface HttpDownloadRuntime extends RuntimeFields, HttpTransferTarget {
  kind: 'http'
  transfer: Transfer
}

interface TorrentDownloadRuntime extends RuntimeFields, TorrentTransferTarget {
  kind: 'torrent'
  transfer: Transfer
}

type DownloadRuntime = HttpDownloadRuntime | TorrentDownloadRuntime

interface PersistedDownloadBase {
  savedAt: number
  partialPath: string
  publicationPath?: string
  publicationIdentity?: { dev: number; ino: number }
  requestPayload: StartDownloadRequest
  /** The networks, as saved before a download listed them in its state. Read only to fill in
   * `networks` for a download saved that way. */
  activeInterfaces?: NetworkInterfaceInfo[]
}

type PersistedState =
  Omit<HttpDownloadState, 'blocks' | 'streams'> | Omit<TorrentDownloadState, 'pieces' | 'peers'>

type PersistedDownload = PersistedDownloadBase & {
  version: 6
  state: PersistedState
} & SavedBlocks

/** Versions 4 and 5 used the HTTP-shaped `chunks`/`blocks` model for torrents too. Keep that
 * untyped data at the migration boundary; restored runtime state is always the v6 union. */
interface LegacyBlockState extends Omit<HttpBlockState, 'kind' | 'status'> {
  status: 'pending' | 'downloading' | 'completed' | 'skipped'
}

type LegacyDownloadState = Omit<
  HttpDownloadState,
  'kind' | 'networks' | 'streams' | 'blocks' | 'peakStreams' | 'totalBlocks' | 'blockSizeBytes'
> & {
  kind?: 'torrent'
  networks?: (Omit<HttpDownloadNetwork, 'transfer'> & {
    bytesUploaded?: number
    uploadSpeedBytesPerSec?: number
  })[]
  chunks?: HttpDownloadState['streams']
  blocks?: LegacyBlockState[]
  peakStreams?: number
  totalBlocks?: number
  blockSizeBytes?: number
  files?: { chosen: number; total: number }
  skippedBytes?: number
  bytesUploaded?: number
  uploadSpeedBytesPerSec?: number
}

type LegacyStartRequest = Omit<StartHttpDownloadRequest, 'kind'> & {
  infoHash?: string
  selectedFiles?: number[]
}

type LegacyPersistedDownload = Omit<PersistedDownloadBase, 'requestPayload'> & {
  version: 4 | 5
  state: LegacyDownloadState
  requestPayload: LegacyStartRequest
  progress?: SavedBlocks['progress']
  complete?: boolean
}

const UI_UPDATE_MS = 200
/** How often a running download takes stock (see run). */
const TICK_MS = 500
// Syncing a growing file can briefly monopolize a slow destination drive. Keep recovery
// checkpoints independent of UI updates; pause and publication still force an immediate sync.
const CHECKPOINT_INTERVAL_MS = 15_000

function newHttpNetwork(iface: NetworkInterfaceInfo, enabled: boolean): HttpDownloadNetwork {
  return {
    transfer: 'http',
    id: iface.id,
    label: iface.displayName,
    kind: iface.kind,
    enabled,
    status: enabled ? 'on' : 'off',
    bytesDownloaded: 0,
    speedBytesPerSec: 0,
    retries: 0
  }
}

function newTorrentNetwork(iface: NetworkInterfaceInfo, enabled: boolean): TorrentDownloadNetwork {
  return {
    ...newHttpNetwork(iface, enabled),
    transfer: 'torrent',
    bytesUploaded: 0,
    uploadSpeedBytesPerSec: 0
  }
}

/** A block that needs nothing more: in, or skipped (see BlockStatus). */
const isDone = (unit: DownloadUnitState): boolean =>
  unit.status === 'completed' || unit.status === 'skipped'

const unitsOf = (runtime: DownloadRuntime): DownloadUnitState[] =>
  runtime.kind === 'http' ? runtime.blocks : runtime.pieces

function commonState(
  state: Pick<
    HttpDownloadState,
    | 'id'
    | 'url'
    | 'fileName'
    | 'destinationPath'
    | 'totalBytes'
    | 'bytesDownloaded'
    | 'speedBytesPerSec'
    | 'status'
    | 'error'
    | 'resumable'
    | 'startedAt'
    | 'pausedAt'
    | 'totalPausedMs'
    | 'completedAt'
    | 'seq'
  >
): Omit<
  HttpDownloadState,
  'kind' | 'networks' | 'streams' | 'peakStreams' | 'blocks' | 'totalBlocks' | 'blockSizeBytes'
> {
  return {
    id: state.id,
    url: state.url,
    fileName: state.fileName,
    destinationPath: state.destinationPath,
    totalBytes: state.totalBytes,
    bytesDownloaded: state.bytesDownloaded,
    speedBytesPerSec: state.speedBytesPerSec,
    status: state.status,
    error: state.error,
    resumable: state.resumable,
    startedAt: state.startedAt,
    pausedAt: state.pausedAt,
    totalPausedMs: state.totalPausedMs,
    completedAt: state.completedAt,
    seq: state.seq
  }
}

/** Marks the pieces of `torrent` that none of the `chosen` files needs (null: all are) as
 * skipped. Their bytes, all together. */
function skipUnchosen(
  blocks: import('../../shared/types').TorrentPieceState[],
  torrent: TorrentInfo,
  chosen: Set<number> | null
): number {
  if (!chosen) return 0
  const wanted = wantedPieces(torrent.files, torrent.pieceLength, chosen)
  let skipped = 0
  for (const block of blocks) {
    if (wanted[block.index] || block.rangeEnd === null) continue
    block.status = 'skipped'
    skipped += block.rangeEnd - block.rangeStart + 1
  }
  return skipped
}

/** Where the files not `chosen` are, inside the staging folder. */
function unchosenPaths(torrent: TorrentInfo, chosen: Set<number> | null): string[] {
  return chosen
    ? torrent.files.filter((_, index) => !chosen.has(index)).map((file) => file.path)
    : []
}

function formatGigabytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/** The staging file is on the destination volume and becomes the final file by rename. */
async function ensureDiskSpace(destinationDir: string, requiredBytes: number): Promise<void> {
  if (requiredBytes <= 0) return // unknown size — nothing to check against
  const stats = await statfs(destinationDir)
  const availableBytes = stats.bavail * stats.bsize
  if (availableBytes < requiredBytes) {
    throw new Error(
      `Not enough disk space: this download needs ${formatGigabytes(requiredBytes)} but only ${formatGigabytes(availableBytes)} is free`
    )
  }
}

export class DownloadManager {
  private runtimes = new Map<string, DownloadRuntime>()
  private readonly initialization: Promise<void>
  private suspending = false
  /** Each network's addresses as last seen, by id: what tells a network that has changed. */
  private seenAddresses = new Map<string, string[]>()
  /** The powerSaveBlocker keeping the computer awake while a download runs (see keepAwake). */
  private awakeBlocker: number | null = null

  constructor(
    private getWindow: () => BrowserWindow | null,
    private networks: NetworkMonitor
  ) {
    this.initialization = this.restorePersistedDownloads()
  }

  private downloadsRoot(): string {
    return join(app.getPath('userData'), 'downloads')
  }

  private downloadDir(id: string): string {
    return join(this.downloadsRoot(), id)
  }

  private manifestPath(id: string): string {
    return join(this.downloadDir(id), 'manifest.json')
  }

  /** Where a torrent download keeps its .torrent, beside its manifest. */
  private torrentFilePath(id: string): string {
    return join(this.downloadDir(id), 'metadata.torrent')
  }

  private runtimeFields(): RuntimeFields {
    return {
      publishing: false,
      pushScheduled: false,
      persistenceChain: Promise.resolve(),
      removed: false,
      sentUpdates: 0,
      sentUnits: []
    }
  }

  private newHttpRuntime(
    state: HttpDownloadState,
    requestPayload: StartHttpDownloadRequest,
    file: DownloadFile,
    blocks: HttpBlockState[]
  ): HttpDownloadRuntime {
    const target: HttpTransferTarget = {
      state,
      requestPayload,
      stop: new AbortController(),
      file,
      blocks,
      speedSamplesByStream: new Map<number, SpeedSample[]>()
    }
    const host: TransferHost = {
      networks: this.networks,
      reconcile: () => this.reconcile(runtime),
      failDownload: (message, discard) => this.failDownload(runtime, message, discard),
      failNetwork: (network, message) => this.failNetwork(runtime, network, message),
      scheduleUpdate: () => this.scheduleUpdate(runtime)
    }
    const runtime: HttpDownloadRuntime = Object.assign(target, this.runtimeFields(), {
      kind: 'http' as const,
      transfer: new HttpTransfer(target, host)
    })
    return runtime
  }

  private newTorrentRuntime(
    state: TorrentDownloadState,
    requestPayload: StartTorrentDownloadRequest,
    file: StagingFolder,
    pieces: TorrentDownloadState['pieces'],
    torrentFile: Uint8Array
  ): TorrentDownloadRuntime {
    const target: TorrentTransferTarget = {
      state,
      requestPayload,
      stop: new AbortController(),
      file,
      pieces,
      speedSamplesByPeer: new Map<number, SpeedSample[]>()
    }
    const host: TransferHost = {
      networks: this.networks,
      reconcile: () => this.reconcile(runtime),
      failDownload: (message, discard) => this.failDownload(runtime, message, discard),
      failNetwork: (network, message) => this.failNetwork(runtime, network, message),
      scheduleUpdate: () => this.scheduleUpdate(runtime)
    }
    const runtime: TorrentDownloadRuntime = Object.assign(target, this.runtimeFields(), {
      kind: 'torrent' as const,
      transfer: new TorrentTransfer(target, host, torrentFile, file.folder)
    })
    return runtime
  }

  private async restorePersistedDownloads(): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(this.downloadsRoot())
    } catch {
      return
    }

    const restored: DownloadRuntime[] = []
    await Promise.all(
      entries.map(async (id) => {
        try {
          await rm(`${this.manifestPath(id)}.tmp`, { force: true })
          const persisted = JSON.parse(await readFile(this.manifestPath(id), 'utf-8')) as
            PersistedDownload | LegacyPersistedDownload
          if (persisted.state.id !== id) return
          const isTorrent = persisted.state.kind === 'torrent'
          const requestPayload: StartDownloadRequest =
            persisted.version === 6
              ? persisted.requestPayload
              : isTorrent
                ? {
                    ...persisted.requestPayload,
                    kind: 'torrent',
                    infoHash: persisted.requestPayload.infoHash ?? ''
                  }
                : { ...persisted.requestPayload, kind: 'http' }
          const torrentFile = isTorrent ? await readFile(this.torrentFilePath(id)) : undefined
          const torrentProbe = torrentFile
            ? await describeTorrent(torrentFile, requestPayload.url)
            : undefined
          const torrent = torrentProbe?.kind === 'torrent' ? torrentProbe.torrent : undefined

          let state: DownloadState
          let runtime: DownloadRuntime
          if (isTorrent && torrent && requestPayload.kind === 'torrent') {
            const old = persisted.state as
              Omit<TorrentDownloadState, 'pieces' | 'peers'> | LegacyDownloadState
            const saved: SavedBlocks = {
              progress: persisted.progress ?? {},
              complete: persisted.complete === true
            }
            const pieces =
              persisted.version === 4
                ? (old as LegacyDownloadState).blocks?.map((piece) => ({
                    ...piece,
                    kind: 'torrent' as const,
                    provisionalBytes: 0
                  }))
                : restorePieces(
                    {
                      totalBytes: old.totalBytes,
                      pieceLength:
                        persisted.version === 6
                          ? (old as Omit<TorrentDownloadState, 'pieces' | 'peers'>).pieceLength
                          : torrent.pieceLength,
                      totalPieces:
                        persisted.version === 6
                          ? (old as Omit<TorrentDownloadState, 'pieces' | 'peers'>).totalPieces
                          : ((old as LegacyDownloadState).totalBlocks ??
                            Math.ceil(old.totalBytes / torrent.pieceLength))
                    },
                    saved
                  )
            if (!pieces) return
            const networks =
              old.networks?.map((network) => ({
                ...network,
                transfer: 'torrent' as const,
                bytesUploaded: network.bytesUploaded ?? 0,
                uploadSpeedBytesPerSec: 0
              })) ??
              (persisted.activeInterfaces ?? []).map((iface) => newTorrentNetwork(iface, true))
            state = {
              ...commonState(old),
              kind: 'torrent',
              networks,
              peers: [],
              peakPeers:
                persisted.version === 6
                  ? (old as Omit<TorrentDownloadState, 'pieces' | 'peers'>).peakPeers
                  : ((old as LegacyDownloadState).peakStreams ?? 0),
              pieces,
              totalPieces: pieces.length,
              pieceLength: torrent.pieceLength,
              files: old.files ?? { chosen: torrent.files.length, total: torrent.files.length },
              skippedBytes: old.skippedBytes ?? 0,
              bytesUploaded: old.bytesUploaded ?? 0,
              uploadSpeedBytesPerSec: 0
            }
            runtime = this.newTorrentRuntime(
              state,
              requestPayload,
              new StagingFolder(persisted.partialPath, state.totalBytes, []),
              pieces,
              torrentFile!
            )
          } else if (!isTorrent && requestPayload.kind === 'http') {
            const old = persisted.state as
              Omit<HttpDownloadState, 'blocks' | 'streams'> | LegacyDownloadState
            const saved: SavedBlocks = {
              progress: persisted.progress ?? {},
              complete: persisted.complete === true
            }
            const blocks =
              persisted.version === 4
                ? (old as LegacyDownloadState).blocks
                    ?.filter((block) => block.status !== 'skipped')
                    .map((block) => ({
                      ...block,
                      kind: 'http' as const,
                      status: block.status as HttpBlockState['status']
                    }))
                : restoreBlocks(
                    {
                      totalBytes: old.totalBytes,
                      blockSizeBytes:
                        (old as Omit<HttpDownloadState, 'blocks' | 'streams'>).blockSizeBytes ?? 0,
                      totalBlocks:
                        (old as Omit<HttpDownloadState, 'blocks' | 'streams'>).totalBlocks ?? 0
                    },
                    saved
                  )
            if (!blocks) return
            const networks =
              old.networks?.map((network) => ({ ...network, transfer: 'http' as const })) ??
              (persisted.activeInterfaces ?? []).map((iface) => newHttpNetwork(iface, true))
            state = {
              ...commonState(old),
              kind: 'http',
              networks,
              streams: [],
              peakStreams: (old as Omit<HttpDownloadState, 'blocks' | 'streams'>).peakStreams ?? 0,
              blocks,
              totalBlocks: blocks.length,
              blockSizeBytes:
                (old as Omit<HttpDownloadState, 'blocks' | 'streams'>).blockSizeBytes ?? 0
            }
            runtime = this.newHttpRuntime(
              state,
              requestPayload,
              new DownloadFile(persisted.partialPath),
              blocks
            )
          } else {
            return
          }
          const units = unitsOf(runtime)
          if (state.status === 'downloading') {
            state.status = 'paused'
            state.pausedAt = persisted.savedAt || Date.now()
          }
          clearSpeeds(state)
          for (const unit of units) {
            if (unit.status === 'downloading') unit.status = 'pending'
            if (unit.kind === 'torrent') unit.provisionalBytes = 0
          }

          const chosen = torrent
            ? chosenFiles(
                requestPayload.kind === 'torrent' ? requestPayload.selectedFiles : undefined,
                torrent.files.length
              )
            : null
          if (torrent && state.kind === 'torrent') {
            state.skippedBytes = skipUnchosen(state.pieces, torrent, chosen)
          }
          if (torrent && runtime.kind === 'torrent') {
            runtime.file = new StagingFolder(
              persisted.partialPath,
              state.totalBytes,
              unchosenPaths(torrent, chosen)
            )
          }
          const file = runtime.file
          if (state.status === 'paused') {
            const size = await file.size().catch(() => -1)
            const publishedPath = persisted.publicationPath ?? state.destinationPath
            const published = await stat(publishedPath).catch(() => null)
            // A torrent's folder of files: its identity below is what tells it's this download's.
            const publishedSize = published?.isDirectory()
              ? state.totalBytes
              : (published?.size ?? -1)
            const expected = state.totalBytes || state.bytesDownloaded
            const sameFile =
              !!published &&
              (size >= 0
                ? await stat(file.path)
                    .then(
                      (partial) => partial.dev === published.dev && partial.ino === published.ino
                    )
                    .catch(() => false)
                : persisted.publicationIdentity?.dev === published.dev &&
                  persisted.publicationIdentity?.ino === published.ino)
            if (units.every(isDone) && publishedSize === expected && sameFile) {
              state.status = 'completed'
              state.destinationPath = publishedPath
              state.fileName = basename(publishedPath)
              state.error = undefined
              state.completedAt ??= persisted.savedAt
              if (size >= 0) await file.discard()
            } else if (size < 0) {
              state.status = 'error'
              state.error =
                'The partial download file is missing. Remove this download and start again.'
              state.resumable = false
            } else {
              for (const unit of units) {
                const length = unit.rangeEnd === null ? 0 : unit.rangeEnd - unit.rangeStart + 1
                if (
                  unit.rangeStart + unit.bytesDownloaded > size ||
                  (unit.status === 'completed' && unit.bytesDownloaded !== length)
                ) {
                  unit.status = 'pending'
                  unit.bytesDownloaded = 0
                  unit.bytesByInterface = {}
                }
              }
              state.bytesDownloaded = units.reduce((sum, unit) => sum + unit.bytesDownloaded, 0)
            }
          }

          runtime.publicationPath = persisted.publicationPath
          runtime.publicationIdentity = persisted.publicationIdentity
          recomputeAggregates(state, units)
          restored.push(runtime)
        } catch {
          // Ignore incomplete or corrupt manifests; other downloads can still be restored.
        }
      })
    )

    // Plexo only ever tracks one current download — getCurrentDownload() always returns
    // whichever restored runtime started most recently. Any other one restored alongside it is
    // an orphan (most likely left over from before concurrent starts were blocked): nothing
    // would ever look at it again, so left in `runtimes` it would sit there forever, invisibly
    // failing every future start() with "a download is already in progress".
    restored.sort((a, b) => b.state.startedAt - a.state.startedAt)
    const [current, ...orphans] = restored

    await Promise.all(
      orphans.map((runtime) =>
        this.removePersistedDownload(runtime, runtime.file.path !== current?.file.path)
      )
    )

    if (current) {
      if (current.state.status === 'completed' && current.publicationIdentity) {
        const published = await stat(current.state.destinationPath).catch(() => null)
        if (
          published?.dev === current.publicationIdentity.dev &&
          published.ino === current.publicationIdentity.ino
        ) {
          await current.file.discard().catch(() => {})
        }
      }
      this.runtimes.set(current.state.id, current)
      await this.persistNow(current)
    }
  }

  /** A snapshot of the current download: an update with every work unit in it. */
  async getCurrentDownload(): Promise<DownloadUpdate | null> {
    await this.initialization
    const latest = [...this.runtimes.values()].sort(
      (a, b) => b.state.startedAt - a.state.startedAt
    )[0]
    if (!latest) return null
    if (latest.kind === 'http') {
      const { blocks, ...state } = latest.state
      return structuredClone({ seq: latest.sentUpdates, state, blocks })
    }
    const { pieces, ...state } = latest.state
    return structuredClone({ seq: latest.sentUpdates, state, pieces })
  }

  /** Plexo shows one download at a time (see useAppStore's currentDownload) — starting a second
   * one while one is already running or paused would silently race it for disk I/O and
   * scramble the renderer's single-download view as updates from both interleave. */
  hasActiveDownload(): boolean {
    for (const runtime of this.runtimes.values()) {
      if (runtime.state.status === 'downloading' || runtime.state.status === 'paused') {
        return true
      }
    }
    return false
  }

  async start(requestPayload: StartDownloadRequest): Promise<string> {
    await this.initialization
    if (this.hasActiveDownload()) {
      throw new Error('A download is already in progress — finish or remove it first.')
    }

    const available = await this.networks.refresh()
    const selected = available.filter((iface) => requestPayload.interfaceIds.includes(iface.id))
    if (selected.length === 0) {
      throw new Error('Select at least one network interface')
    }
    await ensureDirectory(requestPayload.destinationDir)
    const id = randomUUID()
    let runtime: DownloadRuntime
    if (requestPayload.kind === 'torrent') {
      const torrentFile = probedTorrentFile(requestPayload.infoHash)
      if (!torrentFile) throw new Error('Look at this torrent again, then start it')
      const torrentProbe = await describeTorrent(torrentFile, requestPayload.url)
      if (torrentProbe.kind !== 'torrent') throw new Error('Invalid torrent metadata')
      const torrent = torrentProbe.torrent
      const totalBytes = torrent.files.reduce((sum, entry) => sum + entry.length, 0)
      const chosen = chosenFiles(requestPayload.selectedFiles, torrent.files.length)
      const pieces = planPieces(totalBytes, torrent.pieceLength)
      const skippedBytes = skipUnchosen(pieces, torrent, chosen)
      await ensureDiskSpace(requestPayload.destinationDir, totalBytes - skippedBytes)
      const destinationPath = await reserveDestinationPath(
        requestPayload.destinationDir,
        requestPayload.suggestedFileName
      )
      const file = await StagingFolder.create(
        destinationPath,
        torrent.files[0].path.split(sep)[0],
        totalBytes,
        unchosenPaths(torrent, chosen)
      )
      await ensureDirectory(this.downloadDir(id))
      await writeFile(this.torrentFilePath(id), torrentFile)
      const state: TorrentDownloadState = {
        id,
        kind: 'torrent',
        files: { chosen: chosen?.size ?? torrent.files.length, total: torrent.files.length },
        url: requestPayload.url,
        fileName: basename(destinationPath),
        destinationPath,
        totalBytes,
        skippedBytes,
        bytesDownloaded: 0,
        speedBytesPerSec: 0,
        bytesUploaded: 0,
        uploadSpeedBytesPerSec: 0,
        status: 'downloading',
        networks: available.map((iface) => newTorrentNetwork(iface, selected.includes(iface))),
        peers: [],
        peakPeers: 0,
        pieces,
        totalPieces: pieces.length,
        pieceLength: torrent.pieceLength,
        startedAt: Date.now()
      }
      runtime = this.newTorrentRuntime(state, requestPayload, file, pieces, torrentFile)
    } else {
      const target = new URL(requestPayload.url)
      const usable = compatibleInterfaces(
        selected,
        await resolveTargetWithin(targetHost(target), testKnobs.stallTimeoutMs)
      )
      if (usable.length === 0) throw new NoCompatibleRouteError(targetHost(target))
      const blockSizeBytes = planDownload({
        totalBytes: requestPayload.totalBytes,
        splittable: requestPayload.supportsRanges,
        networkCount: usable.length,
        maxBlockBytes: testKnobs.blockBytes
      }).blockSizeBytes
      const blocks = planBlocks(requestPayload.totalBytes, blockSizeBytes)
      await ensureDiskSpace(requestPayload.destinationDir, requestPayload.totalBytes)
      const destinationPath = await reserveDestinationPath(
        requestPayload.destinationDir,
        requestPayload.suggestedFileName
      )
      const networks = available.map((iface) => newHttpNetwork(iface, usable.includes(iface)))
      if (!splittable(requestPayload)) {
        for (const network of networks) network.enabled &&= network.id === usable[0].id
        for (const network of networks) network.status = network.enabled ? 'on' : 'off'
      }
      const state: HttpDownloadState = {
        id,
        kind: 'http',
        url: requestPayload.url,
        fileName: basename(destinationPath),
        destinationPath,
        totalBytes: requestPayload.totalBytes,
        bytesDownloaded: 0,
        speedBytesPerSec: 0,
        status: 'downloading',
        networks,
        streams: [],
        peakStreams: 0,
        blocks,
        totalBlocks: blocks.length,
        blockSizeBytes,
        startedAt: Date.now()
      }
      runtime = this.newHttpRuntime(
        state,
        requestPayload,
        new DownloadFile(`${destinationPath}.plexo`),
        blocks
      )
    }
    this.runtimes.set(id, runtime)
    await this.persistNow(runtime)
    this.pushUpdate(runtime)

    runtime.runPromise = this.run(runtime)

    return id
  }

  async pause(id: string): Promise<void> {
    const runtime = this.runtimes.get(id)
    if (!runtime || runtime.state.status !== 'downloading' || runtime.publishing) return

    runtime.state.status = 'paused'
    runtime.state.pausedAt = Date.now()
    clearSpeeds(runtime.state)
    if (runtime.kind === 'http') {
      for (const stream of runtime.state.streams) {
        if (stream.status !== 'completed') {
          stream.status = 'paused'
        }
        stream.currentBlockIndex = undefined
        stream.hedge = undefined
      }
    }
    for (const unit of unitsOf(runtime)) {
      if (unit.status === 'downloading') {
        unit.status = 'pending'
      }
      if (unit.kind === 'torrent') unit.provisionalBytes = 0
    }
    runtime.transfer.reset()
    this.stopRun(runtime)
    this.pushUpdate(runtime)
    await runtime.runPromise
    await this.persistNow(runtime)
  }

  resume(id: string): void {
    const runtime = this.runtimes.get(id)
    if (!runtime) return
    const { status, resumable } = runtime.state
    if (status !== 'paused' && !(status === 'error' && resumable !== false)) return

    void this.resumeAfterVerifying(runtime, false)
  }

  // A file that changed on the server while this download was paused is caught by the first
  // chunk request after resuming: its response is checked against the version the download
  // started on (see runWorker), which can tell a real change from a relabelled server. Whether a
  // network is there to resume on is the run's business: with none, it waits for one.
  // `byNetwork`: resumed by switching a network back on, rather than by Resume.
  private async resumeAfterVerifying(runtime: DownloadRuntime, byNetwork: boolean): Promise<void> {
    // The paused run can still be winding down: a writer closing, a sample check in flight. A new
    // one must not start beside it — both would go on to publish, and act on each other's streams.
    await runtime.runPromise
    // Just after launch the networks may not have been looked at yet.
    await this.networks.refresh()

    if ((await runtime.file.size().catch(() => -1)) < 0) {
      runtime.state.error =
        'The partial download file is unavailable. Reconnect the destination drive and try again.'
      this.pushUpdate(runtime)
      return
    }
    if (runtime.state.status !== 'paused' && runtime.state.status !== 'error') return
    const { networks } = runtime.state
    // Switched back on, then off again while the paused run wound down: it stays paused.
    if (byNetwork && !networks.some((network) => network.enabled)) return

    runtime.state.status = 'downloading'
    runtime.state.error = undefined
    runtime.state.resumable = undefined
    runtime.pausedForNoNetwork = undefined
    // Paused by switching off every network: resuming switches back on the one switched off
    // last if it is still there, or else the first one present.
    if (!networks.some((network) => network.enabled)) {
      const present = (network: { id: string }): boolean => !!this.networks.find(network.id)
      const again =
        networks.find((network) => network.id === runtime.lastSwitchedOff && present(network)) ??
        networks.find(present) ??
        networks.find((network) => network.id === runtime.lastSwitchedOff) ??
        networks[0]
      if (again) again.enabled = true
    }
    // A network that had failed, or couldn't get through, gets another go.
    for (const network of runtime.state.networks) {
      if (network.status === 'failed' || network.status === 'unreachable') {
        network.status = 'on'
        network.error = undefined
      }
    }
    if (runtime.state.pausedAt) {
      runtime.state.totalPausedMs =
        (runtime.state.totalPausedMs || 0) + (Date.now() - runtime.state.pausedAt)
      runtime.state.pausedAt = undefined
    }
    for (const unit of unitsOf(runtime)) {
      if (unit.status === 'downloading') {
        unit.status = 'pending'
      }
      if (unit.kind === 'torrent') unit.provisionalBytes = 0
    }
    if (runtime.kind === 'http') {
      for (const stream of runtime.state.streams) {
        if (stream.status !== 'completed') {
          stream.status = 'pending'
        }
        runtime.speedSamplesByStream.delete(stream.id)
        stream.speedBytesPerSec = 0
      }
    } else {
      runtime.state.peers.length = 0
      runtime.speedSamplesByPeer.clear()
    }
    runtime.transfer.reset()
    this.pushUpdate(runtime)

    runtime.runPromise = this.run(runtime)
  }

  /** Switches one of a download's networks on or off, running or paused. Switching off the last
   * network in use pauses the download; switching one back on then resumes it. */
  async setNetworkEnabled(id: string, networkId: string, enabled: boolean): Promise<void> {
    const runtime = this.runtimes.get(id)
    const status = runtime?.state.status
    if (!runtime || (status !== 'downloading' && status !== 'paused')) return
    const { networks } = runtime.state
    const network = networks.find((entry) => entry.id === networkId)
    if (!network || network.enabled === enabled) return
    const wasLast = !enabled && !networks.some((other) => other !== network && other.enabled)
    // A download that can't be split runs over one network: switching one on switches it over.
    if (enabled && runtime.kind === 'http' && !splittable(runtime.requestPayload)) {
      for (const other of networks) other.enabled = false
    }
    network.enabled = enabled
    if (!enabled) runtime.lastSwitchedOff = network.id
    if (wasLast && status === 'downloading') {
      runtime.pausedForNoNetwork = true
      await this.pause(id)
      // Not paused after all (it was already publishing): nothing for a network to resume.
      if (runtime.state.status !== 'paused') runtime.pausedForNoNetwork = undefined
      return
    }
    this.reconcile(runtime)
    this.pushUpdate(runtime)
    // Switched back on while the pause is still winding down, it resumes once that is done.
    if (enabled && status === 'paused' && runtime.pausedForNoNetwork) {
      void this.resumeAfterVerifying(runtime, true)
    }
  }

  /** The computer's networks changed (see NetworkMonitor). A network whose addresses changed
   * gets its streams going again at once: what they were waiting out may be what changed. One
   * that lost an address also drops its sockets, which may be bound to it. Chrome does the same
   * when its IP address changes (ERR_NETWORK_CHANGED). */
  networksChanged(): void {
    const changed = new Set<string>()
    const moved = new Set<string>()
    const seen = new Map<string, string[]>()
    for (const iface of this.networks.current ?? []) {
      const addresses = iface.addresses.map((entry) => entry.address)
      const before = this.seenAddresses.get(iface.id)
      seen.set(iface.id, addresses)
      if (before?.length === addresses.length && before.every((a) => addresses.includes(a))) {
        continue
      }
      changed.add(iface.id)
      if (before?.some((address) => !addresses.includes(address))) moved.add(iface.id)
    }
    this.seenAddresses = seen

    for (const runtime of this.runtimes.values()) {
      const { status } = runtime.state
      if (status !== 'downloading' && status !== 'paused') continue
      this.reconcile(runtime)
      runtime.transfer.wake(
        (id) => changed.has(id),
        (id) => moved.has(id)
      )
      this.scheduleUpdate(runtime)
    }
  }

  /** The computer woke from sleep. Its sockets are likely dead, though nothing will say so until
   * a stall watchdog runs out, and every judgement made by the clock (a silent network, a
   * crawling connection) spans the sleep. All of it starts over. */
  systemResumed(): void {
    const now = Date.now()
    for (const runtime of this.runtimes.values()) {
      if (runtime.state.status !== 'downloading') continue
      runtime.transfer.systemResumed(now)
    }
  }

  /** Keeps the computer from sleeping while a download runs, which would stop it — as
   * qBittorrent and Transmission offer to. The display can still sleep. */
  private keepAwake(): void {
    const running = [...this.runtimes.values()].some(
      (runtime) => runtime.state.status === 'downloading'
    )
    try {
      if (running && this.awakeBlocker === null) {
        this.awakeBlocker = powerSaveBlocker.start('prevent-app-suspension')
      } else if (!running && this.awakeBlocker !== null) {
        powerSaveBlocker.stop(this.awakeBlocker)
        this.awakeBlocker = null
      }
    } catch {
      // Not every desktop can be kept awake; the download runs regardless.
    }
  }

  async cancel(id: string): Promise<void> {
    const runtime = this.runtimes.get(id)
    if (
      !runtime ||
      runtime.publishing ||
      (runtime.state.status !== 'downloading' &&
        runtime.state.status !== 'paused' &&
        runtime.state.status !== 'error')
    )
      return

    runtime.state.status = 'cancelled'
    clearSpeeds(runtime.state)
    if (runtime.kind === 'http') {
      for (const stream of runtime.state.streams) stream.status = 'cancelled'
    }
    this.stopRun(runtime)
    this.pushUpdate(runtime, false)
    await runtime.runPromise
    await runtime.file.discard()
    await this.removePersistedDownload(runtime)
  }

  async remove(id: string): Promise<void> {
    const runtime = this.runtimes.get(id)
    if (
      runtime &&
      (runtime.state.status === 'downloading' ||
        runtime.state.status === 'paused' ||
        runtime.state.status === 'error')
    ) {
      await this.cancel(id)
    }
    this.runtimes.delete(id)
    if (runtime) await this.removePersistedDownload(runtime)
  }

  async suspendAll(): Promise<void> {
    await this.initialization
    this.suspending = true
    await Promise.all(
      [...this.runtimes.values()].map(async (runtime) => {
        if (runtime.state.status === 'downloading') await this.pause(runtime.state.id)
        else await this.persistNow(runtime)
      })
    )
  }

  /**
   * Runs the download until every block is in, or it is stopped. Each TICK_MS, and whenever a
   * stream ends, it takes stock: speeds, stuck connections, which networks run streams (see
   * reconcile) and how many (see concurrency.ts). With no network to use, it waits for one.
   */
  private async run(runtime: DownloadRuntime): Promise<void> {
    if (runtime.stop.signal.aborted) runtime.stop = new AbortController()
    runtime.transfer.reset()
    const { signal } = runtime.stop
    this.reconcile(runtime)

    while (
      runtime.state.status === 'downloading' &&
      unitsOf(runtime).some((unit) => !isDone(unit))
    ) {
      await Promise.race([delay(TICK_MS, signal), ...runtime.transfer.running()])
      if ((runtime.state.status as DownloadStatus) !== 'downloading') break
      const now = Date.now()
      const speed = runtime.state.speedBytesPerSec
      updateSpeeds(runtime, now)
      if (runtime.state.speedBytesPerSec !== speed) this.scheduleUpdate(runtime)
      runtime.transfer.tick(now)
    }
    // The last blocks are in, or the run was stopped: its streams wind down.
    runtime.stop.abort()
    await Promise.all(runtime.transfer.running())

    if (runtime.state.status !== 'downloading') {
      // Paused, errored, or cancelled — nothing left to do right now. An error keeps what it has
      // unless it can't be resumed (see failDownload); cancel() discards it.
      if (runtime.state.status === 'error') {
        this.pushUpdate(runtime)
        if (runtime.state.resumable === false) await runtime.file.discard()
      }
      return
    }

    runtime.publishing = true
    try {
      if (unitsOf(runtime).some((unit) => !isDone(unit))) {
        throw new Error('Download is incomplete — refusing to publish the file')
      }
      await this.persistNow(runtime)
      const publishedPath = await runtime.file.publish(
        runtime.state.destinationPath,
        runtime.state.totalBytes,
        async (candidate) => {
          runtime.publicationPath = candidate
          const partial = await stat(runtime.file.path)
          runtime.publicationIdentity = { dev: partial.dev, ino: partial.ino }
          await this.persistNow(runtime, true)
        }
      )
      runtime.state.destinationPath = publishedPath
      runtime.state.fileName = basename(publishedPath)
      runtime.state.status = 'completed'
      runtime.state.completedAt = Date.now()
      runtime.state.bytesDownloaded =
        runtime.state.totalBytes -
          (runtime.state.kind === 'torrent' ? runtime.state.skippedBytes : 0) ||
        runtime.state.bytesDownloaded
      await this.persistNow(runtime)
      await runtime.file.discard().catch(() => {})
      this.notify('Download Complete', `${runtime.state.fileName} has finished downloading.`)
    } catch (error) {
      runtime.state.status = 'error'
      runtime.state.error = error instanceof Error ? error.message : String(error)
      this.notify('Download Failed', `${runtime.state.fileName}: ${runtime.state.error}`)
    }
    runtime.publishing = false

    this.pushUpdate(runtime)
  }

  /** Stops the current run: every stream, and the run's own wait. */
  private stopRun(runtime: DownloadRuntime): void {
    runtime.stop.abort()
    runtime.transfer.abort()
  }

  /** Ends the download in an error. What it has downloaded stays for a resume, unless
   * `discard`: bytes that are no use any more. */
  private failDownload(runtime: DownloadRuntime, message: string, discard = false): void {
    if (runtime.state.status !== 'downloading') return
    runtime.state.status = 'error'
    runtime.state.error = message
    runtime.state.resumable = !discard
    this.notify('Download Failed', `${runtime.state.fileName}: ${message}`)
    this.stopRun(runtime)
  }

  /** The server keeps refusing requests over this network: it stops being used until the user
   * switches it off and on, it reconnects, or the download is resumed. */
  private failNetwork(runtime: DownloadRuntime, network: DownloadNetwork, message: string): void {
    network.status = 'failed'
    network.error = message
    this.reconcile(runtime)
  }

  /**
   * Brings the download's networks up to date with the computer's, and each network's streams in
   * line with what it can do now. Runs every tick and whenever something changes — a network
   * came or went, the user switched one, one stopped getting through — and is safe to run any
   * time.
   *
   * Networks: every one on the computer is listed; one that turns up mid-download starts off,
   * for the user to switch on. A network the download never used is dropped once it goes.
   *
   * Streams, while the download runs, are the transfer's (see HttpTransfer.reconcile).
   */
  private reconcile(runtime: DownloadRuntime): void {
    const { state } = runtime
    const present = this.networks.current
    // Until the monitor has looked, nothing is known to be gone.
    const known = present !== null
    if (known) {
      if (state.kind === 'http') {
        state.networks = state.networks.filter(
          (network) =>
            network.enabled ||
            network.bytesDownloaded > 0 ||
            present.some((iface) => iface.id === network.id) ||
            state.streams.some((stream) => stream.interfaceId === network.id)
        )
      } else {
        state.networks = state.networks.filter(
          (network) =>
            network.enabled ||
            network.bytesDownloaded > 0 ||
            network.bytesUploaded > 0 ||
            present.some((iface) => iface.id === network.id) ||
            state.peers.some((peer) => peer.interfaceId === network.id)
        )
      }
      for (const iface of present) {
        if (!state.networks.some((network) => network.id === iface.id)) {
          if (state.kind === 'http') state.networks.push(newHttpNetwork(iface, false))
          else state.networks.push(newTorrentNetwork(iface, false))
        }
      }
    }

    for (const network of state.networks) {
      const iface = this.networks.find(network.id)
      if (iface) {
        network.label = iface.displayName
        network.kind = iface.kind
      }
      const status: NetworkStatus = !network.enabled
        ? 'off'
        : !iface && known
          ? 'offline'
          : network.status === 'off' || network.status === 'offline'
            ? 'on'
            : network.status
      if (status !== network.status) {
        network.status = status
        network.error = undefined
      }
    }
    if (state.status !== 'downloading' || runtime.stop.signal.aborted) return

    const enabled = state.networks.filter((network) => network.enabled)
    if (enabled.length > 0 && enabled.every((network) => network.status === 'failed')) {
      this.failDownload(runtime, enabled[0].error ?? 'No network could reach the server')
      return
    }

    runtime.transfer.reconcile()
  }

  private notify(title: string, body: string): void {
    if (testKnobs.userDataDir || !Notification.isSupported()) return
    try {
      const notification = new Notification({ title, body })
      notification.on('click', () => {
        const window = this.getWindow()
        if (window && !window.isDestroyed()) {
          if (window.isMinimized()) window.restore()
          window.show()
          window.focus()
        }
      })
      notification.show()
    } catch {
      // Best-effort notification
    }
  }

  private scheduleUpdate(runtime: DownloadRuntime): void {
    if (runtime.pushScheduled) return
    runtime.pushScheduled = true
    setTimeout(() => {
      runtime.pushScheduled = false
      this.pushUpdate(runtime)
    }, UI_UPDATE_MS)
  }

  private pushUpdate(runtime: DownloadRuntime, persist = true): void {
    this.keepAwake()
    // A removed download can still be winding down (workers finishing, cleanup). Its updates
    // would put it back on screen after the renderer has already moved on.
    if (this.runtimes.get(runtime.state.id) !== runtime) return
    if (persist) this.schedulePersistence(runtime)
    const window = this.getWindow()
    if (!window || window.isDestroyed()) return
    if (runtime.state.status === 'paused' || runtime.state.status === 'cancelled') {
      clearSpeeds(runtime.state)
    }
    window.webContents.send(IpcChannels.downloadUpdated, this.takeUpdate(runtime))
  }

  /** What the window hasn't been sent yet: the download's state, and the work units that moved. */
  private takeUpdate(runtime: DownloadRuntime): DownloadUpdate {
    if (runtime.kind === 'http') {
      const changed = this.changedUnits(runtime, runtime.blocks)
      const { blocks: omittedBlocks, ...state } = runtime.state
      void omittedBlocks
      return structuredClone({ seq: ++runtime.sentUpdates, state, blocks: changed })
    }
    const changed = this.changedUnits(runtime, runtime.pieces)
    const { pieces: omittedPieces, ...state } = runtime.state
    void omittedPieces
    return structuredClone({ seq: ++runtime.sentUpdates, state, pieces: changed })
  }

  private changedUnits<T extends DownloadUnitState>(runtime: DownloadRuntime, units: T[]): T[] {
    const sent = runtime.sentUnits
    const changed: T[] = []
    for (const unit of units) {
      const last = sent[unit.index]
      if (
        last?.status === unit.status &&
        last.interfaceId === unit.interfaceId &&
        last.bytesDownloaded === unit.bytesDownloaded &&
        last.provisionalBytes === (unit.kind === 'torrent' ? unit.provisionalBytes : undefined)
      ) {
        continue
      }
      sent[unit.index] = {
        status: unit.status,
        interfaceId: unit.interfaceId,
        bytesDownloaded: unit.bytesDownloaded,
        provisionalBytes: unit.kind === 'torrent' ? unit.provisionalBytes : undefined
      }
      changed.push(unit)
    }
    return changed
  }

  private schedulePersistence(runtime: DownloadRuntime): void {
    if (this.suspending || runtime.removed || runtime.persistenceTimer) return
    runtime.persistenceTimer = setTimeout(() => {
      runtime.persistenceTimer = undefined
      void this.persistNow(runtime)
    }, CHECKPOINT_INTERVAL_MS)
  }

  private persistNow(runtime: DownloadRuntime, required = false): Promise<void> {
    if (runtime.removed) return runtime.persistenceChain
    if (runtime.persistenceTimer) {
      clearTimeout(runtime.persistenceTimer)
      runtime.persistenceTimer = undefined
    }

    const operation = runtime.persistenceChain
      .catch(() => {})
      .then(async () => {
        if (runtime.removed) return
        const dir = this.downloadDir(runtime.state.id)
        const path = this.manifestPath(runtime.state.id)
        const temporaryPath = `${path}.tmp`
        let state: PersistedState
        if (runtime.kind === 'http') {
          const { blocks: omittedBlocks, streams: omittedStreams, ...rest } = runtime.state
          void omittedBlocks
          void omittedStreams
          state = rest
        } else {
          const { pieces: omittedPieces, peers: omittedPeers, ...rest } = runtime.state
          void omittedPieces
          void omittedPeers
          state = rest
        }
        const persisted: PersistedDownload = {
          version: 6,
          savedAt: Date.now(),
          state: structuredClone(state),
          ...saveBlocks(unitsOf(runtime)),
          partialPath: runtime.file.path,
          publicationPath: runtime.publicationPath,
          publicationIdentity: runtime.publicationIdentity,
          requestPayload: runtime.requestPayload
        }
        if (runtime.state.status === 'downloading' || runtime.state.status === 'paused') {
          await runtime.file.sync()
        }
        await ensureDirectory(dir)
        await writeFile(temporaryPath, JSON.stringify(persisted), 'utf-8')
        await rename(temporaryPath, path)
      })
    runtime.persistenceChain = operation.catch(() => {
      // Routine progress checkpoints are best-effort. Publication intent is required.
    })
    return required ? operation : runtime.persistenceChain
  }

  private async removePersistedDownload(
    runtime: DownloadRuntime,
    discardPartial = true
  ): Promise<void> {
    runtime.removed = true
    if (runtime.persistenceTimer) clearTimeout(runtime.persistenceTimer)
    await runtime.persistenceChain.catch(() => {})
    if (discardPartial) await runtime.file.discard().catch(() => {})
    await rm(this.downloadDir(runtime.state.id), { recursive: true, force: true })
  }
}
