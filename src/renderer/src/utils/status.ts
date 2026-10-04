import type { DownloadState, FinishedDownload } from '@shared/types'
import {
  ArrowDownToLine,
  CircleAlert,
  CircleCheck,
  Clock,
  Pause,
  TriangleAlert,
  type LucideIcon
} from 'lucide-react'
import { describeError, linkExpired, wantedBytes, formatPercent } from './format'

export type Item = DownloadState | FinishedDownload

/** One vocabulary for how a download is doing, used by the list and by each download's screen. */
export type StatusKey = 'downloading' | 'queued' | 'paused' | 'completed' | 'failed' | 'attention'

export const STATUS_STYLE: Record<StatusKey, { label: string; icon: LucideIcon; color: string }> = {
  downloading: { label: 'Downloading', icon: ArrowDownToLine, color: 'var(--status-downloading)' },
  queued: { label: 'Queued', icon: Clock, color: 'var(--status-queued)' },
  paused: { label: 'Paused', icon: Pause, color: 'var(--status-paused)' },
  completed: { label: 'Completed', icon: CircleCheck, color: 'var(--status-done)' },
  failed: { label: 'Failed', icon: CircleAlert, color: 'var(--status-failed)' },
  attention: { label: 'Needs attention', icon: TriangleAlert, color: 'var(--status-attention)' }
}

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

export interface RowInfo {
  status: StatusKey
  /** The word beside the icon: "Downloading 42%", "Queued #3", "Paused", "Completed". */
  label: string
  /** For a failure: the short reason, and the whole of it for a tooltip. */
  reason?: string
  reasonFull?: string
  percent: number
  /** Whether the slim progress bar shows. */
  bar: boolean
  /** Bytes so far and in all, for the size column. */
  received: number
  total: number
  speed: number
  /** Seconds left; null when unknown. */
  etaSeconds: number | null
  addedAt: number
  completedAt?: number
  missing: boolean
}

/** First sentence of an error, trimmed for a cell; the full text goes in a tooltip. */
function shortReason(text: string): string {
  const first = text.split(/(?<=[.!?])\s/)[0]
  return first.length > 70 ? `${first.slice(0, 67)}…` : first
}

/** Everything a row of the list shows about a download, worked out once from its state. */
export function describeItem(item: Item, queuePosition?: number): RowInfo {
  const total = wantedBytes(item)
  const status = statusKeyOf(item)
  const finished = status === 'completed'
  const received = finished ? total || item.bytesDownloaded : item.bytesDownloaded
  const percent = finished ? 100 : formatPercent(item.bytesDownloaded, total)
  const base = {
    status,
    percent,
    received,
    total,
    addedAt: item.startedAt,
    completedAt: item.completedAt,
    missing: isFinished(item) && item.missing === true
  }
  if (isFinished(item)) {
    return { ...base, label: STATUS_STYLE.completed.label, bar: false, speed: 0, etaSeconds: null }
  }
  const speed = item.status === 'downloading' ? item.speedBytesPerSec : 0
  // Main's own, smoothed estimate (see updateTimeLeft).
  const etaSeconds = speed > 0 ? (item.timeLeftSeconds ?? null) : null
  switch (status) {
    case 'downloading':
      return {
        ...base,
        label: total > 0 ? `Downloading ${percent}%` : 'Downloading',
        bar: true,
        speed,
        etaSeconds
      }
    case 'queued':
      return {
        ...base,
        label: queuePosition ? `Queued #${queuePosition}` : 'Queued',
        bar: item.bytesDownloaded > 0,
        speed: 0,
        etaSeconds: null
      }
    case 'paused':
      return {
        ...base,
        label: total > 0 && item.bytesDownloaded > 0 ? `Paused ${percent}%` : 'Paused',
        bar: item.bytesDownloaded > 0,
        speed: 0,
        etaSeconds: null
      }
    case 'completed':
      return {
        ...base,
        label: STATUS_STYLE.completed.label,
        bar: false,
        speed: 0,
        etaSeconds: null
      }
    default: {
      const full = describeError(item.error ?? 'Something went wrong')
      return {
        ...base,
        label: STATUS_STYLE[status].label,
        reason: shortReason(full),
        reasonFull: full,
        bar: item.bytesDownloaded > 0,
        speed: 0,
        etaSeconds: null
      }
    }
  }
}
