import { runYtDlp } from './binary'
import type { YoutubeFormatOption, YoutubeVideoMeta } from '../../shared/youtube'

interface RawFormat {
  format_id: string
  ext: string
  resolution?: string
  width?: number
  height?: number
  fps?: number
  vcodec?: string
  acodec?: string
  filesize?: number
  filesize_approx?: number
  format_note?: string
}

interface RawYtDlpMeta {
  id: string
  title: string
  webpage_url?: string
  thumbnail?: string
  duration?: number
  channel?: string
  uploader?: string
  description?: string
  formats?: RawFormat[]
}

const COMMON_RESOLUTIONS = [
  { height: 2160, label: '4K (2160p)' },
  { height: 1440, label: '2K (1440p)' },
  { height: 1080, label: 'Full HD (1080p)' },
  { height: 720, label: 'HD (720p)' },
  { height: 480, label: 'SD (480p)' },
  { height: 360, label: 'Low (360p)' }
]

export async function probeYoutube(url: string, proxy?: string): Promise<YoutubeVideoMeta> {
  // A stalled connection fails after 20s with yt-dlp's own message, not after the whole wait.
  const args = ['--dump-single-json', '--no-warnings', '--no-playlist', '--socket-timeout', '20']
  if (proxy) {
    args.push('--proxy', proxy)
  }
  args.push(url)

  // Probing YouTube runs JavaScript challenge solving and can take well over 30s on
  // slow links, so give it more room before reporting a timeout.
  const { code, stdout, stderr } = await runYtDlp(args, 90_000)
  if (code !== 0 || !stdout.trim()) {
    throw new Error(stderr.trim() || `Failed to probe video: exit code ${code}`)
  }

  const raw = JSON.parse(stdout) as RawYtDlpMeta
  const rawFormats = raw.formats ?? []

  // Check which heights are available
  const availableHeights = new Set<number>()
  for (const f of rawFormats) {
    if (f.height && f.vcodec && f.vcodec !== 'none') {
      availableHeights.add(f.height)
    }
  }

  const formats: YoutubeFormatOption[] = []

  // 1. Video + Audio presets for each available resolution
  for (const res of COMMON_RESOLUTIONS) {
    const matchingHeight = [...availableHeights].find((h) => Math.abs(h - res.height) <= 20)
    if (matchingHeight || res.height <= 1080) {
      // Estimate size
      const sample = rawFormats.find((f) => f.height === matchingHeight)
      const size = sample?.filesize || sample?.filesize_approx

      formats.push({
        formatId: `bestvideo[height<=${res.height}]+bestaudio/best[height<=${res.height}]`,
        ext: 'mp4',
        resolution: res.label,
        note: sample?.format_note ?? `${res.height}p Video + Audio`,
        filesize: size,
        hasVideo: true,
        hasAudio: true,
        qualityLabel: `${res.height}p`
      })
    }
  }

  // 2. Best Audio option
  const audioSample = rawFormats.find((f) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none')
  formats.push({
    formatId: 'bestaudio/best',
    ext: 'm4a',
    resolution: 'Audio only (Best Quality)',
    note: audioSample?.acodec ?? 'High Quality Audio',
    filesize: audioSample?.filesize || audioSample?.filesize_approx,
    hasVideo: false,
    hasAudio: true,
    qualityLabel: 'Audio'
  })

  return {
    id: raw.id,
    title: raw.title ?? 'YouTube Video',
    url: raw.webpage_url ?? url,
    thumbnail: raw.thumbnail,
    duration: raw.duration,
    channel: raw.channel ?? raw.uploader,
    description: raw.description?.slice(0, 500),
    formats
  }
}
