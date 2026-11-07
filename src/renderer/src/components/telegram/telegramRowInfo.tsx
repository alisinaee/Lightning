import type { TdlItem, TdlJob, TgMediaKind } from '@shared/telegram'
import {
  ListDashes as ListX,
  Pause,
  Play,
  ArrowClockwise as RotateCw,
  Trash as Trash2,
  X
} from '@phosphor-icons/react'
import { createContext, useContext } from 'react'
import { useTelegramStore } from '../../store/useTelegramStore'
import type { RowAction } from '../downloads/rowMenu'
import { formatPercent } from '../../utils/format'
import type { FileKind } from '../../utils/fileKind'
import type { RowInfo } from '../../utils/status'

/** The media groups in the order the side panel lists them. */
export const MEDIA_KINDS: { kind: TgMediaKind; label: string; fileKind: FileKind }[] = [
  { kind: 'video', label: 'Videos', fileKind: 'video' },
  { kind: 'photo', label: 'Photos', fileKind: 'image' },
  { kind: 'audio', label: 'Audio', fileKind: 'audio' },
  { kind: 'document', label: 'Documents', fileKind: 'document' },
  { kind: 'other', label: 'Other', fileKind: 'other' }
]

export const fileKindOfMedia = (media: TgMediaKind): FileKind =>
  MEDIA_KINDS.find((entry) => entry.kind === media)?.fileKind ?? 'other'

/** Which columns the list has room for. The name and the status always stay. */
export interface TelegramColumns {
  eta: boolean
  added: boolean
  template: string
}

const FIXED = '44px minmax(180px,1fr) 124px 112px 96px'
export function columnsFor(width: number): TelegramColumns {
  const eta = width >= 700
  const added = width >= 820
  return {
    eta,
    added,
    template: `${FIXED}${eta ? ' 92px' : ''}${added ? ' 112px' : ''} 112px`
  }
}

export const columnsContext = createContext<TelegramColumns>(columnsFor(1000))
export const useTelegramColumns = (): TelegramColumns => useContext(columnsContext)

const clip = (text: string): string => (text.length > 70 ? `${text.slice(0, 67)}…` : text)

/** The row of one file: its own state, read in the light of the job around it. */
export function itemInfo(job: TdlJob, item: TdlItem): RowInfo {
  const addedAt = job.createdAt
  const base = {
    percent: item.total > 0 ? formatPercent(item.received, item.total) : 0,
    received: item.received,
    total: item.total,
    addedAt,
    completedAt: job.finishedAt,
    missing: false
  }
  if (item.status === 'done' || item.status === 'skipped') {
    return {
      ...base,
      status: 'completed',
      label: item.status === 'skipped' ? 'Already there' : 'Completed',
      percent: 100,
      received: item.total || item.received,
      bar: false,
      speed: 0,
      etaSeconds: null
    }
  }
  if (item.status === 'failed') {
    const reason = item.error || job.error || 'The download failed'
    return {
      ...base,
      status: 'failed',
      label: 'Failed',
      reason: clip(reason),
      reasonFull: reason,
      bar: false,
      speed: 0,
      etaSeconds: null
    }
  }
  if (job.status === 'error' || job.status === 'cancelled') {
    const reason = job.status === 'error' ? job.error || 'The download failed' : ''
    return {
      ...base,
      status: job.status === 'error' ? 'failed' : 'paused',
      label: job.status === 'error' ? 'Failed' : 'Cancelled',
      reason: reason ? clip(reason) : undefined,
      reasonFull: reason || undefined,
      bar: false,
      speed: 0,
      etaSeconds: null
    }
  }
  if (job.status === 'paused') {
    return {
      ...base,
      status: 'paused',
      label: base.percent > 0 ? `Paused ${base.percent}%` : 'Paused',
      bar: item.received > 0,
      speed: 0,
      etaSeconds: null
    }
  }
  if (item.status === 'downloading' && job.status === 'running') {
    const left = Math.max(0, item.total - item.received)
    return {
      ...base,
      status: 'downloading',
      label: item.total > 0 ? `Downloading ${base.percent}%` : 'Downloading',
      bar: true,
      speed: item.speed,
      etaSeconds: item.speed > 0 && item.total > 0 ? Math.ceil(left / item.speed) : null
    }
  }
  return {
    ...base,
    status: 'queued',
    label: job.status === 'exporting' ? 'Reading the chat' : 'Queued',
    bar: item.received > 0,
    speed: 0,
    etaSeconds: null
  }
}

/** A job as one row: the sum of its files. */
export function jobInfo(job: TdlJob, items: TdlItem[] = job.items): RowInfo {
  let received = 0
  let total = 0
  let speed = 0
  let done = 0
  let failed = 0
  for (const item of items) {
    const finished = item.status === 'done' || item.status === 'skipped'
    received += finished ? item.total || item.received : item.received
    total += item.total
    speed += item.status === 'downloading' ? item.speed : 0
    if (finished) done++
    if (item.status === 'failed') failed++
  }
  const percent = total > 0 ? formatPercent(received, total) : 0
  const base = {
    percent,
    received,
    total,
    addedAt: job.createdAt,
    completedAt: job.finishedAt,
    missing: false
  }
  const counts = `${done}/${items.length}`
  const left = Math.max(0, total - received)
  switch (job.status) {
    case 'completed':
      return {
        ...base,
        status: failed > 0 ? 'attention' : 'completed',
        label: failed > 0 ? `${failed} failed` : 'Completed',
        percent: failed > 0 ? percent : 100,
        bar: false,
        speed: 0,
        etaSeconds: null
      }
    case 'error':
      return {
        ...base,
        status: 'failed',
        label: 'Failed',
        reason: job.error ? clip(job.error) : undefined,
        reasonFull: job.error,
        bar: false,
        speed: 0,
        etaSeconds: null
      }
    case 'cancelled':
      return {
        ...base,
        status: 'paused',
        label: 'Cancelled',
        bar: false,
        speed: 0,
        etaSeconds: null
      }
    case 'paused':
      return {
        ...base,
        status: 'paused',
        label: `Paused ${counts}`,
        bar: received > 0,
        speed: 0,
        etaSeconds: null
      }
    case 'running':
      return {
        ...base,
        status: 'downloading',
        label: total > 0 ? `Downloading ${percent}%` : `Downloading ${counts}`,
        bar: true,
        speed,
        etaSeconds: speed > 0 && total > 0 ? Math.ceil(left / speed) : null
      }
    case 'exporting':
      return {
        ...base,
        status: 'queued',
        label: 'Reading the chat',
        bar: false,
        speed: 0,
        etaSeconds: null
      }
    default:
      return { ...base, status: 'queued', label: 'Queued', bar: false, speed: 0, etaSeconds: null }
  }
}

/** A name for a job: the chat it came from, or how many messages were pasted. */
export function jobTitle(job: TdlJob): string {
  if (job.source.type === 'export') {
    const { chat, range } = job.source
    return range ? `${chat} · ${range}` : chat
  }
  const count = job.source.links.length
  return `${count} Telegram ${count === 1 ? 'message' : 'messages'}`
}

const platformTrash = window.lightning.platform === 'win32' ? 'Recycle Bin' : 'Trash'

/** What can be done to a job as a whole: the same menu on a group's header and on a one-file row. */
export function jobActions(job: TdlJob): RowAction[] {
  const id = job.id
  const live = job.status === 'running' || job.status === 'queued' || job.status === 'exporting'
  const failed = job.status === 'error' || job.items.some((item) => item.status === 'failed')
  const hasFiles = job.items.some((item) => item.status === 'done' && item.path)
  const run = (task: Promise<unknown>): void => {
    void task.catch(() => {})
  }
  const actions: RowAction[] = []
  if (live) {
    actions.push({
      id: 'pause',
      label: 'Pause',
      icon: Pause,
      run: () => run(window.lightning.tdlPauseJob(id))
    })
  }
  if (job.status === 'paused') {
    actions.push({
      id: 'resume',
      label: 'Resume',
      icon: Play,
      run: () => run(window.lightning.tdlResumeJob(id))
    })
  }
  if (failed && !live && job.status !== 'paused') {
    actions.push({
      id: 'retry',
      label: 'Retry failed',
      icon: RotateCw,
      run: () => run(window.lightning.tdlRetryJob(id))
    })
  }
  if (live || job.status === 'paused') {
    actions.push({
      id: 'cancel',
      label: 'Cancel',
      icon: X,
      danger: true,
      run: () => run(window.lightning.tdlCancelJob(id))
    })
  }
  actions.push({
    id: 'remove',
    label: 'Remove from list',
    icon: ListX,
    divider: actions.length > 0,
    run: () =>
      run(
        window.lightning.tdlRemoveJob(id).then(() => useTelegramStore.getState().removeJobLocal(id))
      )
  })
  if (hasFiles) {
    actions.push({
      id: 'trash',
      label: `Move files to ${platformTrash}`,
      icon: Trash2,
      danger: true,
      run: () => {
        if (!window.confirm(`Move this job's downloaded files to the ${platformTrash}?`)) return
        run(
          window.lightning
            .tdlRemoveJob(id, { trashFiles: true })
            .then(() => useTelegramStore.getState().removeJobLocal(id))
        )
      }
    })
  }
  return actions
}
