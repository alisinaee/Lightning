// Reading tdl's output. tdl draws its progress with a terminal-redrawing library and has no
// machine-readable mode, so this is deliberately forgiving: the poller in tdlJobs (file sizes on
// disk) is the source of truth, and what is parsed here only adds file names, totals and speeds.

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const ANSI = new RegExp(
  String.raw`${ESC}\[[0-9;?]*[A-Za-z]|${ESC}[78]|${ESC}\][^${BEL}]*${BEL}`,
  'g'
)

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

/** "12.5MB", "1.2 GiB", "340KB" to bytes. */
export function parseSize(text: string): number {
  const match = /^([\d.]+)\s*([KMGT]?)(i?)B?$/i.exec(text.trim())
  if (!match) return 0
  const unit = match[2].toUpperCase()
  const base = match[3] ? 1024 : 1000
  const power = unit ? 'KMGT'.indexOf(unit) + 1 : 0
  return Math.round(parseFloat(match[1]) * Math.pow(base, power))
}

export interface ProgressUpdate {
  /** The file name tdl shows (by default <dialog>_<message>_<name>). */
  name: string
  received: number
  total: number
  speed: number
}

const SIZE = '(\\d+(?:\\.\\d+)?\\s?[KMGT]?i?B)'
const PAIR = new RegExp(`${SIZE}\\s*/\\s*${SIZE}`, 'i')
const SPEED = new RegExp(`${SIZE}\\s*/\\s*s`, 'i')
const NAME = /(\d+_\d+_[^\s[\]|]+(?:\s[^\s[\]|]+)*?\.[A-Za-z0-9]{1,8})(?=\s|\[|\||$)/

/** One line of tdl output: a progress line gives an update, anything else null. */
export function parseProgressLine(raw: string): ProgressUpdate | null {
  const line = stripAnsi(raw).trim()
  if (!line) return null
  const name = NAME.exec(line)?.[1]
  const pair = PAIR.exec(line)
  if (!name || !pair) return null
  const speed = SPEED.exec(line.slice(pair.index + pair[0].length))
  return {
    name,
    received: parseSize(pair[1]),
    total: parseSize(pair[2]),
    speed: speed ? parseSize(speed[1]) : 0
  }
}

/** Joins output chunks into lines; carriage returns count as line ends, since progress bars redraw. */
export class LineSplitter {
  private rest = ''

  push(chunk: string): string[] {
    const parts = (this.rest + chunk).split(/\r\n|\r|\n/)
    this.rest = parts.pop() ?? ''
    return parts
  }
}

/** Seconds a FLOOD_WAIT line asks for, or null. */
export function floodWaitSeconds(text: string): number | null {
  const match = /FLOOD_WAIT[_ (]*(\d+)|wait(?:ing)? (?:of )?(\d+) ?s(?:econds)?/i.exec(text)
  const value = match ? Number(match[1] ?? match[2]) : NaN
  return Number.isFinite(value) ? value : null
}

/** The message ids a line of log or output is about: "<dialog>_<message>_" file names. */
export function messageIdOf(text: string): string | null {
  return /\b\d+_(\d+)_/.exec(text)?.[1] ?? null
}

export function isErrorLine(line: string): boolean {
  return /\b(error|failed|failure)\b|FLOOD_WAIT|\bERR\b/i.test(line)
}
