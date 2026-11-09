import { t } from '@shared/i18n/react'
import type { DownloadState, FinishedDownload } from '@shared/types'
import {
  ArrowLineDown as ArrowDownToLine,
  WarningCircle as CircleAlert,
  CheckCircle as CircleCheck,
  Clock,
  Pause,
  Warning as TriangleAlert,
  type Icon
} from '@phosphor-icons/react'
import { describeError, linkExpired, wantedBytes, formatPercent } from './format'

export type Item = DownloadState | FinishedDownload

/** One vocabulary for how a download is doing, used by the list and by each download's screen. */
export type StatusKey = 'downloading' | 'queued' | 'paused' | 'completed' | 'failed' | 'attention'

export const STATUS_STYLE: Record<StatusKey, { label: string; icon: Icon; color: string }> = {
  // Labels are getters so they are read in the current language each time.
  downloading: {
    get label() {
      return t('Downloading')
    },
    icon: ArrowDownToLine,
    color: 'var(--status-downloading)'
  },
  queued: {
    get label() {
      return t('Queued')
    },
    icon: Clock,
    color: 'var(--status-queued)'
  },
  paused: {
    get label() {
      return t('Paused')
    },
    icon: Pause,
    color: 'var(--status-paused)'
  },
  completed: {
    get label() {
      return t('Completed')
    },
    icon: CircleCheck,
    color: 'var(--status-done)'
  },
  failed: {
    get label() {
      return t('Failed')
    },
    icon: CircleAlert,
    color: 'var(--status-failed)'
  },
  attention: {
    get label() {
      return t('Needs attention')
    },
    icon: TriangleAlert,
    color: 'var(--status-attention)'
  }
}

/** A style for any key, even one this version doesn't know: never undefined. */
export const statusStyle = (key: string): (typeof STATUS_STYLE)[StatusKey] =>
  STATUS_STYLE[key as StatusKey] ?? STATUS_STYLE.attention

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
  /** For a failure Lightning will try again by itself: when. */
  retryAt?: number
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
    return {
      ...base,
      label: base.missing ? t('File missing') : statusStyle('completed').label,
      bar: false,
      speed: 0,
      etaSeconds: null
    }
  }
  const speed = item.status === 'downloading' ? item.speedBytesPerSec : 0
  // Main's own, smoothed estimate (see updateTimeLeft).
  const etaSeconds = speed > 0 ? (item.timeLeftSeconds ?? null) : null
  switch (status) {
    case 'downloading':
      return {
        ...base,
        label: total > 0 ? t('Downloading {percent}%', { percent }) : t('Downloading'),
        bar: true,
        speed,
        etaSeconds
      }
    case 'queued':
      return {
        ...base,
        label: queuePosition ? t('Queued #{position}', { position: queuePosition }) : t('Queued'),
        bar: item.bytesDownloaded > 0,
        speed: 0,
        etaSeconds: null
      }
    case 'paused':
      return {
        ...base,
        label:
          total > 0 && item.bytesDownloaded > 0 ? t('Paused {percent}%', { percent }) : t('Paused'),
        bar: item.bytesDownloaded > 0,
        speed: 0,
        etaSeconds: null
      }
    case 'completed':
      return {
        ...base,
        label: statusStyle('completed').label,
        bar: false,
        speed: 0,
        etaSeconds: null
      }
    default: {
      const full = describeError(item.error ?? t('Something went wrong'))
      // What it has downloaded is kept for a retry: say so, with how much.
      const kept =
        item.bytesDownloaded > 0 && item.resumable !== false && total > 0
          ? t('{percent}% kept', { percent })
          : ''
      return {
        ...base,
        label: statusStyle(status).label,
        retryAt: item.retryAt,
        reason: [kept, shortReason(full)].filter(Boolean).join(' · '),
        reasonFull: full,
        bar: item.bytesDownloaded > 0,
        speed: 0,
        etaSeconds: null
      }
    }
  }
}
