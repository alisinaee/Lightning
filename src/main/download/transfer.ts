import type {
  BlockState,
  DownloadNetwork,
  DownloadState,
  StartDownloadRequest
} from '../../shared/types'
import type { NetworkMonitor } from '../network/interfaces'
import type { DownloadFile } from './downloadFile'

/**
 * How a download's bytes get fetched: HTTP streams today (see httpTransfer.ts). The manager runs
 * everything a download does whatever fetches it — its networks, pause and resume, saving it,
 * telling the window — and hands the fetching to its transfer.
 */
export interface Transfer {
  /** Brings its connections in line with what each network can do now. The manager calls it at
   * the end of its own reconcile, while the download runs. */
  reconcile(): void
  /** Runs every TICK_MS while the download does. */
  tick(now: number): void
  /** Its connections' work, each settling once that connection stops: the run waits on them. */
  running(): Iterable<Promise<void>>
  /** Stops every connection: a pause, a cancel, a failed download. */
  abort(): void
  /** Forgets what only steers the current run. Done on a pause, a resume and as a run starts. */
  reset(): void
  /** Gets connections going again now, rather than when their backoff runs out: what held them
   * back has changed. The ones `reconnect` picks also drop their sockets. */
  wake(pick: (networkId: string) => boolean, reconnect: (networkId: string) => boolean): void
  /** The computer woke from sleep: every judgement made by the clock starts over. */
  systemResumed(now: number): void
}

/** The parts of a download a transfer works on. The manager owns them; this is the same object. */
export interface TransferTarget {
  state: DownloadState
  requestPayload: StartDownloadRequest
  blocks: BlockState[]
  file: DownloadFile
  /** Aborted once the current run is over — stopped (a pause, a cancel, an error) or every
   * block in — so nothing starts streams for it and no stream waits on. */
  stop: AbortController
  speedSamplesByChunk: Map<number, SpeedSample[]>
}

/** What a transfer asks of the manager. */
export interface TransferHost {
  networks: NetworkMonitor
  /** The manager's reconcile: networks first, then the transfer's own. */
  reconcile(): void
  failDownload(message: string, discard?: boolean): void
  failNetwork(network: DownloadNetwork, message: string): void
  scheduleUpdate(): void
}

export interface SpeedSample {
  bytes: number
  time: number
}

// Raw per-event deltas are too noisy to display (socket buffers flush in
// irregular bursts a few ms apart). Averaging over a few seconds instead
// gives a speed/ETA reading that tracks reality without jumping around.
const SPEED_WINDOW_MS = 3000

// Appends a sample and returns the average byte rate over SPEED_WINDOW_MS.
export function pushSpeedSample(samples: SpeedSample[], bytes: number, time: number): number {
  if (samples.length > 0 && time - samples[samples.length - 1].time > SPEED_WINDOW_MS) {
    samples.length = 0
  }
  samples.push({ bytes, time })

  return calculateCurrentSpeed(samples, time)
}

export function calculateCurrentSpeed(samples: SpeedSample[] | undefined, time: number): number {
  if (!samples || samples.length === 0) return 0

  const latest = samples[samples.length - 1]
  if (time - latest.time > SPEED_WINDOW_MS) {
    return 0
  }

  const cutoff = time - SPEED_WINDOW_MS
  while (samples.length > 2 && samples[1].time <= cutoff) {
    samples.shift()
  }

  // At least a second: a fresh window can hold two samples ms apart, and one socket burst over a
  // few ms reads as a speed the connection never had (and sticks as the UI's peak).
  const oldest = samples[0]
  const deltaSeconds = Math.max((time - oldest.time) / 1000, 1)
  return (latest.bytes - oldest.bytes) / deltaSeconds
}

/** Brings every stream's speed up to date, and each network's and the download's with them. */
export function updateSpeeds(runtime: TransferTarget, now = Date.now()): void {
  let total = 0
  const byNetwork = new Map<string, number>()
  for (const chunk of runtime.state.chunks) {
    if (chunk.status === 'downloading') {
      const samples = runtime.speedSamplesByChunk.get(chunk.id)
      chunk.speedBytesPerSec = calculateCurrentSpeed(samples, now)
    }
    total += chunk.speedBytesPerSec
    byNetwork.set(
      chunk.interfaceId,
      (byNetwork.get(chunk.interfaceId) ?? 0) + chunk.speedBytesPerSec
    )
  }
  for (const network of runtime.state.networks) {
    network.speedBytesPerSec = byNetwork.get(network.id) ?? 0
  }
  runtime.state.speedBytesPerSec = total
}

/** Nothing is moving: a paused or stopped download reads 0 everywhere. */
export function clearSpeeds(state: DownloadState): void {
  state.speedBytesPerSec = 0
  for (const chunk of state.chunks) chunk.speedBytesPerSec = 0
  for (const network of state.networks) network.speedBytesPerSec = 0
}

/** Waits, but returns early if the signal aborts (pause/cancel shouldn't wait out a retry backoff). */
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Re-derives the byte counts from the blocks: the download's, and each network's. */
export function recomputeAggregates(runtime: TransferTarget): void {
  let total = 0
  const byNetwork = new Map<string, number>()
  for (const block of runtime.blocks) {
    total += block.bytesDownloaded
    for (const [id, bytes] of Object.entries(block.bytesByInterface)) {
      byNetwork.set(id, (byNetwork.get(id) ?? 0) + bytes)
    }
  }
  runtime.state.bytesDownloaded = total
  for (const network of runtime.state.networks) {
    network.bytesDownloaded = byNetwork.get(network.id) ?? 0
  }
  updateSpeeds(runtime)
}
