import type { DownloadState } from '../src/shared/types'
import { expect, test } from '@playwright/test'
import { describeError, linkExpired } from '../src/renderer/src/utils/format'
import { isTransientFailure } from '../src/shared/retry'

// A 416 (Range Not Satisfiable) on a resumed download means the byte range no longer exists, so
// it is a dead link like a 404/410: offer a fresh link, never retry the same range.

const RANGE_416 = 'Unexpected status 416 for range request'

function httpDownload(overrides: Record<string, unknown>): DownloadState {
  return {
    kind: 'http',
    status: 'error',
    error: RANGE_416,
    ...overrides
  } as unknown as DownloadState
}

test.describe('416 is a dead link', () => {
  test('a range no longer satisfiable needs a fresh link, not a retry', () => {
    expect(isTransientFailure(RANGE_416)).toBe(false)
    expect(isTransientFailure('Server responded with status 404')).toBe(false)
    expect(isTransientFailure('Server responded with status 410')).toBe(false)
  })

  test('still retries transient server errors', () => {
    expect(isTransientFailure('Unexpected status 503 for range request')).toBe(true)
    expect(isTransientFailure('Server responded with status 429')).toBe(true)
  })

  test('shows the same message as a refused link', () => {
    expect(describeError(RANGE_416)).toBe(
      'This link no longer works. Paste a new link to continue.'
    )
    expect(describeError('Unexpected status 404 for range request')).toBe(
      'This link no longer works. Paste a new link to continue.'
    )
  })

  test('an HTTP download with a 416 counts as an expired link', () => {
    expect(linkExpired(httpDownload({}))).toBe(true)
    expect(linkExpired(httpDownload({ status: 'paused' }))).toBe(false)
    expect(linkExpired(httpDownload({ error: 'Unexpected status 500 for range request' }))).toBe(
      false
    )
  })
})
