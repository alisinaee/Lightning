import { expect, test } from '@playwright/test'
import { findMatches, type KnownDownload } from '../src/shared/duplicates'
import { autoRetryDelaySeconds, isTransientFailure } from '../src/shared/retry'
import { normalizeUrl, redactUrl, redactUrlsIn } from '../src/shared/urlTools'

test('normalizeUrl ignores the fragment and host case but keeps path and query', () => {
  expect(normalizeUrl('HTTP://Example.COM/a/B?x=1&y=2#top')).toBe('http://example.com/a/B?x=1&y=2')
  expect(normalizeUrl('http://example.com/a?y=2&x=1')).not.toBe(
    normalizeUrl('http://example.com/a?x=1&y=2')
  )
  expect(normalizeUrl('magnet:?xt=urn:btih:abc#x')).toBe('magnet:?xt=urn:btih:abc')
})

test('redactUrl drops credentials and query strings', () => {
  expect(redactUrl('https://user:pw@host.test/f.zip?token=secret#frag')).toBe(
    'https://host.test/f.zip?…'
  )
  expect(redactUrl('https://host.test/f.zip')).toBe('https://host.test/f.zip')
  expect(redactUrl('magnet:?xt=urn:btih:abc123&dn=name&tr=http://t')).toBe(
    'magnet:?xt=urn:btih:abc123'
  )
  expect(redactUrlsIn('failed https://h.test/a?sig=zzz now')).toBe('failed https://h.test/a?… now')
  expect(redactUrl('not a url?token=1')).toBe('not a url')
})

const known = (over: Partial<KnownDownload>): KnownDownload => ({
  id: 'd1',
  url: 'https://h.test/file.bin',
  kind: 'history',
  fileName: 'file.bin',
  destinationPath: '/dl/file.bin',
  totalBytes: 100,
  ...over
})

test('findMatches by url, final url, name+size and file on disk', () => {
  const urls = ['https://H.test/file.bin#x']
  expect(findMatches(urls, [known({})])[0]).toMatchObject({ kind: 'history', reason: 'url' })
  expect(
    findMatches(['https://cdn.test/x'], [known({})], {
      probes: [{ url: 'https://cdn.test/x', finalUrl: 'https://h.test/file.bin' }]
    })[0].reason
  ).toBe('final-url')
  expect(
    findMatches(['https://other.test/q'], [known({})], {
      probes: [{ url: 'https://other.test/q', fileName: 'file.bin', totalBytes: 100 }]
    })[0].reason
  ).toBe('file-name')
  expect(
    findMatches(['https://other.test/q'], [known({})], {
      probes: [{ url: 'https://other.test/q', fileName: 'file.bin', totalBytes: 99 }]
    })
  ).toEqual([])
  expect(
    findMatches(['https://o.test/q'], [], {
      destinationDir: '/dl',
      filesInFolder: new Set(['a.bin']),
      probes: [{ url: 'https://o.test/q', fileName: 'a.bin' }]
    })[0].kind
  ).toBe('file-on-disk')
  expect(findMatches(urls, [known({})], { ignoreIds: ['d1'] })).toEqual([])
})

test('transient failures retry, refused links do not', () => {
  expect(isTransientFailure('Server responded with status 503')).toBe(true)
  expect(isTransientFailure('read ECONNRESET')).toBe(true)
  expect(isTransientFailure('Server responded with status 403 for range request')).toBe(false)
  expect(isTransientFailure('ENOSPC: no space')).toBe(false)
  expect(autoRetryDelaySeconds(1)).toBe(15)
  expect(autoRetryDelaySeconds(9)).toBe(300)
})
