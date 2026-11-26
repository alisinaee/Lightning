import type { HttpStreamState, StartHttpDownloadRequest } from '../../shared/types'
import { testKnobs, testStreamsPerNetwork } from '../testKnobs'
import type { StreamConnection } from '../network/routes'
import { fetchRange } from './chunkDownloader'
import { ConcurrencyController } from './concurrency'
import type { FileVersion } from './fileVersion'
import { MAX_STREAMS_PER_NETWORK } from './plan'
import type { HttpTransferTarget, TransferHost } from './transfer'

const RETRY_BASE_DELAY_MS = testKnobs.retryBaseDelayMs
const RETRY_MAX_DELAY_MS = 15_000

// How much of the already-downloaded file to re-fetch and compare when a server labels a
// response with an ETag or Last-Modified this download hasn't seen before.
export const SAMPLE_BYTES = 16 * 1024
export const MAX_SAMPLES = 8
/** A sample must come from a server presenting the new label; behind a load balancer the next
 * request may land on another one, so take a few tries at reaching it. */
export const SAMPLE_TRIES = 4

/** What `answer` settles to, or false if `signal` aborts first (or `answer` fails). */
export function unlessAborted(answer: Promise<boolean>, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const onAbort = (): void => resolve(false)
    signal.addEventListener('abort', onAbort, { once: true })
    answer
      .then(resolve, () => resolve(false))
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/** Doubling from RETRY_BASE_DELAY_MS, with ±20% jitter as gRPC's backoff has: a network that
 * drops fails all its streams at once, and they shouldn't all come back at the same instant. */
export function retryDelayMs(attempt: number): number {
  const exact = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS)
  return exact * (0.8 + 0.4 * Math.random())
}

/**
 * Whether `url` serves the bytes already on disk: a spread of blocks that have data is fetched
 * from it and compared. 'different' on the first mismatch; 'unknown' when nothing could be
 * compared (nothing on disk, or the samples couldn't be fetched).
 */
export async function compareSamples(
  target: Pick<HttpTransferTarget, 'blocks' | 'file'>,
  url: string,
  headers: Record<string, string>,
  connection: StreamConnection
): Promise<'same' | 'different' | 'unknown'> {
  const withData = target.blocks.filter((block) => block.bytesDownloaded > 0)
  const step = Math.max(1, withData.length / MAX_SAMPLES)
  const picks = Array.from(
    { length: Math.min(MAX_SAMPLES, withData.length) },
    (_, i) => withData[Math.floor(i * step)]
  )

  let compared = 0
  for (const block of picks) {
    let local: Buffer
    try {
      local = await target.file.read(
        block.rangeStart,
        Math.min(SAMPLE_BYTES, block.bytesDownloaded)
      )
    } catch {
      continue
    }
    if (local.length === 0) continue

    for (let tries = 0; tries < SAMPLE_TRIES; tries++) {
      try {
        const remote = await fetchRange(
          url,
          block.rangeStart,
          block.rangeStart + local.length - 1,
          connection,
          headers
        )
        if (!remote.body.equals(local)) return 'different'
        compared += 1
        break
      } catch {
        return 'unknown'
      }
    }
  }
  return compared > 0 ? 'same' : 'unknown'
}

/** Whether the file can be fetched in parts. Otherwise one request has to carry all of it: one
 * stream, on one network. */
export function splittable(request: StartHttpDownloadRequest): boolean {
  return request.supportsRanges && request.totalBytes > 0
}

/** How many streams a download runs is only for it to work out when there can be more than one,
 * and unless a test fixes it. */
export function concurrencyFor(
  request: StartHttpDownloadRequest,
  host: TransferHost
): ConcurrencyController | null {
  if (!splittable(request) || testStreamsPerNetwork() !== null) return null
  const picked = pickedStreams(request)
  return picked === undefined
    ? new ConcurrencyController(MAX_STREAMS_PER_NETWORK, true, (networkId) =>
        Math.floor(MAX_STREAMS_PER_NETWORK / Math.max(1, host.downloadsOn(networkId)))
      )
    : new ConcurrencyController(picked, false)
}

/** The streams per network the user picked for this download, if they didn't leave it on Auto. */
export function pickedStreams(request: StartHttpDownloadRequest): number | undefined {
  const picked = request.streamsPerNetwork
  return Number.isInteger(picked) && picked! >= 1 && picked! <= MAX_STREAMS_PER_NETWORK
    ? picked
    : undefined
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function newStream(id: number, networkId: string): HttpStreamState {
  return {
    id,
    interfaceId: networkId,
    rangeStart: 0,
    rangeEnd: null,
    bytesDownloaded: 0,
    speedBytesPerSec: 0,
    status: 'pending'
  }
}

export function requestedVersion(request: StartHttpDownloadRequest): FileVersion {
  return { etag: request.etag, lastModified: request.lastModified, totalBytes: request.totalBytes }
}
