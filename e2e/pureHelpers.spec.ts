import { expect, test } from '@playwright/test'
import { findMatches, type KnownDownload } from '../src/shared/duplicates'
import { autoRetryDelaySeconds, isTransientFailure } from '../src/shared/retry'
import {
  sanitizeSchedule,
  scheduleStatus,
  type ScheduleRule,
  type ScheduleSettings
} from '../src/shared/schedule'
import { downloadableLink } from '../src/shared/clipboardLinks'
import { isChecksum, parseChecksum } from '../src/shared/checksum'
import {
  buildHeaders,
  headersForRedirect,
  normalizeRequest,
  parseHeaderLines,
  parseNetscapeCookies,
  sanitizeExtras,
  splitUrlCredentials
} from '../src/shared/requestHeaders'
import type { RequestExtras } from '../src/shared/types'
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

test('buildHeaders layers user headers, Referer, Cookie and Basic auth over the user agent', () => {
  const headers = buildHeaders(
    {
      headers: { 'X-Token': 'abc', 'user-agent': 'Custom/2', Range: 'bytes=5-', 'Bad\nName': 'x' },
      referer: 'https://page.test/',
      cookie: 'a=1; b=2',
      auth: { user: 'me', pass: 'p:w' }
    },
    { Range: 'bytes=0-9' }
  )
  expect(headers['X-Token']).toBe('abc')
  expect(headers['user-agent']).toBe('Custom/2')
  expect(headers['User-Agent']).toBeUndefined()
  expect(headers['Referer']).toBe('https://page.test/')
  expect(headers['Cookie']).toBe('a=1; b=2')
  expect(headers['Authorization']).toBe(`Basic ${Buffer.from('me:p:w').toString('base64')}`)
  // A user may not set the transfer's own Range; the caller's wins.
  expect(headers['Range']).toBe('bytes=0-9')
  expect(Object.keys(headers).some((name) => name.includes('Bad'))).toBe(false)
  expect(buildHeaders(undefined)['User-Agent']).toBe('Lightning/1.0')
})

test('headersForRedirect keeps cookies and sign-in on the same host only', () => {
  const sent = { 'User-Agent': 'x', Authorization: 'Basic abc', cookie: 'a=1', Referer: 'r' }
  expect(headersForRedirect(sent, 'https://a.test/x', 'https://a.test/y')).toBe(sent)
  expect(headersForRedirect(sent, 'https://a.test/x', 'https://cdn.test/y')).toEqual({
    'User-Agent': 'x',
    Referer: 'r'
  })
})

test('splitUrlCredentials takes user:password out of a link', () => {
  expect(splitUrlCredentials('https://me:p%40ss@host.test/f.zip?x=1')).toEqual({
    url: 'https://host.test/f.zip?x=1',
    auth: { user: 'me', pass: 'p@ss' }
  })
  expect(splitUrlCredentials('https://host.test/f.zip')).toEqual({ url: 'https://host.test/f.zip' })
  expect(splitUrlCredentials('magnet:?xt=urn:btih:abc')).toEqual({ url: 'magnet:?xt=urn:btih:abc' })
})

test('parseNetscapeCookies picks the live cookies that match the link', () => {
  const file = [
    '# Netscape HTTP Cookie File',
    '.example.com\tTRUE\t/\tFALSE\t0\tsession\tabc',
    '#HttpOnly_.example.com\tTRUE\t/files\tTRUE\t4102444800\ttoken\txyz',
    '.example.com\tTRUE\t/\tFALSE\t1\told\tgone',
    '.other.test\tTRUE\t/\tFALSE\t0\tnope\t1'
  ].join('\n')
  expect(parseNetscapeCookies(file, 'https://dl.example.com/files/a.zip')).toBe(
    'session=abc; token=xyz'
  )
  // Not https: the Secure cookie is left out. A different path: so is the /files one.
  expect(parseNetscapeCookies(file, 'http://dl.example.com/files/a.zip')).toBe('session=abc')
  expect(parseNetscapeCookies(file, 'https://example.com/other')).toBe('session=abc')
})

test('parseHeaderLines and sanitizeExtras drop anything unsafe', () => {
  expect(parseHeaderLines('X-A: 1\nnot a header\nHost: evil\n: x\nX-B:  two ')).toEqual({
    'X-A': '1',
    'X-B': 'two'
  })
  const extras = sanitizeExtras({
    referer: 'https://p.test/\r\nX: y',
    cookie: 'a=1',
    userAgent: 5,
    auth: { user: 'u', pass: 'p' },
    headers: { 'X-Ok': 'v', Connection: 'close' }
  })
  expect(extras).toEqual({
    cookie: 'a=1',
    auth: { user: 'u', pass: 'p' },
    headers: { 'X-Ok': 'v' }
  })
})

test('normalizeRequest moves link credentials into auth and ignores a forged sealed field', () => {
  const request = normalizeRequest<RequestExtras & { url: string }>({
    url: 'https://me:pw@host.test/f',
    sealed: 'forged',
    cookie: 'a=1\nb'
  })
  expect(request.url).toBe('https://host.test/f')
  expect(request.auth).toEqual({ user: 'me', pass: 'pw' })
  expect(request.sealed).toBeUndefined()
  expect(request.cookie).toBeUndefined()
})

test('parseChecksum reads the forms people paste', () => {
  const sha = 'a'.repeat(64)
  expect(parseChecksum(sha.toUpperCase())).toEqual({ algo: 'sha256', value: sha })
  expect(parseChecksum(`sha256:${sha}`)).toEqual({ algo: 'sha256', value: sha })
  expect(parseChecksum(`SHA-256 = ${sha}`)).toEqual({ algo: 'sha256', value: sha })
  expect(parseChecksum(`${sha}  *ubuntu.iso`)).toEqual({ algo: 'sha256', value: sha })
  expect(parseChecksum('d41d8cd98f00b204e9800998ecf8427e')).toEqual({
    algo: 'md5',
    value: 'd41d8cd98f00b204e9800998ecf8427e'
  })
  // A label that disagrees with the length, odd lengths and non-hex are refused.
  expect(parseChecksum(`md5:${sha}`)).toBeNull()
  expect(parseChecksum('abc123')).toBeNull()
  expect(parseChecksum('hello world')).toBeNull()
  expect(isChecksum({ algo: 'sha1', value: 'b'.repeat(40) })).toBe(true)
  expect(isChecksum({ algo: 'sha1', value: 'B'.repeat(40) })).toBe(false)
})

test('downloadableLink offers links to files and nothing else', () => {
  expect(downloadableLink(' https://h.test/dl/Ubuntu%2024.iso?token=1 ')).toBe(
    'https://h.test/dl/Ubuntu%2024.iso?token=1'
  )
  expect(downloadableLink('magnet:?xt=urn:btih:abc123&dn=x')).toBe(
    'magnet:?xt=urn:btih:abc123&dn=x'
  )
  expect(downloadableLink('https://h.test/movie.MKV')).toBe('https://h.test/movie.MKV')
  expect(downloadableLink('https://h.test/page.html')).toBeNull()
  expect(downloadableLink('https://h.test/picture.png')).toBeNull()
  expect(downloadableLink('https://h.test/')).toBeNull()
  expect(downloadableLink('see https://h.test/a.zip please')).toBeNull()
  expect(downloadableLink('ftp://h.test/a.zip')).toBeNull()
  expect(downloadableLink('')).toBeNull()
})

const rule = (over: Partial<ScheduleRule>): ScheduleRule => ({
  id: 'r',
  days: [0, 1, 2, 3, 4, 5, 6],
  start: '02:00',
  end: '06:00',
  action: 'run',
  ...over
})
// 2026-10-05 is a Monday (getDay() 1). Local times, as the schedule is read.
const at = (day: number, time: string): Date => {
  const [h, m] = time.split(':').map(Number)
  return new Date(2026, 9, 4 + day, h, m, 0, 0)
}

test('a run window lets downloads go only inside it, at its cap', () => {
  const settings: ScheduleSettings = {
    enabled: true,
    rules: [rule({ speedCap: 1_000_000 })]
  }
  expect(scheduleStatus(settings, at(1, '01:59')).allow).toBe(false)
  expect(scheduleStatus(settings, at(1, '02:00'))).toMatchObject({ allow: true, cap: 1_000_000 })
  expect(scheduleStatus(settings, at(1, '05:59')).allow).toBe(true)
  expect(scheduleStatus(settings, at(1, '06:00')).allow).toBe(false)
  // The next change from inside the window is its end; from outside, its start.
  expect(new Date(scheduleStatus(settings, at(1, '03:00')).nextChange!).getHours()).toBe(6)
  expect(new Date(scheduleStatus(settings, at(1, '07:00')).nextChange!).getHours()).toBe(2)
  expect(scheduleStatus({ ...settings, enabled: false }, at(1, '12:00')).allow).toBe(true)
})

test('an overnight window belongs to the day it starts on', () => {
  const settings: ScheduleSettings = {
    enabled: true,
    rules: [rule({ days: [1], start: '22:00', end: '06:00' })]
  }
  expect(scheduleStatus(settings, at(1, '23:00')).allow).toBe(true) // Monday evening
  expect(scheduleStatus(settings, at(2, '05:00')).allow).toBe(true) // Tuesday small hours
  expect(scheduleStatus(settings, at(1, '05:00')).allow).toBe(false) // Monday small hours: Sunday's
  expect(scheduleStatus(settings, at(2, '23:00')).allow).toBe(false) // Tuesday evening
})

test('pause windows hold downloads and win over run windows', () => {
  const pauseOnly: ScheduleSettings = {
    enabled: true,
    rules: [rule({ action: 'pause', start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] })]
  }
  expect(scheduleStatus(pauseOnly, at(1, '12:00')).allow).toBe(false)
  expect(scheduleStatus(pauseOnly, at(1, '18:00')).allow).toBe(true)
  expect(scheduleStatus(pauseOnly, at(0, '12:00')).allow).toBe(true) // Sunday
  const both: ScheduleSettings = {
    enabled: true,
    rules: [rule({ start: '00:00', end: '23:59' }), ...pauseOnly.rules]
  }
  expect(scheduleStatus(both, at(1, '12:00')).allow).toBe(false)
})

test('sanitizeSchedule keeps well-formed windows only', () => {
  const clean = sanitizeSchedule({
    enabled: true,
    rules: [
      { id: 'a', days: [1, 1, 9, 3], start: '08:00', end: '09:30', action: 'run', speedCap: 5.4 },
      { days: [1], start: '8:00', end: '09:00', action: 'run' },
      { days: [1], start: '08:00', end: '09:00', action: 'explode' },
      'junk'
    ]
  })
  expect(clean).toEqual({
    enabled: true,
    rules: [{ id: 'a', days: [1, 3], start: '08:00', end: '09:30', action: 'run', speedCap: 5 }]
  })
  expect(sanitizeSchedule(5)).toEqual({ enabled: false, rules: [] })
})
