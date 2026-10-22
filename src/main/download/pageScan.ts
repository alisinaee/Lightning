import type { RequestExtras, ScanPageResult } from '../../shared/types'
import { buildHeaders } from '../../shared/requestHeaders'

const SCAN_TIMEOUT_MS = 20_000
const MAX_PAGE_BYTES = 8 * 1024 * 1024
const MAX_LINKS = 2000

// Extensions of things worth downloading; anything else on a page is navigation.
const FILE_EXTENSIONS = new Set(
  (
    'zip rar 7z tar gz tgz bz2 xz zst iso img dmg pkg exe msi apk ipa deb rpm appimage ' +
    'mp4 mkv avi mov wmv flv webm m4v ts mp3 flac wav aac ogg m4a opus ' +
    'pdf epub mobi azw3 doc docx xls xlsx ppt pptx csv ' +
    'jpg jpeg png gif webp svg bmp tif tiff psd raw ' +
    'torrent bin rom pak part001 001'
  ).split(' ')
)

function isFileLink(url: URL): boolean {
  const name = decodeURIComponent(url.pathname.split('/').pop() ?? '').toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  const extension = name.slice(dot + 1)
  // Split archives: .part1.rar, .z01, .r00, .7z.001
  return FILE_EXTENSIONS.has(extension) || /^(z\d{2}|r\d{2}|\d{3})$/.test(extension)
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/** The links on a page, absolute and without repeats, in page order. Only file links (and
 * magnets) unless `all`; page chrome (fragments, mailto:, javascript:) never. */
export function extractLinks(html: string, base: string, all: boolean): ScanPageResult {
  const seen = new Set<string>()
  const links: string[] = []
  let others = 0
  const add = (raw: string): void => {
    const text = decodeEntities(raw.trim())
    if (!text || text.startsWith('#') || /^(javascript|mailto|tel|data|blob):/i.test(text)) return
    let url: URL
    try {
      url = new URL(text, base)
    } catch {
      return
    }
    let link: string
    if (url.protocol === 'magnet:') link = url.href
    else if (url.protocol === 'http:' || url.protocol === 'https:') {
      url.hash = ''
      link = url.href
    } else return
    if (seen.has(link)) return
    seen.add(link)
    if (all || url.protocol === 'magnet:' || isFileLink(url)) {
      if (links.length < MAX_LINKS) links.push(link)
    } else others++
  }
  // href, src, data-* and <source>/<video> attributes, quoted or not.
  const attribute =
    /\b(?:href|src|data-href|data-src|data-url|data-download|data-link|content)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
  for (const match of html.matchAll(attribute)) add(match[1] ?? match[2] ?? match[3] ?? '')
  // Links written out as text or inside scripts.
  for (const match of html.matchAll(/(?:https?:\/\/|magnet:\?)[^\s"'<>\\)]+/gi)) add(match[0])
  return { links, otherCount: others }
}

/** The links among `urls` worth downloading (file links and magnets; every http(s) link when
 * `all`), absolute and without repeats: what the browser extension collected from a page. */
export function fileLinksOf(urls: string[], all: boolean): ScanPageResult {
  const seen = new Set<string>()
  const links: string[] = []
  let others = 0
  for (const text of urls) {
    let url: URL
    try {
      url = new URL(text)
    } catch {
      continue
    }
    url.hash = ''
    const link = url.protocol === 'magnet:' ? text : url.href
    if (!/^(https?:|magnet:)/i.test(url.protocol) || seen.has(link)) continue
    seen.add(link)
    if (all || url.protocol === 'magnet:' || isFileLink(url)) {
      if (links.length < MAX_LINKS) links.push(link)
    } else others++
  }
  return { links, otherCount: others }
}

/** Fetches `pageUrl` and lists the download links on it. */
export async function scanPage(
  pageUrl: string,
  extras: RequestExtras | undefined,
  all: boolean
): Promise<ScanPageResult> {
  let url: URL
  try {
    url = new URL(pageUrl)
  } catch {
    throw new Error('That is not a web address')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('A page address starts with https://')
  }
  let response: Response
  try {
    response = await fetch(url, {
      headers: buildHeaders(extras, { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' }),
      redirect: 'follow',
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS)
    })
  } catch {
    throw new Error('Could not open the page. Check the address and your connection.')
  }
  if (!response.ok) throw new Error(`The page answered ${response.status}`)
  const type = response.headers.get('content-type') ?? ''
  if (type && !/text|html|xml|json/i.test(type)) {
    throw new Error('That address is a file, not a page: add it as a link instead')
  }
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    chunks.push(value)
    if (size > MAX_PAGE_BYTES) {
      await reader.cancel()
      break
    }
  }
  const html = Buffer.concat(chunks).toString('utf-8')
  return extractLinks(html, response.url || url.href, all)
}
