import type { DownloadState, FinishedDownload, GroupInfo } from '@shared/types'
import type { DownloadFilter, SortKey } from '../store/useAppStore'
import { connectionsOf, sourceOf, wantedBytes } from './format'
import { kindOfDownload, type FileKind } from './fileKind'
import { isFinished, STATUS_ORDER, statusKeyOf, type Item, type StatusKey } from './status'

/** A download group, with its files (finished ones too) to show when it is opened. */
export interface GroupEntry {
  group: GroupInfo
  items: Item[]
}

/** One row of the list: a download on its own, or a group of them. */
export type ListEntry =
  { type: 'item'; id: string; item: Item } | { type: 'group'; id: string; entry: GroupEntry }

const GROUP_STATUS_ORDER: StatusKey[] = ['downloading', 'queued', 'paused', 'failed', 'completed']

/** The most active state a group's files are in: it is listed under that heading. A file still
 * waiting for a network counts as paused, or as needing attention if it couldn't start. */
export function statusOfGroup({ group, items }: GroupEntry): StatusKey {
  const found = new Set<StatusKey>(
    items.map((item): StatusKey => {
      if (isFinished(item) || item.status === 'completed') return 'completed'
      if (item.status === 'cancelled') return 'paused'
      const key = statusKeyOf(item)
      return key === 'attention' ? 'failed' : key
    })
  )
  for (const waiting of group.pending) found.add(waiting.error ? 'failed' : 'paused')
  return GROUP_STATUS_ORDER.find((status) => found.has(status)) ?? 'completed'
}

export function buildEntries(
  downloads: DownloadState[],
  history: FinishedDownload[],
  groups: GroupInfo[]
): ListEntry[] {
  // A group with nothing in it any more isn't listed.
  const grouped: GroupEntry[] = groups
    .map((group) => ({
      group,
      items: [
        ...downloads.filter((download) => download.groupId === group.id),
        ...history.filter((entry) => entry.groupId === group.id)
      ] as Item[]
    }))
    .filter((entry) => entry.items.length > 0 || entry.group.pending.length > 0)
  const inGroups = new Set(grouped.flatMap((entry) => entry.items.map((item) => item.id)))
  const single: Item[] = [
    ...downloads.filter((download) => !inGroups.has(download.id)),
    // Completed but not in history yet is in `downloads`: on its way there, listed all the same.
    ...history.filter((entry) => !inGroups.has(entry.id))
  ]
  return [
    ...single.map((item): ListEntry => ({ type: 'item', id: item.id, item })),
    ...grouped.map((entry): ListEntry => ({ type: 'group', id: entry.group.id, entry }))
  ]
}

export const entryStatus = (entry: ListEntry): StatusKey =>
  entry.type === 'item' ? statusKeyOf(entry.item) : statusOfGroup(entry.entry)

export const entryItems = (entry: ListEntry): Item[] =>
  entry.type === 'item' ? [entry.item] : entry.entry.items

/** Whether a status shows under a filter. "In progress" is the three that are not yet done; a
 * link that needs fixing is a failure for the filters. */
export function matchesFilter(filter: DownloadFilter, status: StatusKey): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'progress':
      return status === 'downloading' || status === 'queued' || status === 'paused'
    case 'finished':
      return status === 'completed'
    case 'failed':
      return status === 'failed' || status === 'attention'
    default:
      return status === filter
  }
}

export interface ListCounts {
  statuses: Record<DownloadFilter, number>
  kinds: Record<FileKind, number>
}

/** What each sidebar item would show: a group counts once under its status, and once under every
 * file kind it holds. */
export function countEntries(entries: ListEntry[]): ListCounts {
  const statuses: Record<DownloadFilter, number> = {
    all: 0,
    progress: 0,
    finished: 0,
    failed: 0,
    downloading: 0,
    queued: 0,
    paused: 0
  }
  const kinds: Record<FileKind, number> = {
    video: 0,
    audio: 0,
    archive: 0,
    document: 0,
    program: 0,
    image: 0,
    torrent: 0,
    disk: 0,
    other: 0
  }
  for (const entry of entries) {
    const status = entryStatus(entry)
    for (const filter of Object.keys(statuses) as DownloadFilter[]) {
      if (matchesFilter(filter, status)) statuses[filter]++
    }
    for (const kind of new Set(entryItems(entry).map(kindOfDownload))) kinds[kind]++
  }
  return { statuses, kinds }
}

export function filterEntries(
  entries: ListEntry[],
  filter: DownloadFilter,
  kind: FileKind | null,
  search: string
): ListEntry[] {
  const needle = search.trim().toLowerCase()
  return entries.filter((entry) => {
    if (!matchesFilter(filter, entryStatus(entry))) return false
    const items = entryItems(entry)
    if (kind && !items.some((item) => kindOfDownload(item) === kind)) return false
    if (!needle) return true
    if (entry.type === 'group' && entry.entry.group.name.toLowerCase().includes(needle)) return true
    return items.some(
      (item) =>
        item.fileName.toLowerCase().includes(needle) ||
        item.url.toLowerCase().includes(needle) ||
        sourceOf(item.url).toLowerCase().includes(needle)
    )
  })
}

function sortValue(entry: ListEntry, key: SortKey): string | number {
  const items = entryItems(entry)
  switch (key) {
    case 'name':
      return (entry.type === 'item' ? entry.item.fileName : entry.entry.group.name).toLowerCase()
    case 'size':
      return items.reduce((sum, item) => sum + wantedBytes(item), 0)
    case 'status':
      return STATUS_ORDER[entryStatus(entry)]
    case 'speed':
      return items.reduce(
        (sum, item) =>
          sum + (!isFinished(item) && item.status === 'downloading' ? item.speedBytesPerSec : 0),
        0
      )
    case 'eta': {
      const seconds = items.map((item) => {
        if (isFinished(item) || item.status !== 'downloading' || item.speedBytesPerSec <= 0)
          return null
        return item.timeLeftSeconds ?? null
      })
      const known = seconds.filter((value): value is number => value !== null)
      return known.length > 0 ? Math.max(...known) : Number.POSITIVE_INFINITY
    }
    case 'added':
      return entry.type === 'item' ? entry.item.startedAt : entry.entry.group.createdAt
    case 'connections':
      return new Set(items.flatMap((item) => connectionsOf(item.networks).map((n) => n.id))).size
  }
}

/** The list in the order the user picked; ties keep the order they arrived in, newest last. */
export function sortEntries(
  entries: ListEntry[],
  sort: { key: SortKey; dir: 'asc' | 'desc' }
): ListEntry[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  return entries
    .map((entry, index) => ({ entry, index, value: sortValue(entry, sort.key) }))
    .sort((a, b) => {
      if (a.value < b.value) return -sign
      if (a.value > b.value) return sign
      const added = (x: ListEntry): number =>
        x.type === 'item' ? x.item.startedAt : x.entry.group.createdAt
      return added(a.entry) - added(b.entry) || a.index - b.index
    })
    .map(({ entry }) => entry)
}

/** Place in the queue of each queued download, 1 first. */
export function queuePositions(downloads: DownloadState[]): Map<string, number> {
  const queued = downloads
    .filter((download) => download.status === 'queued')
    .sort((a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0))
  return new Map(queued.map((download, index) => [download.id, index + 1]))
}

/** "2 downloading · 1 queued", or "all done". */
export function summaryOf(downloads: DownloadState[]): string {
  const count = (status: DownloadState['status']): number =>
    downloads.filter((download) => download.status === status).length
  const parts = [
    [count('downloading'), 'downloading'],
    [count('queued'), 'queued'],
    [count('paused'), 'paused'],
    [count('error'), 'need attention']
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, label]) => `${n} ${label}`)
  return parts.length > 0 ? parts.join(' · ') : 'all done'
}
