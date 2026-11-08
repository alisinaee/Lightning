import type { DownloadState } from '../shared/types'
import type { TdlJob } from '../shared/telegram'
import type { YoutubeJob } from '../shared/youtube'

/** What YouTube and Telegram are downloading, in the shape the menu-bar icon and its panel read
 * (they are not run by the download manager, so it does not know them). Only the live ones are
 * kept: a finished, failed or cancelled job drops out. */
const live = new Map<string, DownloadState>()

type Status = DownloadState['status']

function put(id: string, state: Omit<DownloadState, 'kind'> | null): void {
  if (state)
    live.set(id, { ...state, kind: 'http', streams: [], blocks: [] } as unknown as DownloadState)
  else live.delete(id)
}

const youtubeStatus = (status: YoutubeJob['status']): Status | null =>
  status === 'downloading' || status === 'queued' || status === 'paused' ? status : null

export function reportYoutube(job: YoutubeJob): void {
  const status = youtubeStatus(job.status)
  const id = `yt:${job.id}`
  if (!status) return put(id, null)
  put(id, {
    id,
    url: job.url,
    fileName: job.title || job.fileName || job.url,
    destinationPath: job.destDir,
    totalBytes: job.total,
    bytesDownloaded: job.received,
    speedBytesPerSec: status === 'downloading' ? job.speed : 0,
    timeLeftSeconds: job.eta,
    status,
    startedAt: job.createdAt,
    networks: []
  } as unknown as DownloadState)
}

export function reportTelegram(job: TdlJob): void {
  const id = `tg:${job.id}`
  const running = job.status === 'running' || job.status === 'exporting'
  const status: Status | null = running
    ? 'downloading'
    : job.status === 'queued'
      ? 'queued'
      : job.status === 'paused'
        ? 'paused'
        : null
  if (!status) return put(id, null)
  const moving = job.items.filter((item) => item.status === 'downloading')
  const speed = moving.reduce((sum, item) => sum + item.speed, 0)
  const total = job.items.reduce((sum, item) => sum + item.total, 0)
  const received = job.items.reduce(
    (sum, item) => sum + (item.status === 'done' ? item.total : item.received),
    0
  )
  put(id, {
    id,
    url: '',
    fileName: moving[0]?.fileName ?? job.items[0]?.fileName ?? 'Telegram',
    destinationPath: job.dir,
    totalBytes: total,
    bytesDownloaded: received,
    speedBytesPerSec: speed,
    timeLeftSeconds: speed > 0 && total > received ? (total - received) / speed : undefined,
    status,
    startedAt: job.createdAt,
    networks: []
  } as unknown as DownloadState)
}

/** The live YouTube and Telegram downloads, to add to the manager's for the tray. */
export function externalStates(): DownloadState[] {
  return [...live.values()]
}
