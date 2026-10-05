import { powerMonitor, type BrowserWindow } from 'electron'
import { IpcChannels } from '../shared/ipc-channels'
import {
  ALWAYS_ALLOWED,
  DEFAULT_SCHEDULE,
  scheduleStatus,
  type ScheduleSettings,
  type ScheduleStatus
} from '../shared/schedule'
import type { DownloadManager } from './download/downloadManager'

/** The longest a timer may be set for. */
const MAX_TIMER_MS = 2 ** 31 - 1

/** Applies the weekly schedule to the downloads: at each window's start or end, it tells the
 * manager to hold or release them and to cap their speed, and tells the window. */
export class ScheduleController {
  private settings: ScheduleSettings = { ...DEFAULT_SCHEDULE }
  private timer: NodeJS.Timeout | undefined
  status: ScheduleStatus = ALWAYS_ALLOWED

  constructor(
    private manager: DownloadManager,
    private getWindow: () => BrowserWindow | null
  ) {
    // A timer set before the computer slept is late after it, and the clock may have moved.
    powerMonitor.on('resume', () => this.evaluate())
  }

  /** Takes up the schedule in Settings. */
  apply(settings: ScheduleSettings | undefined): void {
    this.settings = settings ?? { ...DEFAULT_SCHEDULE }
    this.evaluate()
  }

  private evaluate(): void {
    clearTimeout(this.timer)
    const now = new Date()
    this.status = scheduleStatus(this.settings, now)
    this.manager.applySchedule(this.status.allow, this.status.cap)
    const window = this.getWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send(IpcChannels.scheduleChanged, this.status)
    }
    if (this.status.nextChange !== null) {
      // A second past the boundary, so the minute has really turned.
      const wait = Math.min(MAX_TIMER_MS, this.status.nextChange - now.getTime() + 1000)
      this.timer = setTimeout(() => this.evaluate(), Math.max(1000, wait))
    }
  }
}
