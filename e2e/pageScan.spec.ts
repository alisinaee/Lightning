import { expect, test } from '@playwright/test'
import { extractLinks } from '../src/main/download/pageScan'

const page = `
<a href="/files/game.part1.rar">one</a>
<a href='game.part2.rar?token=a&amp;b=1'>two</a>
<a href="https://cdn.example.com/video.mp4#t=3">video</a>
<a href="/about">About</a>
<a href="mailto:me@example.com">mail</a>
<a href="javascript:void(0)">js</a>
<a href="#top">top</a>
<a href="/files/game.part1.rar">again</a>
<video><source src="//media.example.com/clip.webm"></video>
<a href="magnet:?xt=urn:btih:abc">magnet</a>
<script>var u = "https://dl.example.com/big.iso";</script>
`

test('file links are found, resolved, decoded and deduplicated', () => {
  const { links, otherCount } = extractLinks(page, 'https://site.example/dir/page.html', false)
  expect(links).toEqual([
    'https://site.example/files/game.part1.rar',
    'https://site.example/dir/game.part2.rar?token=a&b=1',
    'https://cdn.example.com/video.mp4',
    'https://media.example.com/clip.webm',
    'magnet:?xt=urn:btih:abc',
    'https://dl.example.com/big.iso'
  ])
  expect(otherCount).toBe(1)
})

test('every link on request leaves out only chrome like mailto and fragments', () => {
  const { links } = extractLinks(page, 'https://site.example/dir/page.html', true)
  expect(links).toContain('https://site.example/about')
  expect(links.some((link) => link.startsWith('mailto:'))).toBe(false)
})

test('links collected by the browser are filtered to files and deduplicated', async () => {
  const { fileLinksOf } = await import('../src/main/download/pageScan')
  const { links, otherCount } = fileLinksOf(
    [
      'https://a.example/x.rar#frag',
      'https://a.example/x.rar',
      'https://a.example/index',
      'ftp://a.example/y.zip',
      'magnet:?xt=urn:btih:abc'
    ],
    false
  )
  expect(links).toEqual(['https://a.example/x.rar', 'magnet:?xt=urn:btih:abc'])
  expect(otherCount).toBe(1)
})

test('a disk that is not connected is told apart from a deleted file', async () => {
  const { volumeRootOf } = await import('../src/shared/volumes')
  expect(volumeRootOf('/Volumes/Games/ps5/a.rar')).toBe('/Volumes/Games')
  expect(volumeRootOf('/mnt/data/x/a.rar')).toBe('/mnt/data')
  expect(volumeRootOf('C:\\Users\\me\\a.rar')).toBe('C:\\')
  expect(volumeRootOf('/Users/me/Downloads/a.rar')).toBe('/')
})
