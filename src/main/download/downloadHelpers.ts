import { statfs } from 'node:fs/promises'
import { buildHeaders, headersForRedirect } from '../../shared/requestHeaders'
import type {
  DownloadState,
  DownloadUnitState,
  HttpDownloadNetwork,
  NetworkInterfaceInfo,
  StartHttpDownloadRequest,
  TorrentDownloadNetwork,
  TorrentDownloadState,
  TorrentInfo,
  TorrentPieceState
} from '../../shared/types'
import { wantedPieces } from './torrent/files'

const SPEED_HISTORY_LENGTH = 60
// The peak is the best speed held this many samples (seconds): longer than a start's burst (an
// ISP's burst allowance, every connection ramping up at once), which isn't the line's speed.
const PEAK_SAMPLES = 5

/** Adds each network's speed to the download's history, and 0 for one no longer listed. A
 * network seen for the first time starts at 0 too, so every series is as long as the others and
 * lines up with them. Then raises the peak, once the last PEAK_SAMPLES are in. */
export function sampleSpeeds(state: DownloadState): void {
  const history = (state.speedHistory ??= {})
  const seriesList = Object.values(history)
  const length = seriesList[0]?.length ?? 0
  const speedByNetwork = new Map<string, number>()
  for (const network of state.networks) {
    speedByNetwork.set(network.id, network.speedBytesPerSec)
    if (!history[network.id]) {
      const created = new Array<number>(length).fill(0)
      history[network.id] = created
      seriesList.push(created)
    }
  }
  if (seriesList.length === 0) return
  for (const [id, series] of Object.entries(history)) {
    series.push(speedByNetwork.get(id) ?? 0)
    if (series.length > SPEED_HISTORY_LENGTH) series.shift()
  }
  const currentLength = seriesList[0].length
  if (currentLength < PEAK_SAMPLES) return
  let held = 0
  const start = currentLength - PEAK_SAMPLES
  for (const values of seriesList) {
    for (let i = start; i < currentLength; i++) held += values[i]
  }
  state.peakSpeedBytesPerSec = Math.max(state.peakSpeedBytesPerSec ?? 0, held / PEAK_SAMPLES)
}

export function newHttpNetwork(iface: NetworkInterfaceInfo, enabled: boolean): HttpDownloadNetwork {
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

export function newTorrentNetwork(
  iface: NetworkInterfaceInfo,
  enabled: boolean
): TorrentDownloadNetwork {
  return {
    ...newHttpNetwork(iface, enabled),
    transfer: 'torrent',
    bytesUploaded: 0,
    uploadSpeedBytesPerSec: 0
  }
}

/** A block that needs nothing more: in, or skipped (see BlockStatus). */
export const isDone = (unit: DownloadUnitState): boolean =>
  unit.status === 'completed' || unit.status === 'skipped'

export const unitsOf = (
  runtime:
    { kind: 'http'; blocks: DownloadUnitState[] } | { kind: 'torrent'; pieces: DownloadUnitState[] }
): DownloadUnitState[] => (runtime.kind === 'http' ? runtime.blocks : runtime.pieces)

/** A torrent download's files as its state shows them, given those `chosen` (null: every one). */
export function choiceOf(chosen: Set<number> | null, total: number): TorrentDownloadState['files'] {
  const selected = chosen ? [...chosen].sort((a, b) => a - b) : undefined
  return { chosen: selected?.length ?? total, total, selected }
}

/** Sets each piece of `torrent` by whether a `chosen` file (null: every one) needs it: skipped
 * when none does, waiting again when one does. A piece that's in stays in, needed or not. The
 * skipped pieces' bytes, all together. As a download starts, comes back, or its choice changes. */
export function choosePieces(
  pieces: TorrentPieceState[],
  torrent: TorrentInfo,
  chosen: Set<number> | null
): number {
  const wanted = chosen && wantedPieces(torrent.files, torrent.pieceLength, chosen)
  let skipped = 0
  for (const piece of pieces) {
    if (piece.status === 'completed' || piece.rangeEnd === null) continue
    if (!wanted || wanted[piece.index]) {
      if (piece.status === 'skipped') piece.status = 'pending'
      continue
    }
    piece.status = 'skipped'
    piece.provisionalBytes = 0
    skipped += piece.rangeEnd - piece.rangeStart + 1
  }
  return skipped
}

/** The files not `chosen`, as the torrent names them. */
export function unchosenPaths(torrent: TorrentInfo, chosen: Set<number> | null): string[] {
  return chosen
    ? torrent.files.filter((_, index) => !chosen.has(index)).map((file) => file.path)
    : []
}

export function formatGigabytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/** `value` when it's a web link, the only kind a download's link is refreshed from. */
export function webLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    return /^https?:$/.test(new URL(value).protocol) ? value : undefined
  } catch {
    return undefined
  }
}

/** The headers for a request to `url` on the way to `asked`: sign-in details and cookies go only
 * to the host the link was asked of. */
export function headersForLink(
  payload: StartHttpDownloadRequest,
  asked: string,
  url: string
): Record<string, string> {
  return headersForRedirect(buildHeaders(payload, {}, asked), asked, url)
}

/** The staging file is on the destination volume and becomes the final file by rename. */
export async function ensureDiskSpace(
  destinationDir: string,
  requiredBytes: number
): Promise<void> {
  if (requiredBytes <= 0) return // unknown size — nothing to check against
  const stats = await statfs(destinationDir)
  const availableBytes = stats.bavail * stats.bsize
  if (availableBytes < requiredBytes) {
    throw new Error(
      `Not enough disk space: this download needs ${formatGigabytes(requiredBytes)} but only ${formatGigabytes(availableBytes)} is free`
    )
  }
}
