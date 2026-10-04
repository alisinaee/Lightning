import type { DownloadState, GroupInfo, PendingGroupItem } from '../../shared/types'
import { describeError } from '../../shared/errors'
import type { DownloadManager } from '../download/downloadManager'
import type { NetworkMonitor } from '../network/interfaces'
import { assignFiles, type Lane } from './assignFiles'
import type { GroupStore } from './groupStore'

// An auto group finishes its files as soon as it can by giving each one a network of its own: a
// network is a lane, one file runs on it at a time, and the next file waits for a lane to free.
// Which file goes on which lane is decided again as files finish and speeds are learned.

const TICK_MS = 1000
/** How long the first file runs over every network before their speeds are taken as measured. */
const MEASURE_MS = 8000
/** How much a new speed sample counts against what is known (the rest is what was known). */
const SPEED_WEIGHT = 0.3

const isLive = (state: DownloadState): boolean =>
  state.status === 'downloading' || state.status === 'queued' || state.status === 'paused'

export class AutoScheduler {
  /** Groups the scheduler may start files for: one made or added to in this session, or one the
   * user resumed. After a relaunch a group stays as it was until then, like any download. */
  private active = new Set<string>()
  /** Each network's speed as measured, kept across groups. */
  private speeds = new Map<string, number>()
  private measuring = new Map<string, { startedAt: number; downloadId: string | null }>()
  private measured = new Set<string>()
  /** Lanes (`group:network`) and files being started, which the downloads don't show yet. */
  private starting = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private ticking = false

  constructor(
    private manager: DownloadManager,
    private store: GroupStore,
    private networks: NetworkMonitor
  ) {}

  run(): void {
    this.timer ??= setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** The group has files to start. */
  activate(groupId: string): void {
    this.active.add(groupId)
  }

  forget(groupId: string): void {
    this.active.delete(groupId)
    this.measuring.delete(groupId)
    this.measured.delete(groupId)
  }

  /** The group went manual: the files waiting start now, through the normal queue. */
  async startPending(group: GroupInfo): Promise<void> {
    for (const item of group.pending) {
      if (item.error || this.starting.has(item.id)) continue
      await this.startItem(group, item, group.interfaceIds, false)
    }
  }

  private async startItem(
    group: GroupInfo,
    item: PendingGroupItem,
    interfaceIds: string[],
    lane: boolean
  ): Promise<string | null> {
    this.starting.add(item.id)
    try {
      const id = await this.manager.start({
        ...item.request,
        destinationDir: group.destinationDir,
        interfaceIds,
        groupId: group.id,
        groupLane: lane
      })
      this.store.removePending(group.id, item.id)
      return id
    } catch (error) {
      this.store.failPending(group.id, item.id, describeError(error))
      return null
    } finally {
      this.starting.delete(item.id)
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      for (const group of this.store.list()) {
        if (group.mode === 'auto') await this.schedule(group)
      }
    } catch {
      // Tried again next tick.
    } finally {
      this.ticking = false
    }
  }

  private async schedule(group: GroupInfo): Promise<void> {
    const present = new Set(this.networks.selectable().map((iface) => iface.id))
    const lanes = group.interfaceIds.filter((id) => present.has(id))
    const states = this.manager.groupDownloads(group.id).filter(isLive)
    this.learnSpeeds(states)
    // The user resumed one: the group is theirs to run again.
    if (states.some((state) => state.status === 'downloading')) this.active.add(group.id)
    if (!this.active.has(group.id) || lanes.length === 0) return

    const waiting = group.pending.filter((item) => !item.error && !this.starting.has(item.id))
    this.moveOffGoneNetworks(states, lanes)

    if (this.measuring.has(group.id)) {
      if (!this.finishMeasuring(group.id, states, lanes)) return
    } else if (
      waiting.length > 0 &&
      states.length === 0 &&
      lanes.length > 1 &&
      !this.measured.has(group.id)
    ) {
      // Nothing is known of the networks yet: the first file runs over all of them to find out.
      const id = await this.startItem(group, waiting[0], lanes, true)
      this.measuring.set(group.id, { startedAt: Date.now(), downloadId: id })
      if (!id) this.measuring.delete(group.id)
      this.measured.add(group.id)
      return
    }
    if (waiting.length === 0) return

    // Lanes with a file on them; a file on several networks holds them all.
    const busy = new Map<string, number>()
    for (const state of states) {
      const used = state.networks.filter((network) => network.enabled && lanes.includes(network.id))
      const left = Math.max(0, state.totalBytes - state.bytesDownloaded)
      for (const network of used) {
        busy.set(network.id, (busy.get(network.id) ?? 0) + left / used.length)
      }
    }
    const known = lanes.map((id) => this.speeds.get(id)).filter((speed) => speed !== undefined)
    const fallback =
      known.length > 0 ? known.reduce((sum, speed) => sum + speed, 0) / known.length : 1
    const laneInfo: Lane[] = lanes.map((id) => ({
      id,
      speed: Math.max(this.speeds.get(id) ?? fallback, 1),
      busyBytes: busy.get(id) ?? 0
    }))
    const plan = assignFiles(
      waiting.map((item) => item.request.totalBytes),
      laneInfo
    )
    for (const lane of lanes) {
      const key = `${group.id}:${lane}`
      if (busy.has(lane) || this.starting.has(key)) continue
      const index = plan.order.find((candidate) => plan.laneIds[candidate] === lane)
      if (index === undefined) continue
      this.starting.add(key)
      void this.startItem(group, waiting[index], [lane], true).finally(() =>
        this.starting.delete(key)
      )
    }
  }

  /** Keeps an average of what each network has delivered over the downloads running on it. */
  private learnSpeeds(states: DownloadState[]): void {
    const sums = new Map<string, number>()
    for (const state of states) {
      if (state.status !== 'downloading') continue
      for (const network of state.networks) {
        if (network.speedBytesPerSec <= 0) continue
        sums.set(network.id, (sums.get(network.id) ?? 0) + network.speedBytesPerSec)
      }
    }
    for (const [id, sample] of sums) {
      const before = this.speeds.get(id)
      this.speeds.set(
        id,
        before === undefined ? sample : before * (1 - SPEED_WEIGHT) + sample * SPEED_WEIGHT
      )
    }
  }

  /** Whether the measuring is over. Once it is, the first file keeps to the fastest network and
   * the others are free for the rest. */
  private finishMeasuring(groupId: string, states: DownloadState[], lanes: string[]): boolean {
    const measure = this.measuring.get(groupId)
    if (!measure) return true
    const first = states.find((state) => state.id === measure.downloadId)
    if (first?.status === 'downloading' && Date.now() - measure.startedAt < MEASURE_MS) {
      return false
    }
    this.measuring.delete(groupId)
    if (first && first.networks.filter((network) => network.enabled).length > 1) {
      const best = lanes
        .filter((id) => first.networks.some((network) => network.id === id && network.enabled))
        .sort((a, b) => (this.speeds.get(b) ?? 0) - (this.speeds.get(a) ?? 0))[0]
      for (const network of first.networks) {
        if (network.enabled && network.id !== best) {
          void this.manager.setNetworkEnabled(first.id, network.id, false)
        }
      }
    }
    return true
  }

  /** A file whose network is gone moves to one that is there. */
  private moveOffGoneNetworks(states: DownloadState[], lanes: string[]): void {
    for (const state of states) {
      if (state.status !== 'downloading') continue
      const enabled = state.networks.filter((network) => network.enabled)
      if (enabled.length === 0 || enabled.some((network) => lanes.includes(network.id))) continue
      const best = [...lanes].sort(
        (a, b) => (this.speeds.get(b) ?? 0) - (this.speeds.get(a) ?? 0)
      )[0]
      void this.manager
        .setNetworkEnabled(state.id, best, true)
        .then(() =>
          Promise.all(
            enabled.map((network) => this.manager.setNetworkEnabled(state.id, network.id, false))
          )
        )
        .catch(() => {})
    }
  }
}
