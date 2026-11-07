import { createContext, useContext } from 'react'
import { ACTIONS_WIDTH, SELECT_WIDTH } from '../downloads/columns'
import type { YoutubeJob } from '@shared/youtube'
import type { RowInfo, StatusKey } from '../../utils/status'

/** The list's columns, the same order and rhythm as the Downloads list: name, status, size, speed, time left, added, actions. */
/** The Downloads list's grid: a select column, the name, then size, status, speed, time left,
 * added, and the actions column. The same widths, so the two lists line up. */
export const YOUTUBE_COLUMNS = `${SELECT_WIDTH}px minmax(220px,1fr) 124px 112px 96px 92px 112px ${ACTIONS_WIDTH}px`

const STATUS_KEY: Record<YoutubeJob['status'], StatusKey> = {
  queued: 'queued',
  downloading: 'downloading',
  paused: 'paused',
  completed: 'completed',
  error: 'failed',
  cancelled: 'paused'
}

const LABEL: Record<YoutubeJob['status'], string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  paused: 'Paused',
  completed: 'Completed',
  error: 'Failed',
  cancelled: 'Cancelled'
}

/** Turns a YouTube job into the same row description the Downloads list uses, so the status,
 * progress line and numbers look and behave the same. */
export function describeYoutubeJob(job: YoutubeJob): RowInfo {
  const finished = job.status === 'completed'
  const downloading = job.status === 'downloading'
  const percent = finished ? 100 : job.percent
  const firstLine = job.error?.split('\n')[0]
  return {
    status: STATUS_KEY[job.status],
    label: downloading ? `Downloading ${Math.round(percent)}%` : LABEL[job.status],
    reason: job.status === 'error' ? firstLine : undefined,
    reasonFull: job.status === 'error' ? job.error : undefined,
    percent,
    bar: downloading || job.status === 'paused',
    received: finished ? job.total || job.received : job.received,
    total: job.total,
    speed: downloading ? job.speed : 0,
    etaSeconds: downloading && job.eta !== undefined ? job.eta : null,
    addedAt: job.createdAt,
    completedAt: job.finishedAt,
    missing: false
  }
}

/** One row for a whole playlist: its videos' progress and sizes added up, and what the group is doing. */
export function describeYoutubeGroup(jobs: YoutubeJob[]): RowInfo {
  const done = jobs.filter((job) => job.status === 'completed').length
  const downloading = jobs.some((job) => job.status === 'downloading')
  const queued = jobs.some((job) => job.status === 'queued')
  const paused = jobs.some((job) => job.status === 'paused')
  const failed = jobs.some((job) => job.status === 'error')
  const allDone = done === jobs.length
  const status: StatusKey = allDone
    ? 'completed'
    : downloading
      ? 'downloading'
      : queued
        ? 'queued'
        : paused
          ? 'paused'
          : failed
            ? 'failed'
            : 'paused'
  const percent =
    jobs.reduce((sum, job) => sum + (job.status === 'completed' ? 100 : job.percent), 0) /
    jobs.length
  const speed = jobs.reduce((sum, job) => sum + (job.status === 'downloading' ? job.speed : 0), 0)
  return {
    status,
    label: allDone ? 'Completed' : `${done} of ${jobs.length} done`,
    percent,
    bar: !allDone,
    received: jobs.reduce(
      (sum, job) => sum + (job.status === 'completed' ? job.total || job.received : job.received),
      0
    ),
    total: jobs.reduce((sum, job) => sum + job.total, 0),
    speed,
    etaSeconds: null,
    addedAt: Math.min(...jobs.map((job) => job.createdAt)),
    completedAt: allDone ? Math.max(...jobs.map((job) => job.finishedAt ?? 0)) : undefined,
    missing: false
  }
}

export interface YoutubeColumns {
  /** The time-left and added columns drop out of a narrow window, the way they do on Downloads. */
  eta: boolean
  added: boolean
  template: string
}

export function youtubeColumnsFor(width: number): YoutubeColumns {
  const eta = width >= 820
  const added = width >= 940
  return {
    eta,
    added,
    template: `${SELECT_WIDTH}px minmax(220px,1fr) 124px 112px 96px${eta ? ' 92px' : ''}${added ? ' 112px' : ''} ${ACTIONS_WIDTH}px`
  }
}

export const YoutubeColumnsContext = createContext<YoutubeColumns>(youtubeColumnsFor(1000))
export const useYoutubeColumns = (): YoutubeColumns => useContext(YoutubeColumnsContext)
