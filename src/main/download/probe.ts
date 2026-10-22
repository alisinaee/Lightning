import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isAbsolute } from 'node:path'
import { URL } from 'node:url'
import { buildHeaders, headersForRedirect, splitUrlCredentials } from '../../shared/requestHeaders'
import type { NetworkInterfaceInfo, ProbeResult, RequestExtras } from '../../shared/types'
import { NoCompatibleRouteError, StreamConnection } from '../network/routes'
import { stallTimeoutMs } from '../testKnobs'
import { parseContentDispositionFilename } from './contentDisposition'
import { normalizeEtag } from './fileVersion'
import {
  describeTorrent,
  downloadTorrentFile,
  fetchMagnetMetadata,
  readTorrentFile
} from './torrent/metadata'

const MAX_REDIRECTS = 5
// A server that accepts the connection and never answers would otherwise hang the probe — and
// the link field's "Checking…" — forever. Same budget as a stalled chunk, for the whole probe:
// redirects included, so a chain of slow hops can't stretch it.
const NO_RESPONSE = 'The server did not respond — check the link and try again'

type Headers = Record<string, string | string[] | undefined>

/** The networks a probe may go out on, best first. The download itself is bound to a network, so
 * the probe must be too: through the computer's default route (a VPN, say) a server can answer
 * differently from how it answers the download, and a size seen here would not hold there. */
export type ProbeNetworks = () => NetworkInterfaceInfo[]

function headerValue(headers: Headers, name: string): string | undefined {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

interface ProbeResponse {
  statusCode: number
  headers: Headers
}

/** GET with a small range (not 1 byte: some hosts answer a range ending at byte 0 or 1 with the
 * whole file yet serve real chunks fine, upstream plexo#101): cheaper than the body, and unlike HEAD it
 * also tells us (via the 206 status) whether range requests actually work. */
async function requestFirstBytes(
  url: URL,
  deadline: number,
  sent: Record<string, string>,
  networks?: ProbeNetworks,
  ranged = true,
  range = 'bytes=0-1023'
): Promise<ProbeResponse> {
  const candidates = networks?.() ?? []
  // All networks are tried at once and the first to answer wins: a network with no internet (a
  // Wi-Fi that only reaches the local network) would otherwise spend the whole deadline before
  // the one that works was ever tried.
  const connections: StreamConnection[] = []
  const attempts = candidates.map(async (network): Promise<ProbeResponse> => {
    const connection = new StreamConnection(() => network, {
      timeoutMs: Math.max(1, deadline - Date.now())
    })
    connections.push(connection)
    const { res } = await connection.request(url, ranged ? { ...sent, Range: range } : sent)
    res.destroy()
    return { statusCode: res.statusCode ?? 0, headers: res.headers as Headers }
  })
  const failures: unknown[] = []
  try {
    if (attempts.length > 0) {
      return await Promise.any(attempts)
    }
  } catch (error) {
    // A network with no way to this host (say IPv4 only for an IPv6 address) is skipped, not
    // fatal; any other failure is kept in case no network gets through.
    for (const reason of (error as AggregateError).errors) {
      if (!(reason instanceof NoCompatibleRouteError)) failures.push(reason)
    }
  } finally {
    for (const connection of connections) connection.close()
  }
  const lastError = failures[failures.length - 1] ?? null
  if (lastError) {
    // A network that connects but never gets an answer: the same words as the default route's.
    if (lastError instanceof Error && /^Connection stalled/.test(lastError.message)) {
      throw new Error(NO_RESPONSE)
    }
    throw lastError
  }
  // No network to bind to (none connected, or a simulated one): the default route.
  return requestFirstBytesDefaultRoute(url, deadline, sent, ranged, range)
}

function requestFirstBytesDefaultRoute(
  url: URL,
  deadline: number,
  sent: Record<string, string>,
  ranged = true,
  range = 'bytes=0-1023'
): Promise<ProbeResponse> {
  return new Promise((resolve, reject) => {
    const requester = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = requester(
      {
        method: 'GET',
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        headers: ranged ? { ...sent, Range: range } : sent
      },
      (res) => {
        clearTimeout(timer)
        res.destroy()
        resolve({ statusCode: res.statusCode ?? 0, headers: res.headers as Headers })
      }
    )
    const timer = setTimeout(
      () => req.destroy(new Error(NO_RESPONSE)),
      Math.max(0, deadline - Date.now())
    )
    req.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    req.end()
  })
}

function fileNameFromHeaders(headers: Headers, url: URL): string {
  const disposition = headerValue(headers, 'content-disposition')
  if (disposition) {
    const parsed = parseContentDispositionFilename(disposition)
    if (parsed) return parsed
  }
  let pathname = url.pathname
  try {
    pathname = decodeURIComponent(pathname)
  } catch {
    // A malformed %-escape: the raw path still names the file well enough.
  }
  const base = pathname.split('/').filter(Boolean).pop()
  return base && base.length > 0 ? base : 'download'
}

async function requestFollowingRedirects(
  rawUrl: string,
  extras?: RequestExtras,
  networks?: ProbeNetworks
): Promise<{ current: URL; response: ProbeResponse | null; sent: Record<string, string> }> {
  let current = new URL(rawUrl)
  let sent = buildHeaders(extras)
  let response: ProbeResponse | null = null
  let ranged = true
  const deadline = Date.now() + stallTimeoutMs()

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    response = await requestFirstBytes(current, deadline, sent, networks, ranged)
    // Some servers refuse any Range request with 403 while serving the same URL in full (upstream
    // plexo#131). Ask once more without one: if that works, the file downloads as one stream from
    // byte zero with no Range, the same as on a server without range support.
    if (response.statusCode === 403 && ranged) {
      ranged = false
      response = await requestFirstBytes(current, deadline, sent, networks, ranged)
    }
    if (response.statusCode >= 300 && response.statusCode < 400) {
      const location = headerValue(response.headers, 'location')
      if (!location) break
      if (redirect === MAX_REDIRECTS) {
        throw new Error('Too many redirects while checking the link')
      }
      const next = new URL(location, current)
      sent = headersForRedirect(sent, current, next)
      current = next
      continue
    }
    break
  }

  return { current, response, sent }
}

/** Whether the server labels each byte range with an ETag of its own (pCloud does, upstream
 * plexo#156): then no chunk's ETag ever matches the probe's. The first range asked again keeps
 * its ETag while the next range gets another. A load balancer alternating labels per request
 * changes it on the repeat instead, and keeps its ETag checked. */
async function etagIsPerRange(
  url: URL,
  sent: Record<string, string>,
  networks: ProbeNetworks | undefined,
  first: ProbeResponse
): Promise<boolean> {
  const etag = headerValue(first.headers, 'etag')
  const total = /\/(\d+)$/.exec(headerValue(first.headers, 'content-range') ?? '')?.[1]
  if (first.statusCode !== 206 || !etag || !total || Number(total) <= 2048) return false
  const deadline = Date.now() + stallTimeoutMs()
  try {
    const again = await requestFirstBytes(url, deadline, sent, networks)
    const next = await requestFirstBytes(url, deadline, sent, networks, true, 'bytes=1024-2047')
    const etagOf = (r: ProbeResponse): string => normalizeEtag(headerValue(r.headers, 'etag') ?? '')
    return (
      again.statusCode === 206 &&
      next.statusCode === 206 &&
      etagOf(again) === normalizeEtag(etag) &&
      etagOf(next) !== '' &&
      etagOf(next) !== normalizeEtag(etag)
    )
  } catch {
    return false
  }
}

/** A link the server says is a torrent, or that is named like one. */
function isTorrentLink(headers: Headers, url: URL): boolean {
  const contentType = headerValue(headers, 'content-type') ?? ''
  return /^application\/x-bittorrent\b/i.test(contentType) || /\.torrent$/i.test(url.pathname)
}

/** What a link would download: a file over HTTP(S), or a torrent — a magnet link, a link to a
 * .torrent, or the path of a .torrent on this computer (opened or dropped on the window). */
export async function probeUrl(
  link: string,
  extras?: RequestExtras,
  networks?: ProbeNetworks
): Promise<ProbeResult> {
  // Sign-in details written into the link (https://user:pass@host/…) become a header, and the link
  // everything else sees has none.
  const { url: rawUrl, auth } = splitUrlCredentials(link)
  const sendWith = auth && !extras?.auth ? { ...extras, auth } : extras
  if (/^magnet:/i.test(rawUrl)) return describeTorrent(await fetchMagnetMetadata(rawUrl), rawUrl)
  if (isAbsolute(rawUrl) && /\.torrent$/i.test(rawUrl)) {
    return describeTorrent(await readTorrentFile(rawUrl), rawUrl)
  }

  const { current, response, sent } = await requestFollowingRedirects(rawUrl, sendWith, networks)

  // An empty file can't satisfy a request for its first byte: the server answers 416 and gives
  // the size as `bytes */0`. That's a valid, empty download, not an error.
  if (
    response?.statusCode === 416 &&
    /^\s*bytes\s+\*\/0\s*$/i.test(headerValue(response.headers, 'content-range') ?? '')
  ) {
    return {
      kind: 'http',
      requestedUrl: rawUrl,
      finalUrl: current.toString(),
      supportsRanges: false,
      totalBytes: 0,
      suggestedFileName: fileNameFromHeaders(response.headers, current),
      contentType: headerValue(response.headers, 'content-type') ?? null,
      etag: headerValue(response.headers, 'etag') ?? null,
      lastModified: headerValue(response.headers, 'last-modified') ?? null
    }
  }

  if (!response || response.statusCode === 0 || response.statusCode >= 400) {
    throw new Error(`Server responded with status ${response?.statusCode || 'unknown'}`)
  }

  if (isTorrentLink(response.headers, current)) {
    const finalUrl = current.toString()
    return describeTorrent(await downloadTorrentFile(finalUrl, stallTimeoutMs()), finalUrl)
  }

  const contentRange = headerValue(response.headers, 'content-range')
  // A server that supports range requests must answer our range GET with 206 Partial Content.
  // If it returned 200 OK, it ignored the Range header and sent the whole file — even if its headers
  // statically claim `Accept-Ranges: bytes`.
  const supportsRanges = response.statusCode === 206

  let totalBytes: number | null = null
  if (contentRange) {
    const match = /\/(\d+)$/.exec(contentRange)
    if (match) totalBytes = Number(match[1])
  }
  if (totalBytes === null && response.statusCode === 200) {
    // Only trust Content-Length on a full (200) response — on a 206 it
    // describes the bytes we asked for, not the whole file.
    const contentLength = headerValue(response.headers, 'content-length')
    if (contentLength) totalBytes = Number(contentLength)
  }

  const perRange = await etagIsPerRange(current, sent, networks, response)

  return {
    kind: 'http',
    requestedUrl: rawUrl,
    finalUrl: current.toString(),
    supportsRanges,
    totalBytes,
    suggestedFileName: fileNameFromHeaders(response.headers, current),
    contentType: headerValue(response.headers, 'content-type') ?? null,
    etag: perRange ? null : (headerValue(response.headers, 'etag') ?? null),
    lastModified: headerValue(response.headers, 'last-modified') ?? null
  }
}
