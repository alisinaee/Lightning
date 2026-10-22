import type { DownloadState } from '@shared/types'

/** The order the status menu lists the downloads that are running, first to last. The menu shows
 * only as many as Settings → Status bar allows, so this decides which ones make the cut.
 *
 * Fastest first, so the menu shows what is using the connection. This matches the Networks
 * section above it, which also sorts by speed. Returns a new array; the input is not changed. */
export function rankRunning(running: DownloadState[]): DownloadState[] {
  return [...running].sort((a, b) => b.speedBytesPerSec - a.speedBytesPerSec)
}
