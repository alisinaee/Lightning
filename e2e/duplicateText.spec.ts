import { expect, test } from '@playwright/test'
import type { DuplicateMatch } from '../src/shared/duplicates'
import { describeDuplicate } from '../src/renderer/src/utils/duplicateText'

const base: DuplicateMatch = {
  url: 'https://example.com/file.zip',
  kind: 'queued',
  reason: 'url',
  fileName: 'file.zip',
  path: '/Users/someone/Downloads/file.zip',
  folder: '/Users/someone/Downloads'
}

test('describeDuplicate gives one notice for each kind', () => {
  expect(describeDuplicate({ ...base, kind: 'downloading', percent: 42.4 })).toBe(
    'Already downloading (42%)'
  )
  expect(describeDuplicate({ ...base, kind: 'downloading' })).toBe('Already downloading')
  expect(describeDuplicate({ ...base, kind: 'queued' })).toBe('Already in the queue')
  expect(describeDuplicate({ ...base, kind: 'paused' })).toBe('Paused download of this file exists')
  expect(describeDuplicate({ ...base, kind: 'group-waiting' })).toBe(
    'Already waiting in a group download'
  )
  expect(describeDuplicate({ ...base, kind: 'file-on-disk' })).toBe(
    'A file with this name is already in the folder'
  )
})

test('describeDuplicate names the finished date and where the file is', () => {
  const completedAt = new Date(2026, 9, 20, 12).getTime()
  expect(describeDuplicate({ ...base, kind: 'history', completedAt })).toBe(
    'Finished on Oct 20 — the file is still in ~/Downloads'
  )
  expect(describeDuplicate({ ...base, kind: 'history', completedAt, missing: true })).toBe(
    'Finished on Oct 20 — the file was moved or deleted'
  )
  expect(
    describeDuplicate({ ...base, kind: 'history', folder: 'C:\\Users\\someone\\Downloads' })
  ).toBe('Finished — the file is still in ~\\Downloads')
  expect(describeDuplicate({ ...base, kind: 'history', folder: '/srv/files', missing: true })).toBe(
    'Finished — the file was moved or deleted'
  )
})
