import { app } from 'electron'
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { redactUrlsIn } from '../shared/urlTools'
import { join } from 'node:path'

// One plain-text log, <userData>/logs/plexo.log, for watching what the app decides. Rotated at
// about 2 MB (one old copy, plexo.log.1). Also printed to stdout when running unpackaged.
const MAX_BYTES = 2 * 1024 * 1024

let file: string | null = null
let size = 0

function open(): string | null {
  if (file) return file
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'plexo.log')
    size = statSync(file, { throwIfNoEntry: false })?.size ?? 0
  } catch {
    file = null
  }
  return file
}

export function logFilePath(): string {
  return open() ?? ''
}

function write(level: string, scope: string, message: string, data?: unknown): void {
  let extra = ''
  if (data !== undefined) {
    try {
      extra = ' ' + (data instanceof Error ? (data.stack ?? data.message) : JSON.stringify(data))
    } catch {
      extra = ' [unprintable]'
    }
  }
  // Links in a log never carry their query string or credentials.
  const line =
    redactUrlsIn(
      `${new Date().toISOString()} ${level.padEnd(5)} [${scope}] ${message}${extra}`
    ).replace(/\n(?=.)/g, '\n    ') + '\n'
  if (!app.isPackaged) process.stdout.write(line)
  const path = open()
  if (!path) return
  try {
    if (size + line.length > MAX_BYTES) {
      renameSync(path, `${path}.1`)
      size = 0
    }
    appendFileSync(path, line)
    size += line.length
  } catch {
    // Logging must never break the app.
  }
}

export const log = {
  info: (scope: string, message: string, data?: unknown): void =>
    write('INFO', scope, message, data),
  warn: (scope: string, message: string, data?: unknown): void =>
    write('WARN', scope, message, data),
  error: (scope: string, message: string, data?: unknown): void =>
    write('ERROR', scope, message, data)
}

/** The newest `limit` lines of the log, oldest first. A stack trace's indented lines stay with
 * the line they belong to. */
export function readLog(limit: number): string[] {
  const path = open()
  if (!path) return []
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
    if (text.split('\n').length < limit) {
      text = readFileSync(`${path}.1`, 'utf8').concat(text)
    }
  } catch {
    // No older copy.
  }
  const entries: string[] = []
  for (const line of text.split('\n')) {
    if (line === '') continue
    if (/^\s/.test(line) && entries.length > 0) entries[entries.length - 1] += `\n${line}`
    else entries.push(line)
  }
  return entries.slice(-Math.max(1, limit))
}

/** Empties the log (and its old copy). */
export function clearLog(): void {
  const path = open()
  if (!path) return
  try {
    writeFileSync(path, '')
    writeFileSync(`${path}.1`, '')
    size = 0
  } catch {
    // Nothing to clear.
  }
}
