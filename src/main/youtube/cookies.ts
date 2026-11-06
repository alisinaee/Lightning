import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { youtubeDataDir } from './binary'

/** One cookie as the browser extension reads it. */
export interface BrowserCookie {
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate?: number
  name: string
  value: string
}

const MAX_COOKIES = 2000

/** The cookies the app keeps for yt-dlp when the person chose to save them in Lightning. */
export function savedCookiesPath(): string {
  return join(youtubeDataDir(), 'cookies.txt')
}

/** A cookie is only kept if its fields are plain text with no tabs or line breaks, since a
 * Netscape cookies file is tab- and line-separated. */
const clean = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string' || value.length > max) return null
  return /[\t\r\n\0]/.test(value) ? null : value
}

export function sanitizeCookies(raw: unknown): BrowserCookie[] {
  if (!Array.isArray(raw)) return []
  const cookies: BrowserCookie[] = []
  for (const entry of raw.slice(0, MAX_COOKIES)) {
    if (typeof entry !== 'object' || entry === null) continue
    const item = entry as Record<string, unknown>
    const domain = clean(item.domain, 255)
    const path = clean(item.path, 1024)
    const name = clean(item.name, 4096)
    const value = clean(item.value, 16384)
    if (domain === null || path === null || name === null || value === null) continue
    if (!domain || !name) continue
    const expiry =
      typeof item.expirationDate === 'number' && Number.isFinite(item.expirationDate)
        ? Math.floor(item.expirationDate)
        : undefined
    cookies.push({
      domain,
      path: path || '/',
      secure: item.secure === true,
      httpOnly: item.httpOnly === true,
      expirationDate: expiry,
      name,
      value
    })
  }
  return cookies
}

/** Writes cookies in Netscape format, the file yt-dlp's --cookies option reads. Expired cookies are
 * left out. The file is readable by this user only. */
export async function writeCookiesFile(file: string, cookies: BrowserCookie[]): Promise<void> {
  const now = Date.now() / 1000
  const lines = ['# Netscape HTTP Cookie File']
  for (const cookie of cookies) {
    if (
      cookie.expirationDate !== undefined &&
      cookie.expirationDate > 0 &&
      cookie.expirationDate < now
    ) {
      continue
    }
    const includeSub = cookie.domain.startsWith('.') ? 'TRUE' : 'FALSE'
    const prefix = cookie.httpOnly ? '#HttpOnly_' : ''
    lines.push(
      [
        `${prefix}${cookie.domain}`,
        includeSub,
        cookie.path,
        cookie.secure ? 'TRUE' : 'FALSE',
        String(cookie.expirationDate ?? 0),
        cookie.name,
        cookie.value
      ].join('\t')
    )
  }
  await writeFile(file, lines.join('\n') + '\n', { encoding: 'utf-8', mode: 0o600 })
  await chmod(file, 0o600)
}
