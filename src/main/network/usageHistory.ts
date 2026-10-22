import { join } from 'node:path'
import { app } from 'electron'
import type { UsageHistoryQuery, UsageHistoryResult } from '../../shared/types'
import { readJson, updateJson } from '../jsonFile'

// What each network received, for which file, minute by minute: the data behind the Usage page's
// charts. Minutes older than FINE_MS are folded into hours, so a year of history stays small.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const FINE_MS = 3 * 24 * HOUR
const SAVE_MS = 30_000
const MAX_NAMES = 5000

/** [bucket start, network id, download id, bytes] */
type Row = [number, string, string, number]

export class UsageHistory {
  private rows = new Map<string, Row>()
  private names: Record<string, string> = {}
  private saveTimer: NodeJS.Timeout | null = null
  readonly loaded: Promise<void>

  constructor() {
    this.loaded = this.load()
  }

  private path(): string {
    return join(app.getPath('userData'), 'usage-history.json')
  }

  private async load(): Promise<void> {
    try {
      const data = (await readJson(this.path())) as
        { rows?: Row[]; names?: Record<string, string> } | undefined
      if (data?.names) this.names = data.names
      for (const row of data?.rows ?? []) {
        if (Array.isArray(row) && row.length === 4) this.add(row[0], row[1], row[2], row[3])
      }
    } catch {
      // Unreadable now: start empty in memory, and the next save writes what was counted since.
    }
  }

  private add(time: number, network: string, download: string, bytes: number): void {
    const key = `${time}|${network}|${download}`
    const row = this.rows.get(key)
    if (row) row[3] += bytes
    else this.rows.set(key, [time, network, download, bytes])
  }

  record(networkId: string, downloadId: string, fileName: string, bytes: number): void {
    if (!(bytes > 0)) return
    this.names[downloadId] = fileName
    this.add(Math.floor(Date.now() / MINUTE) * MINUTE, networkId, downloadId, bytes)
    this.saveTimer ??= setTimeout(() => void this.save(), SAVE_MS)
  }

  /** Folds old minutes into hours, and drops names nothing refers to any more. */
  private compact(now: number): void {
    const cutoff = now - FINE_MS
    const folded = new Map<string, Row>()
    for (const row of this.rows.values()) {
      const time = row[0] < cutoff ? Math.floor(row[0] / HOUR) * HOUR : row[0]
      const key = `${time}|${row[1]}|${row[2]}`
      const existing = folded.get(key)
      if (existing) existing[3] += row[3]
      else folded.set(key, [time, row[1], row[2], row[3]])
    }
    this.rows = folded
    const used = new Set([...folded.values()].map((row) => row[2]))
    const names = Object.keys(this.names)
    if (names.length > MAX_NAMES) {
      for (const id of names) if (!used.has(id)) delete this.names[id]
    }
  }

  async save(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    await this.loaded
    this.compact(Date.now())
    const snapshot = { version: 1, names: { ...this.names }, rows: [...this.rows.values()] }
    await updateJson(this.path(), () => snapshot).catch(() => {})
  }

  /** Totals for the last `rangeMs` (everything for null), by network and by file, and a series
   * of `bucketMs` slices for the chart. `network` narrows it all to that network. */
  query({ rangeMs, bucketMs, network }: UsageHistoryQuery): UsageHistoryResult {
    const now = Date.now()
    const from = rangeMs === null ? 0 : now - rangeMs
    const byNetwork: Record<string, number> = {}
    const byFile = new Map<string, { bytes: number; byNetwork: Record<string, number> }>()
    const slices = new Map<number, Record<string, number>>()
    let total = 0
    let first = now
    for (const [time, net, download, bytes] of this.rows.values()) {
      // An hour-wide row counts when any of it falls in the range.
      if (time + (time < now - FINE_MS ? HOUR : MINUTE) <= from) continue
      if (network && net !== network) continue
      total += bytes
      first = Math.min(first, time)
      byNetwork[net] = (byNetwork[net] ?? 0) + bytes
      const file = byFile.get(download) ?? { bytes: 0, byNetwork: {} }
      file.bytes += bytes
      file.byNetwork[net] = (file.byNetwork[net] ?? 0) + bytes
      byFile.set(download, file)
      const slice = Math.floor(time / bucketMs) * bucketMs
      const at = slices.get(slice) ?? {}
      at[net] = (at[net] ?? 0) + bytes
      slices.set(slice, at)
    }
    const start = Math.floor((rangeMs === null ? first : from) / bucketMs) * bucketMs
    const series: UsageHistoryResult['series'] = []
    for (let t = start; t <= now; t += bucketMs)
      series.push({ time: t, byNetwork: slices.get(t) ?? {} })
    const files = [...byFile.entries()]
      .map(([id, file]) => ({ id, name: this.names[id] ?? id, ...file }))
      .sort((a, b) => b.bytes - a.bytes)
    return { total, byNetwork, files, series, bucketMs }
  }
}
