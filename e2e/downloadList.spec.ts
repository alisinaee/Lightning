import { expect, test } from '@playwright/test'
import {
  buildEntries,
  countEntries,
  filterEntries,
  type ListEntry
} from '../src/renderer/src/utils/downloadList'
import type { DownloadState, FinishedDownload, GroupInfo } from '../src/shared/types'

// The sidebar's numbers, its filters and the search all work on files, so they agree with what
// the list shows, groups included.

const live = (id: string, fileName: string, status: string, groupId?: string): DownloadState =>
  ({
    kind: 'http',
    id,
    url: `http://host.test/${fileName}`,
    fileName,
    destinationPath: '/x',
    totalBytes: 100,
    bytesDownloaded: 50,
    speedBytesPerSec: 0,
    status,
    startedAt: Number(id.replace(/\D/g, '')) || 0,
    networks: [],
    streams: [],
    ...(groupId ? { groupId } : {})
  }) as unknown as DownloadState

const done = (id: string, fileName: string, groupId?: string): FinishedDownload =>
  ({
    ...live(id, fileName, 'completed', groupId),
    unitsWritten: 1
  }) as unknown as FinishedDownload

const group = (id: string, name: string, pending: GroupInfo['pending'] = []): GroupInfo =>
  ({ id, name, pending }) as unknown as GroupInfo

const waiting = (id: string, name: string, error?: string): GroupInfo['pending'][number] =>
  ({
    id,
    ...(error ? { error } : {}),
    request: { kind: 'http', url: `http://host.test/${name}`, suggestedFileName: name }
  }) as unknown as GroupInfo['pending'][number]

const world = (): ListEntry[] =>
  buildEntries(
    [
      live('d1', 'a.zip', 'downloading', 'g1'),
      live('d2', 'b.mp4', 'error', 'g1'),
      live('d3', 'c.pdf', 'paused', 'g1'),
      live('d4', 'solo.iso', 'error'),
      live('d5', 'g2one.rar', 'downloading', 'g2')
    ],
    [done('h1', 'old.zip', 'g1'), done('h2', 'old2.zip', 'g1'), done('h3', 'lone.txt')],
    [
      group('g1', 'Big group', [waiting('w1', 'later.mkv'), waiting('w2', 'bad.mkv', 'refused')]),
      group('g2', 'Other')
    ]
  )

test.describe('sidebar counts, filters and search work on files @smoke', () => {
  test('counts are files: a group of mixed files adds to every status it holds', () => {
    const { statuses, kinds } = countEntries(world())
    // g1: 1 downloading, 2 failed (error + refused waiting), 1 paused, 1 queued, 2 completed;
    // solo.iso failed; g2one downloading; lone.txt completed.
    expect(statuses.all).toBe(10)
    expect(statuses.downloading).toBe(2)
    expect(statuses.failed).toBe(3)
    expect(statuses.paused).toBe(1)
    expect(statuses.queued).toBe(1)
    expect(statuses.finished).toBe(3)
    expect(statuses.progress).toBe(4)
    // The kinds add up to the files too.
    expect(Object.values(kinds).reduce((a, b) => a + b, 0)).toBe(statuses.all)
    expect(kinds.archive).toBe(4)
    expect(kinds.video).toBe(3)
  })

  test('a status shows the groups that hold such files, with only those files', () => {
    const { entries, only } = filterEntries(world(), 'failed', null, '')
    expect(entries.map((entry) => entry.id).sort()).toEqual(['d4', 'g1'].sort())
    expect([...only!.get('g1')!].sort()).toEqual(['d2', 'w2'])
  })

  test('the number a status shows is the number of files it lists', () => {
    for (const filter of ['downloading', 'queued', 'paused', 'failed', 'finished'] as const) {
      const { statuses } = countEntries(world())
      const { entries, only } = filterEntries(world(), filter, null, '')
      const listed = entries.reduce(
        (sum, entry) => sum + (entry.type === 'group' ? only!.get(entry.id)!.size : 1),
        0
      )
      expect(listed, filter).toBe(statuses[filter])
    }
  })

  test('nothing narrowing the list leaves every group with all its files', () => {
    const result = filterEntries(world(), 'all', null, '')
    expect(result.only).toBeNull()
    expect(result.entries).toHaveLength(world().length)
  })

  test('a file kind narrows to the files of that kind', () => {
    const { entries, only } = filterEntries(world(), 'all', 'video', '')
    expect(entries.map((entry) => entry.id)).toEqual(['g1'])
    expect([...only!.get('g1')!].sort()).toEqual(['d2', 'w1', 'w2'])
  })

  test('search finds every matching file, waiting ones too, and counts them', () => {
    const { entries, hits, only } = filterEntries(world(), 'all', null, 'mkv')
    expect(entries.map((entry) => entry.id)).toEqual(['g1'])
    expect([...hits].sort()).toEqual(['w1', 'w2'])
    expect([...only!.get('g1')!].sort()).toEqual(['w1', 'w2'])
  })

  test('search by a file name across rows and groups finds each', () => {
    const { hits } = filterEntries(world(), 'all', null, 'zip')
    expect([...hits].sort()).toEqual(['d1', 'h1', 'h2'])
  })

  test('a group name that matches finds all of that group’s files', () => {
    const { hits, entries } = filterEntries(world(), 'all', null, 'big group')
    expect(entries.map((entry) => entry.id)).toEqual(['g1'])
    expect(hits.size).toBe(7)
  })

  test('search matches the website too', () => {
    expect(filterEntries(world(), 'all', null, 'host.test').hits.size).toBe(10)
  })

  test('a status and a search together leave only files that satisfy both', () => {
    const { hits } = filterEntries(world(), 'failed', null, 'mkv')
    expect([...hits]).toEqual(['w2'])
  })
})
