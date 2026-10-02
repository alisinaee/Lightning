import { randomUUID } from 'node:crypto'
import { readFile, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { basename, join, sep } from 'node:path'
import type { BrowserWindow } from 'electron'
import { app, Notification, powerSaveBlocker } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import type {
  BlockState,
  DownloadNetwork,
  DownloadState,
  DownloadStatus,
  DownloadUpdate,
  NetworkInterfaceInfo,
  NetworkStatus,
  StartDownloadRequest,
  TorrentInfo
} from '../../shared/types'
import { testKnobs } from '../testKnobs'
import { DownloadFile } from './downloadFile'
import { HttpTransfer, splittable } from './httpTransfer'
import { ensureDirectory, reserveDestinationPath } from './paths'
import { planBlocks, planDownload } from './plan'
import { restoreBlocks, saveBlocks, type SavedBlocks } from './savedProgress'
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
  type TransferTarget
} from './transfer'
import type { NetworkMonitor } from '../network/interfaces'
import {
  compatibleInterfaces,
  NoCompatibleRouteError,
  resolveTargetWithin,
  targetHost
} from '../network/routes'

interface DownloadRuntime extends TransferTarget {
  publicationPath?: string
  publicationIdentity?: { dev: number; ino: number }
  /** Fetches the bytes (see transfer.ts). */
  transfer: Transfer
  runPromise?: Promise<void>
  publishing: boolean
  pushScheduled: boolean
  totalBlocks: number
  persistenceTimer?: NodeJS.Timeout
  persistenceChain: Promise<void>
  removed: boolean
  /** Updates sent to the window so far (see DownloadUpdate). */
  sentUpdates: number
  /** Each block as the window was last sent it, by index — what tells a changed block apart. */
  sentBlocks: Pick<BlockState, 'status' | 'interfaceId' | 'bytesDownloaded'>[]
  /** The network most recently switched off: what a resume switches back on if it finds none on.
   * Not persisted: after a restart, the first network present is used instead. */
  lastSwitchedOff?: string
  /** Paused by switching off its last network, rather than by Pause: switching one back on
   * resumes it. */
  pausedForNoNetwork?: boolean
}

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

type PersistedDownload = PersistedDownloadBase &
  (
    | ({ version: 5; state: Omit<DownloadState, 'blocks'> } & SavedBlocks)
    /** Written before version 5, with every block saved whole; still read, so an update doesn't
     * lose the progress of a download it finds paused. */
    | { version: 4; state: DownloadState }
  )

const UI_UPDATE_MS = 200
/** How often a running download takes stock (see run). */
const TICK_MS = 500
// Syncing a growing file can briefly monopolize a slow destination drive. Keep recovery
// checkpoints independent of UI updates; pause and publication still force an immediate sync.
const CHECKPOINT_INTERVAL_MS = 15_000

function newNetwork(iface: NetworkInterfaceInfo, enabled: boolean): DownloadNetwork {
  return {
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

/** A block that needs nothing more: in, or skipped (see BlockStatus). */
const isDone = (block: BlockState): boolean =>
  block.status === 'completed' || block.status === 'skipped'

/** Marks the pieces of `torrent` that none of the `chosen` files needs (null: all are) as
 * skipped. Their bytes, all together. */
function skipUnchosen(
  blocks: BlockState[],
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

  /** A runtime for `state`, with nothing running. A torrent's (`torrentFile` given) is fetched by
   * a TorrentTransfer into its StagingFolder; anything else over HTTP. */
  private newRuntime(
    state: DownloadState,
    requestPayload: StartDownloadRequest,
    file: DownloadFile,
    blocks: BlockState[],
    torrentFile?: Uint8Array
  ): DownloadRuntime {
    const target = {
      state,
      requestPayload,
      stop: new AbortController(),
      file,
      publishing: false,
      speedSamplesByChunk: new Map(),
      pushScheduled: false,
      blocks,
      totalBlocks: state.totalBlocks ?? blocks.length,
      persistenceChain: Promise.resolve(),
      removed: false,
      sentUpdates: 0,
      sentBlocks: []
    }
    const host: TransferHost = {
      networks: this.networks,
      reconcile: () => this.reconcile(runtime),
      failDownload: (message, discard) => this.failDownload(runtime, message, discard),
      failNetwork: (network, message) => this.failNetwork(runtime, network, message),
      scheduleUpdate: () => this.scheduleUpdate(runtime)
    }
    // The transfer holds this same object: what the manager changes on it, the transfer sees.
    const runtime: DownloadRuntime = Object.assign(target, {
      transfer:
        torrentFile && file instanceof StagingFolder
          ? new TorrentTransfer(target, host, torrentFile, file.folder)
          : new HttpTransfer(target, host)
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
          const persisted = JSON.parse(
            await readFile(this.manifestPath(id), 'utf-8')
          ) as PersistedDownload
          if (persisted.state.id !== id) return
          const blocks =
            persisted.version === 5
              ? restoreBlocks(persisted.state, persisted)
              : persisted.version === 4
                ? persisted.state.blocks
                : undefined
          if (!blocks) return
          const state: DownloadState = {
            ...persisted.state,
            // Saved before downloads listed their networks: the ones it ran on, all in use.
            networks:
              (persisted.state.networks as DownloadNetwork[] | undefined) ??
              (persisted.activeInterfaces ?? []).map((iface) => newNetwork(iface, true)),
            // Streams are only for a run; a resumed download starts its own.
            chunks: [],
            blocks
          }
          if (state.status === 'downloading') {
            state.status = 'paused'
            state.pausedAt = persisted.savedAt || Date.now()
          }
          clearSpeeds(state)
          for (const block of blocks) {
            if (block.status === 'downloading') block.status = 'pending'
          }

          // A torrent starts again from its saved .torrent; without it, it can't. Its pieces no
          // chosen file needs are skipped again.
          const torrentFile =
            state.kind === 'torrent' ? await readFile(this.torrentFilePath(id)) : undefined
          const torrent =
            torrentFile &&
            (await describeTorrent(torrentFile, persisted.requestPayload.url)).torrent!
          const chosen = torrent
            ? chosenFiles(persisted.requestPayload.selectedFiles, torrent.files.length)
            : null
          if (torrent) {
            state.skippedBytes = skipUnchosen(blocks, torrent, chosen) || undefined
          }
          const file = torrent
            ? new StagingFolder(
                persisted.partialPath,
                state.totalBytes,
                unchosenPaths(torrent, chosen)
              )
            : new DownloadFile(persisted.partialPath)
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
            if (blocks.every(isDone) && publishedSize === expected && sameFile) {
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
              for (const block of blocks) {
                const length = block.rangeEnd === null ? 0 : block.rangeEnd - block.rangeStart + 1
                if (
                  block.rangeStart + block.bytesDownloaded > size ||
                  (block.status === 'completed' && block.bytesDownloaded !== length)
                ) {
                  block.status = 'pending'
                  block.bytesDownloaded = 0
                  block.bytesByInterface = {}
                }
              }
              state.bytesDownloaded = blocks.reduce((sum, block) => sum + block.bytesDownloaded, 0)
            }
          }

          const runtime = this.newRuntime(
            state,
            persisted.requestPayload,
            file,
            blocks,
            torrentFile
          )
          runtime.publicationPath = persisted.publicationPath
          runtime.publicationIdentity = persisted.publicationIdentity
          recomputeAggregates(runtime)
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

  /** A snapshot of the current download: an update with every block in it. */
  async getCurrentDownload(): Promise<DownloadUpdate | null> {
    await this.initialization
    const latest = [...this.runtimes.values()].sort(
      (a, b) => b.state.startedAt - a.state.startedAt
    )[0]
    if (!latest) return null
    const { blocks, ...state } = latest.state
    return structuredClone({ seq: latest.sentUpdates, state, blocks: blocks ?? latest.blocks })
  }

  /** Plexo shows one download at a time (see useAppStore's currentDownload) — starting a second
   * one while one is already running or paused would silently race it for disk I/O and
   * scramble the renderer's single-download view as updates from both interleave. */
  private hasActiveDownload(): boolean {
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
    // A torrent starts from the .torrent its probe kept, its paths checked again here.
    const torrentFile = requestPayload.infoHash && probedTorrentFile(requestPayload.infoHash)
    if (requestPayload.infoHash && !torrentFile) {
      throw new Error('Look at this torrent again, then start it')
    }
    const torrent = torrentFile && (await describeTorrent(torrentFile, requestPayload.url)).torrent!

    let usable = selected
    // A torrent's peers come in either address family; an HTTP host has its own. A selected
    // network that can't reach the host's family starts switched off.
    if (!torrent) {
      const target = new URL(requestPayload.url)
      usable = compatibleInterfaces(
        selected,
        await resolveTargetWithin(targetHost(target), testKnobs.stallTimeoutMs)
      )
      if (usable.length === 0) throw new NoCompatibleRouteError(targetHost(target))
    }

    const totalBytes = torrent
      ? torrent.files.reduce((sum, entry) => sum + entry.length, 0)
      : requestPayload.totalBytes
    const chosen = torrent ? chosenFiles(requestPayload.selectedFiles, torrent.files.length) : null

    // A torrent's blocks are its pieces.
    const blockSizeBytes = torrent
      ? torrent.pieceLength
      : planDownload({
          totalBytes,
          splittable: requestPayload.supportsRanges,
          networkCount: usable.length,
          maxBlockBytes: testKnobs.blockBytes // 8 MB outside tests
        }).blockSizeBytes
    // The UI caps how many cells it renders separately (see BlockGrid), by bucketing these
    // blocks rather than by shrinking their count here.
    const blocks = planBlocks(totalBytes, blockSizeBytes)
    const skippedBytes = torrent ? skipUnchosen(blocks, torrent, chosen) : 0

    await ensureDirectory(requestPayload.destinationDir)
    // A torrent's files are sparse: what isn't chosen takes no space.
    await ensureDiskSpace(requestPayload.destinationDir, totalBytes - skippedBytes)

    // Claimed on disk, not just picked, so a second download of the same file
    // name can't pick it too and overwrite this one at publish time. Done
    // before anything else is created, so a destination we can't write to
    // leaves nothing behind.
    const destinationPath = await reserveDestinationPath(
      requestPayload.destinationDir,
      requestPayload.suggestedFileName
    )

    const id = randomUUID()
    const file = torrent
      ? // What's published is the torrent's top entry: its file, or its folder.
        await StagingFolder.create(
          destinationPath,
          torrent.files[0].path.split(sep)[0],
          totalBytes,
          unchosenPaths(torrent, chosen)
        )
      : new DownloadFile(`${destinationPath}.plexo`)
    if (torrentFile) {
      await ensureDirectory(this.downloadDir(id))
      await writeFile(this.torrentFilePath(id), torrentFile)
    }

    // The computer's other networks are listed too, switched off, for the user to turn on.
    const networks = available.map((iface) => newNetwork(iface, usable.includes(iface)))
    // Unsplittable: one network carries it (IdleScreen lets only one be picked).
    if (!splittable(requestPayload)) {
      for (const network of networks) network.enabled &&= network.id === usable[0].id
      for (const network of networks) network.status = network.enabled ? 'on' : 'off'
    }

    const state: DownloadState = {
      id,
      kind: torrent ? 'torrent' : undefined,
      url: requestPayload.url,
      fileName: basename(destinationPath),
      destinationPath,
      totalBytes,
      skippedBytes: skippedBytes || undefined,
      bytesDownloaded: 0,
      speedBytesPerSec: 0,
      status: 'downloading',
      networks,
      chunks: [],
      peakStreams: 0,
      blocks,
      totalBlocks: blocks.length,
      blockSizeBytes,
      startedAt: Date.now()
    }

    const runtime = this.newRuntime(state, requestPayload, file, blocks, torrentFile || undefined)
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
    for (const chunk of runtime.state.chunks) {
      if (chunk.status !== 'completed') {
        chunk.status = 'paused'
      }
      chunk.currentBlockIndex = undefined
      chunk.hedge = undefined
    }
    for (const block of runtime.blocks) {
      if (block.status === 'downloading') {
        block.status = 'pending'
      }
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
    for (const block of runtime.blocks) {
      if (block.status === 'downloading') {
        block.status = 'pending'
      }
    }
    for (const chunk of runtime.state.chunks) {
      if (chunk.status !== 'completed') {
        chunk.status = 'pending'
      }
      runtime.speedSamplesByChunk.delete(chunk.id)
      chunk.speedBytesPerSec = 0
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
    if (enabled && !splittable(runtime.requestPayload)) {
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
    for (const chunk of runtime.state.chunks) chunk.status = 'cancelled'
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
      runtime.blocks.some((block) => !isDone(block))
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
      if (runtime.blocks.some((block) => !isDone(block))) {
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
        runtime.state.totalBytes - (runtime.state.skippedBytes ?? 0) ||
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
      state.networks = state.networks.filter(
        (network) =>
          network.enabled ||
          network.bytesDownloaded > 0 ||
          present.some((iface) => iface.id === network.id) ||
          state.chunks.some((chunk) => chunk.interfaceId === network.id)
      )
      for (const iface of present) {
        if (!state.networks.some((network) => network.id === iface.id)) {
          state.networks.push(newNetwork(iface, false))
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

  /** What the window hasn't been sent yet: the download's state, and the blocks that moved. */
  private takeUpdate(runtime: DownloadRuntime): DownloadUpdate {
    const { blocks: all, ...state } = runtime.state
    const sent = runtime.sentBlocks
    const blocks: BlockState[] = []
    for (const block of all ?? runtime.blocks) {
      const last = sent[block.index]
      // bytesByInterface only ever changes along with bytesDownloaded (see blockProgress.ts).
      if (
        last?.status === block.status &&
        last.interfaceId === block.interfaceId &&
        last.bytesDownloaded === block.bytesDownloaded
      ) {
        continue
      }
      sent[block.index] = {
        status: block.status,
        interfaceId: block.interfaceId,
        bytesDownloaded: block.bytesDownloaded
      }
      blocks.push(block)
    }
    return structuredClone({ seq: ++runtime.sentUpdates, state, blocks })
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
        const { blocks, ...state } = runtime.state
        const persisted: PersistedDownload = {
          version: 5,
          savedAt: Date.now(),
          state: structuredClone(state),
          ...saveBlocks(blocks ?? runtime.blocks),
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
