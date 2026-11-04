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
