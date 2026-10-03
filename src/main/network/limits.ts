import { join } from 'node:path'
import { app } from 'electron'
import type { AppSettings } from '../../shared/types'
import { readJson, updateJson } from '../jsonFile'

// Speed and data limits, for every download together: what the user sets in Speed & data limits.
// Every byte Plexo receives passes through take(), on the network it came in on — an HTTP
// response's body and a torrent peer's socket alike — which says how long to stop reading for.
// Stopping reading is what slows the sender: TCP's window fills, and it waits.

/** A rate as a bucket of tokens (bytes) that refills at `rate` per second. Taking more than it
 * holds leaves it in debt, and the debt is the wait. A second's worth is all it ever holds, so a
 * quiet spell doesn't buy a burst over the limit. */
class Bucket {
  private tokens = 0
  private at = Date.now()

  constructor(public rate: number) {}

  /** Takes `bytes`, and says how many ms to wait before taking more. */
  take(bytes: number, now: number): number {
    this.tokens = Math.min(this.rate, this.tokens + ((now - this.at) / 1000) * this.rate)
    this.at = now
    this.tokens -= bytes
    return this.tokens >= 0 ? 0 : (-this.tokens / this.rate) * 1000
  }
}

/** This month, as usage is counted by: "2026-10". */
function monthOf(time: number): string {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

const USAGE_SAVE_MS = 10_000

export class Limits {
  private total: Bucket | null = null
  private perNetwork = new Map<string, Bucket>()
  /** Each network's data limit for the month, in bytes. */
  private dataLimits = new Map<string, number>()
  private usage: { month: string; bytes: Record<string, number> } = {
    month: monthOf(Date.now()),
    bytes: {}
  }
  private saveTimer: NodeJS.Timeout | null = null
  readonly loaded: Promise<void>

  /** `onLimitReached` is told when a network uses up its data for the month. */
  constructor(private readonly onLimitReached: () => void) {
    this.loaded = readJson(this.usagePath())
      .then((saved) => {
        const { month, bytes } = (saved ?? {}) as { month?: unknown; bytes?: unknown }
        if (month !== this.usage.month || typeof bytes !== 'object' || bytes === null) return
        for (const [id, used] of Object.entries(bytes)) {
          if (Number.isFinite(used) && used >= 0) this.usage.bytes[id] = used
        }
      })
      .catch(() => {})
  }

  private usagePath(): string {
    return join(app.getPath('userData'), 'network-usage.json')
  }

  /** Takes up the limits in `settings`. Slow mode, when on, stands in for the total limit. */
  configure(settings: AppSettings): void {
    const total = settings.slowMode ? settings.slowModeSpeed : settings.speedLimit
    this.total = adjust(this.total, total)
    const preferences = settings.networkPreferences ?? {}
    for (const id of new Set([...this.perNetwork.keys(), ...Object.keys(preferences)])) {
      const bucket = adjust(this.perNetwork.get(id) ?? null, preferences[id]?.speedLimit)
      if (bucket) this.perNetwork.set(id, bucket)
      else this.perNetwork.delete(id)
    }
    this.dataLimits.clear()
    for (const [id, preference] of Object.entries(preferences)) {
      if (preference.dataLimit !== undefined) this.dataLimits.set(id, preference.dataLimit)
    }
  }

  /** Counts `bytes` just received on `networkId`, and says how many ms to stop reading for. */
  take(networkId: string, bytes: number): number {
    const now = Date.now()
    this.rollMonth(now)
    const before = this.usage.bytes[networkId] ?? 0
    this.usage.bytes[networkId] = before + bytes
    this.saveTimer ??= setTimeout(() => void this.save(), USAGE_SAVE_MS)
    const limit = this.dataLimits.get(networkId)
    // Told once the caller is done with its bytes: what it does may stop the very connection
    // they came in on.
    if (limit !== undefined && before < limit && before + bytes >= limit) {
      setImmediate(this.onLimitReached)
    }
    return Math.max(
      this.total?.take(bytes, now) ?? 0,
      this.perNetwork.get(networkId)?.take(bytes, now) ?? 0
    )
  }

  /** Whether the network has used up its data for the month. */
  limitReached(networkId: string): boolean {
    this.rollMonth(Date.now())
    const limit = this.dataLimits.get(networkId)
    return limit !== undefined && (this.usage.bytes[networkId] ?? 0) >= limit
  }

  /** What each network has received this month, by id. */
  usedThisMonth(): Record<string, number> {
    this.rollMonth(Date.now())
    return { ...this.usage.bytes }
  }

  /** Writes the month's usage now (on quit; otherwise it's saved every USAGE_SAVE_MS). */
  async save(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const usage = structuredClone(this.usage)
    await updateJson(this.usagePath(), () => usage).catch(() => {})
  }

  private rollMonth(now: number): void {
    const month = monthOf(now)
    if (month !== this.usage.month) this.usage = { month, bytes: {} }
  }
}

/** The bucket for `rate` bytes a second: `current` changed in place, so a debt carries over, or
 * none for no limit. */
function adjust(current: Bucket | null, rate: number | undefined): Bucket | null {
  if (rate === undefined || !(rate > 0)) return null
  if (!current) return new Bucket(rate)
  current.rate = rate
  return current
}
