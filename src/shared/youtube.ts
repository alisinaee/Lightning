export interface YoutubeFormatOption {
  formatId: string
  ext: string
  resolution: string
  note?: string
  filesize?: number
  hasVideo: boolean
  hasAudio: boolean
  vcodec?: string
  acodec?: string
  fps?: number
  qualityLabel?: string
}

export interface YoutubeVideoMeta {
  id: string
  title: string
  url: string
  thumbnail?: string
  duration?: number
  channel?: string
  description?: string
  formats: YoutubeFormatOption[]
}

export type YoutubeJobStatus =
  'queued' | 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'

export interface YoutubeJob {
  id: string
  url: string
  title: string
  thumbnail?: string
  formatId: string
  resolution: string
  destDir: string
  fileName?: string
  status: YoutubeJobStatus
  received: number
  total: number
  speed: number
  eta?: number
  percent: number
  error?: string
  /** The playlist this video belongs to (a group), when it came from one. */
  groupId?: string
  groupTitle?: string
  createdAt: number
  finishedAt?: number
  pid?: number
}

export interface YoutubeStatus {
  binary: boolean
  version?: string
  ffmpeg: boolean
}

export interface StartYoutubeRequest {
  url: string
  title: string
  thumbnail?: string
  formatId: string
  resolution: string
  destDir?: string
  /** The browser video the person confirmed in the add dialog (its cookies come with it). */
  offerId?: string
}

const YOUTUBE_REGEX =
  /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|v\/|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i

export function isYoutubeUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false
  return YOUTUBE_REGEX.test(url.trim())
}

export function extractYoutubeId(url: string): string | null {
  const match = YOUTUBE_REGEX.exec(url.trim())
  return match ? match[1] : null
}

export type YoutubeQuality = 'best' | '2160' | '1440' | '1080' | '720' | '480' | '360' | 'audio'

/** What the YouTube downloader does by default. Every download reads these when it starts. */
export interface YoutubeOptions {
  // ---- Common ----
  quality: YoutubeQuality
  /** Where finished files go. Empty means the Downloads folder. */
  folder: string
  /** On: a fetched video starts at the quality above without asking. Off: the person picks each time. */
  autoStartDefault: boolean
  /** 'none': no cookies. 'saved': the cookies Lightning keeps. 'manual': a cookies.txt the person picked. */
  cookieMode: 'none' | 'saved' | 'manual'
  manualCookiesFile: string
  /** 'single': only the video. 'full': every video in a playlist, into a folder named for it. */
  playlist: 'single' | 'full'
  subtitles: boolean
  subtitleLangs: string
  metadata: boolean
  embedThumbnail: boolean
  /** Container for merged video. */
  mergeFormat: 'mp4' | 'mkv' | 'webm'
  /** Format for audio-only downloads. */
  audioFormat: 'm4a' | 'mp3' | 'opus' | 'flac' | 'wav'
  /** Chapter markers inside the file. */
  embedChapters: boolean
  /** SponsorBlock: 'off', 'mark' (chapters for sponsor segments) or 'remove' (cut them out). */
  sponsorBlock: 'off' | 'mark' | 'remove'

  // ---- Advanced ----
  /** A yt-dlp format selector that replaces the quality choice. Empty uses the quality. */
  formatOverride: string
  /** A yt-dlp -S sort order, e.g. "res:1080,fps". Empty uses yt-dlp's default. */
  formatSort: string
  /** Output file name template, relative to the folder. */
  outputTemplate: string
  restrictFilenames: boolean
  windowsFilenames: boolean
  /** Speed limit, e.g. "2M" or "500K". Empty means no limit. */
  limitRate: string
  /** Parallel fragments for segmented streams (1-16). */
  concurrentFragments: number
  /** Retries for failed requests and fragments (0-50). */
  retries: number
  /** Seconds to wait before each request (0-60). */
  sleepInterval: number
  /** Seconds before a request gives up (5-300). */
  socketTimeout: number
  /** Only videos uploaded on or after this date, YYYYMMDD. Empty means no limit. */
  dateAfter: string
  /** Only videos uploaded on or before this date, YYYYMMDD. Empty means no limit. */
  dateBefore: string
  /** Stop a run after this many files (0 means no limit). */
  maxDownloads: number
  /** Which playlist items to take, e.g. "1-10,15". Empty means all. */
  playlistItems: string
  /** Skip videos already downloaded (keeps a list in Lightning's data folder). */
  skipDownloaded: boolean
  /** Browser impersonation for sites that block plain clients. Empty means off. */
  impersonate: '' | 'chrome' | 'safari' | 'firefox'
  /** Keep a .info.json next to each file. */
  writeInfoJson: boolean
  /** Keep the description as a .description file. */
  writeDescription: boolean
  /** Keep the thumbnail as its own image file. */
  writeThumbnail: boolean
  /** Set the file's date from the website's upload date. */
  useRemoteTime: boolean
  /** Do not overwrite a file that is already there. */
  noOverwrites: boolean
}

export const DEFAULT_YOUTUBE_OPTIONS: YoutubeOptions = {
  quality: '1080',
  folder: '',
  autoStartDefault: false,
  cookieMode: 'none',
  manualCookiesFile: '',
  playlist: 'single',
  subtitles: false,
  subtitleLangs: 'en.*',
  metadata: true,
  embedThumbnail: false,
  mergeFormat: 'mp4',
  audioFormat: 'm4a',
  embedChapters: false,
  sponsorBlock: 'off',

  formatOverride: '',
  formatSort: '',
  outputTemplate: '%(title)s [%(id)s].%(ext)s',
  restrictFilenames: false,
  windowsFilenames: false,
  limitRate: '',
  concurrentFragments: 1,
  retries: 10,
  sleepInterval: 0,
  socketTimeout: 20,
  dateAfter: '',
  dateBefore: '',
  maxDownloads: 0,
  playlistItems: '',
  skipDownloaded: false,
  impersonate: '',
  writeInfoJson: false,
  writeDescription: false,
  writeThumbnail: false,
  useRemoteTime: false,
  noOverwrites: false
}

/** The yt-dlp format selector for a quality. Video is merged into one MP4 (needs ffmpeg). */
export function formatForQuality(quality: YoutubeQuality): string {
  if (quality === 'audio') return 'bestaudio/best'
  if (quality === 'best') return 'bestvideo+bestaudio/best'
  return `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]`
}
