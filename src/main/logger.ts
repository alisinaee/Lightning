import { app } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
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
  const line = `${new Date().toISOString()} ${level.padEnd(5)} [${scope}] ${message}${extra}\n`
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
