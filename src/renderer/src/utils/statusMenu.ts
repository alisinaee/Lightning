import type { DownloadState } from '@shared/types'

/** The order the status menu lists the downloads that are running, first to last. The menu shows
 * only as many as Settings → Status bar allows, so this decides which ones make the cut.
 *
 * Today: the fastest first, so the menu shows what is using the connection. */
export function rankRunning(running: DownloadState[]): DownloadState[] {
  // TODO(human): choose the order. Some options: fastest first (what is using the connection),
  // soonest to finish first (`timeLeftSeconds`, smallest first, those without one last), or the
  // ones that have been running longest (`startedAt`). Whatever you pick must not change the
  // input array.
  return [...running].sort((a, b) => b.speedBytesPerSec - a.speedBytesPerSec)
}
