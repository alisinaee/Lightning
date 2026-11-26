import type { YoutubeFormatOption } from '../../shared/youtube'
import { runYtDlp } from './binary'

/** The parts of a yt-dlp format this module reads. */
export interface GenericFormat {
  format_id?: string
  ext?: string
  width?: number
  height?: number
  vcodec?: string
  acodec?: string
  filesize?: number
  filesize_approx?: number
  has_drm?: boolean
}

/** Set once yt-dlp has listed its impersonation targets with a Chrome one in them. */
let chromeTargets: boolean | null = null

/** Whether this yt-dlp can impersonate Chrome (the retry for a site that refuses a plain client).
 * The answer is kept once yt-dlp has said it; a failed check is asked again next time. */
export async function canImpersonateChrome(): Promise<boolean> {
  if (chromeTargets !== null) return chromeTargets
  try {
    const { code, stdout } = await runYtDlp(['--list-impersonate-targets'], 30_000)
    if (code !== 0) return false
    chromeTargets = /\bchrome\b/i.test(stdout)
    return chromeTargets
  } catch {
    return false
  }
}

/** yt-dlp's message says the site refused a plain client: a Chrome impersonation may get past it. */
export function looksBlocked(text: string): boolean {
  return /403|forbidden|cloudflare|impersonat/i.test(text)
}

/** yt-dlp found no extractor for the address. */
export function isUnsupported(text: string): boolean {
  return /unsupported url/i.test(text)
}

export const NO_VIDEO_MESSAGE = 'No downloadable video was found on this page.'

/** The referer yt-dlp sends for a site with none given: the address's own origin. */
export function originReferer(url: string): string | undefined {
  try {
    return `${new URL(url).origin}/`
  } catch {
    return undefined
  }
}

/** A title when the page has none: the file name in the address, or the host. */
export function fallbackTitle(url: string): string {
  try {
    const parsed = new URL(url)
    const last = parsed.pathname.split('/').filter(Boolean).pop()
    const name = last ? decodeURIComponent(last).replace(/\.[a-z0-9]{1,5}$/i, '') : ''
    return (name || parsed.hostname).slice(0, 200)
  } catch {
    return 'Video'
  }
}

/** The formats a page offers, as the quality choices. Only heights the video really has are listed,
 * each as "up to that height"; a site that reports no height gets one Best choice. DRM formats are
 * left out (a DRM-only page then has no choice, and says so). */
export function genericFormats(raw: GenericFormat[]): YoutubeFormatOption[] {
  const usable = raw.filter((format) => format.has_drm !== true)
  const heights = new Map<number, GenericFormat>()
  for (const format of usable) {
    if (!format.height || format.height <= 0 || format.vcodec === 'none') continue
    if (!heights.has(format.height)) heights.set(format.height, format)
  }
  const options: YoutubeFormatOption[] = []
  for (const height of [...heights.keys()].sort((a, b) => b - a)) {
    const sample = heights.get(height)
    const size = sample?.filesize || sample?.filesize_approx
    options.push({
      formatId: `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`,
      ext: 'mp4',
      resolution: `${height}p`,
      note: `${height}p Video + Audio`,
      filesize: size,
      hasVideo: true,
      hasAudio: true,
      qualityLabel: `${height}p`
    })
  }
  if (options.length === 0 && usable.length > 0) {
    options.push({
      formatId: 'bestvideo+bestaudio/best',
      ext: 'mp4',
      resolution: 'Best',
      note: 'Best video and audio',
      hasVideo: true,
      hasAudio: true,
      qualityLabel: 'Best'
    })
  }
  const audio = usable.find(
    (format) => format.vcodec === 'none' && format.acodec && format.acodec !== 'none'
  )
  if (audio) {
    options.push({
      formatId: 'bestaudio/best',
      ext: 'm4a',
      resolution: 'Audio only',
      note: audio.acodec,
      filesize: audio.filesize || audio.filesize_approx,
      hasVideo: false,
      hasAudio: true,
      qualityLabel: 'Audio'
    })
  }
  return options
}
