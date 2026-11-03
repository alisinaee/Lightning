import { fileKind } from './fileKind'

// What Lightning and the bundled tdl program (Telegram downloads) tell each other about. A tdl job
// is not a DownloadState: it has its own list, its own screen and its own process.

export type TgMediaKind = 'video' | 'photo' | 'audio' | 'document' | 'other'

export type TdlJobStatus =
  'queued' | 'exporting' | 'running' | 'paused' | 'completed' | 'error' | 'cancelled'

/** One message's file within a job. */
export interface TdlItem {
  /** `${chat}/${msg}` */
  key: string
  link?: string
  fileName: string
  media: TgMediaKind
  received: number
  total: number
  /** Bytes a second. */
  speed: number
  status: 'waiting' | 'downloading' | 'done' | 'skipped' | 'failed'
  path?: string
  error?: string
}

export interface TdlJob {
  id: string
  source:
    | { type: 'links'; links: string[] }
    | { type: 'export'; chat: string; range: string; file: string }
  dir: string
  status: TdlJobStatus
  items: TdlItem[]
  createdAt: number
  finishedAt?: number
  error?: string
  pid?: number
}

export interface TdlStatus {
  /** The tdl program is there and runs. */
  binary: boolean
  version?: string
  loggedIn: boolean
  /** Name or @user only. */
  account?: string
}

export type TdlLoginMode = 'qr' | 'code' | 'desktop'

export type TdlLoginEvent =
  | { type: 'qr'; ascii: string }
  | { type: 'prompt'; field: 'phone' | 'code' | 'password' }
  | { type: 'done'; account: string }
  | { type: 'error'; message: string }

export interface TdlChat {
  id: string
  title: string
  type: string
}

export type TdlRangeType = 'time' | 'id' | 'last'

export const MAX_TELEGRAM_LINKS = 500

const LINK = /^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/(.+)$/i

/** The message links in a piece of text: t.me/<user>/<id>, t.me/c/<chat>/<id>, t.me/<user>/<topic>/<id>
 * (also telegram.me, with ?single or ?comment=). Split on whitespace, de-duplicated, at most 500.
 * Invite links and links without a message id are dropped. */
export function parseTelegramLinks(text: string): string[] {
  const found = new Set<string>()
  for (const word of text.split(/\s+/)) {
    if (found.size >= MAX_TELEGRAM_LINKS) break
    // Chat apps wrap links in brackets or follow them with punctuation.
    const match = LINK.exec(word.replace(/^[<([]+|[>)\].,;]+$/g, ''))
    if (!match) continue
    const [path] = match[1].split(/[?#]/)
    const parts = path.split('/').filter(Boolean)
    if (parts.length < 2 || parts.length > 4) continue
    const [head] = parts
    if (head.startsWith('+') || head.toLowerCase() === 'joinchat') continue
    const isPrivate = head === 'c'
    // c/<chat>/<id> or c/<chat>/<topic>/<id>; <user>/<id> or <user>/<topic>/<id>.
    const ids = isPrivate ? parts.slice(1) : parts
    const chatOk = isPrivate ? /^\d+$/.test(ids[0] ?? '') : /^[A-Za-z][A-Za-z0-9_]{3,}$/.test(head)
    const rest = isPrivate ? ids.slice(1) : parts.slice(1)
    if (!chatOk || rest.length < 1 || rest.length > 2 || !rest.every((id) => /^\d+$/.test(id))) {
      continue
    }
    // ?single and ?comment= only say how Telegram shows the message, so they are left off.
    found.add(`https://t.me/${parts.join('/')}`)
  }
  return [...found]
}

/** Which Telegram group a file belongs to: its MIME type first, then its name's extension.
 * Voice notes (.oga, .ogg) are audio, round videos are video, stickers are photos or other. */
export function mediaKindOf(fileName: string, mime?: string): TgMediaKind {
  const type = (mime ?? '').toLowerCase()
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('image/')) return 'photo'
  if (type.startsWith('audio/')) return 'audio'
  if (/\.tgs$/i.test(fileName)) return 'other'
  if (/\.webp$/i.test(fileName)) return 'photo'
  switch (fileKind(fileName)) {
    case 'video':
      return 'video'
    case 'image':
      return 'photo'
    case 'audio':
      return 'audio'
    case 'document':
    case 'archive':
      return 'document'
    default:
      return 'other'
  }
}
