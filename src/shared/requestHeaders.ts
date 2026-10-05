import { isChecksum } from './checksum'
import type { Checksum, RequestAuth, RequestExtras } from './types'

export const DEFAULT_USER_AGENT = 'Lightning/1.0'

/** Headers the transfer layer owns: a user value would break ranges, framing or the connection. */
const RESERVED = new Set([
  'host',
  'range',
  'if-range',
  'content-length',
  'transfer-encoding',
  'connection',
  'upgrade',
  'te',
  'trailer',
  'expect'
])
/** Sent only to the host the download was asked of, never on to wherever a redirect leads. */
const SENSITIVE = new Set(['authorization', 'cookie', 'proxy-authorization'])

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/** True for a header name and value that are safe to put on a request (no framing characters). */
export function isSendableHeader(name: string, value: string): boolean {
  return TOKEN.test(name) && !RESERVED.has(name.toLowerCase()) && !/[\r\n\0]/.test(value)
}

/** `Name: value` lines (one per line) into a header map; lines that aren't a sendable header are
 * dropped. */
export function parseHeaderLines(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    const name = line.slice(0, at).trim()
    const value = line.slice(at + 1).trim()
    if (isSendableHeader(name, value)) headers[name] = value
  }
  return headers
}

/** A link with its `user:password@` taken out: the clean link, and the credentials it carried. */
export function splitUrlCredentials(link: string): { url: string; auth?: RequestAuth } {
  try {
    const parsed = new URL(link.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { url: link }
    if (!parsed.username && !parsed.password) return { url: link }
    const auth = {
      user: decodeURIComponent(parsed.username),
      pass: decodeURIComponent(parsed.password)
    }
    parsed.username = ''
    parsed.password = ''
    return { url: parsed.href, auth }
  } catch {
    return { url: link }
  }
}

function setHeader(headers: Record<string, string>, name: string, value: string): void {
  const existing = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase())
  if (existing) delete headers[existing]
  headers[name] = value
}

/** The headers a download's requests carry: the user agent, then the user's own headers, then
 * Referer, Cookie and sign-in details. `extra` (a Range) is added last and always wins. */
export function buildHeaders(
  extras: RequestExtras | undefined,
  extra: Record<string, string> = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': extras?.userAgent?.trim() || DEFAULT_USER_AGENT
  }
  for (const [name, value] of Object.entries(extras?.headers ?? {})) {
    if (isSendableHeader(name, value)) setHeader(headers, name, value)
  }
  if (extras?.referer && isSendableHeader('Referer', extras.referer)) {
    setHeader(headers, 'Referer', extras.referer)
  }
  if (extras?.cookie && isSendableHeader('Cookie', extras.cookie)) {
    setHeader(headers, 'Cookie', extras.cookie)
  }
  if (extras?.auth && (extras.auth.user || extras.auth.pass)) {
    const token = Buffer.from(`${extras.auth.user}:${extras.auth.pass}`, 'utf8').toString('base64')
    setHeader(headers, 'Authorization', `Basic ${token}`)
  }
  for (const [name, value] of Object.entries(extra)) setHeader(headers, name, value)
  return headers
}

/** The same headers for the next hop of a redirect: sign-in details and cookies stay behind when
 * the redirect leaves the host they were meant for. */
export function headersForRedirect(
  headers: Record<string, string>,
  from: URL | string,
  to: URL | string
): Record<string, string> {
  const fromHost = new URL(from).host
  const toHost = new URL(to).host
  if (fromHost === toHost) return headers
  const kept: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!SENSITIVE.has(name.toLowerCase())) kept[name] = value
  }
  return kept
}

/** The Cookie header value for `link` from a Netscape `cookies.txt` (what browser exporters write):
 * only live cookies whose domain, path and Secure flag match. */
export function parseNetscapeCookies(text: string, link: string, now = Date.now()): string {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return ''
  }
  const pairs: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim()
    if (!line) continue
    // "#HttpOnly_" marks a cookie; any other leading # is a comment.
    if (line.startsWith('#HttpOnly_')) line = line.slice('#HttpOnly_'.length)
    else if (line.startsWith('#')) continue
    const fields = line.split('\t')
    if (fields.length < 7) continue
    const [domain, , path, secure, expires, name, ...rest] = fields
    const value = rest.join('\t')
    const bare = domain.replace(/^\./, '').toLowerCase()
    const host = url.hostname.toLowerCase()
    if (host !== bare && !host.endsWith(`.${bare}`)) continue
    if (!url.pathname.startsWith(path || '/')) continue
    if (secure.toUpperCase() === 'TRUE' && url.protocol !== 'https:') continue
    const expiry = Number(expires)
    if (expiry > 0 && expiry * 1000 < now) continue
    if (!name) continue
    pairs.push(`${name}=${value}`)
  }
  return pairs.join('; ')
}

/** A header map made safe to log: every value that could carry a secret is hidden. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const shown: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    shown[name] = SENSITIVE.has(name.toLowerCase()) ? '…' : value
  }
  return shown
}

const MAX_TEXT = 8192

function text(value: unknown, max = MAX_TEXT): string | undefined {
  return typeof value === 'string' && value.length <= max && !/[\r\n\0]/.test(value)
    ? value
    : undefined
}

/** What arrived over IPC or the local API, reduced to a valid RequestExtras: anything of the
 * wrong type, too long, or carrying a line break is dropped. */
export function sanitizeExtras(input: unknown): RequestExtras {
  if (typeof input !== 'object' || input === null) return {}
  const raw = input as Record<string, unknown>
  const out: RequestExtras = {}
  if (typeof raw.headers === 'object' && raw.headers !== null) {
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(raw.headers).slice(0, 50)) {
      if (typeof value === 'string' && value.length <= MAX_TEXT && isSendableHeader(name, value)) {
        headers[name] = value
      }
    }
    if (Object.keys(headers).length > 0) out.headers = headers
  }
  const referer = text(raw.referer)
  if (referer) out.referer = referer
  const cookie = text(raw.cookie, 65536)
  if (cookie) out.cookie = cookie
  const userAgent = text(raw.userAgent, 512)
  if (userAgent) out.userAgent = userAgent
  const auth = raw.auth as Record<string, unknown> | undefined
  if (auth && typeof auth.user === 'string' && typeof auth.pass === 'string') {
    if (auth.user.length <= 512 && auth.pass.length <= 512 && (auth.user || auth.pass)) {
      out.auth = { user: auth.user, pass: auth.pass }
    }
  }
  return out
}

/** A start request with its extras made valid and any sign-in details taken out of its link and
 * into `auth`, so the link that is stored, shown and logged carries none. */
export function normalizeRequest<
  T extends RequestExtras & {
    url: string
    checksum?: Checksum
    onComplete?: 'open' | 'folder'
  }
>(request: T): T {
  const { url, auth } = splitUrlCredentials(request.url)
  const extras = sanitizeExtras(request)
  const next: T = { ...request, url }
  delete next.headers
  delete next.referer
  delete next.cookie
  delete next.userAgent
  delete next.auth
  delete next.sealed
  if (next.checksum !== undefined && !isChecksum(next.checksum)) delete next.checksum
  if (next.onComplete !== undefined && next.onComplete !== 'open' && next.onComplete !== 'folder') {
    delete next.onComplete
  }
  Object.assign(next, extras)
  if (auth && !next.auth) next.auth = auth
  return next
}
