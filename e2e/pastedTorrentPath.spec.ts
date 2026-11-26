import { expect, test } from '@playwright/test'
import { acceptedLink } from '../src/renderer/src/utils/format'

// Ported from Plexo 79fe5d1 / 38680b3 (no .nzb: Lightning has no Usenet).
test('pasted .torrent paths may use forward slashes or quotes', () => {
  expect(acceptedLink('C:/Downloads/a.torrent')).toBe('C:/Downloads/a.torrent')
  expect(acceptedLink('c:/Downloads/a.torrent')).toBe('c:/Downloads/a.torrent')
  expect(acceptedLink('  "C:\\Downloads\\my file.torrent"  ')).toBe(
    'C:\\Downloads\\my file.torrent'
  )
  expect(acceptedLink("'/Users/me/Downloads/my file.torrent'")).toBe(
    '/Users/me/Downloads/my file.torrent'
  )
  expect(acceptedLink('\\\\server\\share\\a.torrent')).toBeNull()
  expect(acceptedLink('//server/share/a.torrent')).toBeNull()
  expect(acceptedLink('  /tmp/a.torrent  ')).toBe('/tmp/a.torrent')
  expect(acceptedLink('C:\\Downloads\\a.torrent')).toBe('C:\\Downloads\\a.torrent')
  expect(acceptedLink('https://example.com/a.torrent')).toBe('https://example.com/a.torrent')
  expect(acceptedLink('magnet:?xt=urn:btih:abc')).toBe('magnet:?xt=urn:btih:abc')
  expect(acceptedLink('notes.torrent')).toBeNull()
  expect(acceptedLink('C:a.torrent')).toBeNull()
  expect(acceptedLink('C:/Downloads/a.txt')).toBeNull()
  expect(acceptedLink('"/tmp/a.torrent')).toBeNull()
})
