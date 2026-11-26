import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { volumeRootOf } from '../shared/volumes'
import { log } from './logger'

// Auto sync: a finished download, YouTube video or Telegram file leaves its list once its file has
// gone (moved or deleted). Only the record goes: a file is never touched here.

const SYNC_EVERY_MS = 5_000

/** A path that does not exist, as opposed to one that could not be checked (permission denied). */
function absent(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** Whether a file is certainly gone. Only a path that does not exist counts, on a disk that is
 * connected, in a folder that can be read: anything else may still be there, only out of reach. */
export async function isFileGone(path: string): Promise<boolean> {
  try {
    await stat(path)
    return false
  } catch (error) {
    if (!absent(error)) return false
  }
  // An unplugged disk: the files on it are not gone, only out of reach.
  const volume = await stat(volumeRootOf(path)).then(
    () => true,
    () => false
  )
  if (!volume) return false
  try {
    await access(dirname(path), constants.R_OK)
    return true
  } catch (error) {
    return absent(error)
  }
}

/** Drops the records of one list whose files are gone, and says how many. */
export type FinishedSource = () => Promise<number>

const sources = new Set<FinishedSource>()
let timer: NodeJS.Timeout | null = null
let running: Promise<void> | null = null
let onRemoved: (() => void) | null = null

/** A list that keeps finished files registers here once; each run asks every list. */
export function addFinishedSource(source: FinishedSource): void {
  sources.add(source)
}

async function runSources(): Promise<void> {
  let removed = 0
  for (const source of sources) {
    removed += await source().catch((error: unknown) => {
      log.warn(
        'download',
        `auto sync skipped a list: ${String((error as Error)?.message ?? error)}`
      )
      return 0
    })
  }
  if (removed > 0) onRemoved?.()
}

/** Checks every list now. A run already going is the one waited for, so two never overlap. */
export function syncFinished(): Promise<void> {
  running ??= runSources().finally(() => {
    running = null
  })
  return running
}

/** Auto sync is on: checks now, then every few seconds, until stopped. `notify` is called when
 * something was taken out of a list, so the window shows it. */
export function startFinishedSync(notify: () => void): void {
  onRemoved = notify
  if (timer) return
  void syncFinished()
  timer = setInterval(() => void syncFinished(), SYNC_EVERY_MS)
  timer.unref()
}

/** Auto sync is off: no more checks on a timer (a window focus still checks, and finds nothing). */
export function stopFinishedSync(): void {
  if (timer) clearInterval(timer)
  timer = null
}
