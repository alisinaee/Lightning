import type { DownloadState, FinishedDownload } from '@shared/types'
import { linkExpired } from './format'

export type Item = DownloadState | FinishedDownload

/** One vocabulary for how a download is doing, used by the list and by each download's screen. */
export type StatusKey = 'downloading' | 'queued' | 'paused' | 'completed' | 'failed' | 'attention'

export const isFinished = (item: Item): item is FinishedDownload => 'unitsWritten' in item

export function statusKeyOf(item: Item): StatusKey {
  if (isFinished(item)) return 'completed'
  switch (item.status) {
    case 'completed':
      return 'completed'
    case 'downloading':
      return 'downloading'
    case 'queued':
      return 'queued'
    case 'error':
      return linkExpired(item) ? 'attention' : 'failed'
    default:
      return 'paused'
  }
}

/** Sort order of statuses: what is moving first, then what waits, then what is done. */
export const STATUS_ORDER: Record<StatusKey, number> = {
  downloading: 0,
  queued: 1,
  paused: 2,
  attention: 3,
  failed: 4,
  completed: 5
}
