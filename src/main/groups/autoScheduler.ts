import { log } from '../logger'
import type {
  DownloadState,
  GroupInfo,
  GroupPlan,
  PendingGroupItem,
  PlanEvent,
  PlanNetwork
} from '../../shared/types'
import { describeError } from '../../shared/errors'
import type { DownloadManager } from '../download/downloadManager'
import type { NetworkMonitor } from '../network/interfaces'
import {
  newTrack,
  planGroup,
  summarize,
  sustained,
  trackNetwork,
  type PlanAction,
  type PlanNetworkInput,
  type Track
} from './planGroup'
import type { GroupStore } from './groupStore'

// An auto group finishes its files as soon as it can by giving each one a network of its own: a
// network is a lane, one file runs on it at a time, and the next file waits for a lane to free.
// Which file goes on which lane is decided again as files finish and speeds are learned.

const TICK_MS = 1000
/** How long the first file runs over every network before their speeds are taken as measured. */
const MEASURE_MS = 8000
const LOG_LIMIT = 50

/** What the scheduler knows of one group while it runs. */
interface GroupRun {
  tracks: Map<string, Track>
  /** When each file's networks last changed through the plan. */
  changedAt: Map<string, number>
  log: PlanEvent[]
  plan: GroupPlan
  planned: Record<string, string>
  fingerprint: string
}

const isLive = (state: DownloadState): boolean =>
  state.status === 'downloading' || state.status === 'queued' || state.status === 'paused'

export class AutoScheduler {
  /** Groups the scheduler may start files for: one made or added to in this session, or one the
   * user resumed. After a relaunch a group stays as it was until then, like any download. */
  private active = new Set<string>()
  /** The best speed each network has shown, kept across groups to start new ones from. */
  private baselines = new Map<string, number>()
  private runs = new Map<string, GroupRun>()
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
  ) {
    store.planOf = (group) => this.planOf(group)
  }

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
    this.runs.delete(groupId)
  }

  /** How the group is being downloaded and why (see GroupPlan). */
  planOf(group: Pick<GroupInfo, 'id' | 'mode'>): {
    plan: GroupPlan
    plannedNetworks: Record<string, string>
  } {
    if (group.mode === 'manual') {
      return {
        plan: {
          mode: 'manual',
          measuring: false,
          networks: [],
          summary: 'Manual: each file uses the connections you chose.',
          log: []
        },
        plannedNetworks: {}
      }
    }
    const run = this.runs.get(group.id)
    if (run) return { plan: run.plan, plannedNetworks: run.planned }
    return {
      plan: {
        mode: 'auto',
        measuring: false,
        networks: [],
        summary: 'Plexo picks a connection for each file as it starts.',
        log: []
      },
      plannedNetworks: {}
    }
  }

  private runOf(groupId: string): GroupRun {
    let run = this.runs.get(groupId)
    if (!run) {
      run = {
        tracks: new Map(),
        changedAt: new Map(),
        log: [],
        plan: this.planOf({ id: groupId, mode: 'auto' }).plan,
        planned: {},
        fingerprint: ''
      }
      this.runs.set(groupId, run)
    }
    return run
  }

  private note(run: GroupRun, kind: PlanEvent['kind'], text: string): void {
    log.info('auto', text)
    run.log.push({ at: Date.now(), kind, text })
    if (run.log.length > LOG_LIMIT) run.log.splice(0, run.log.length - LOG_LIMIT)
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
      this.store.movePin(group.id, item.id, id)
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
    const selectable = this.networks.selectable()
    const present = new Set(selectable.map((iface) => iface.id))
    const names = new Map(selectable.map((iface) => [iface.id, iface.displayName]))
    const lanes = group.interfaceIds.filter((id) => present.has(id))
    const states = this.manager.groupDownloads(group.id).filter(isLive)
    // The user resumed one: the group is theirs to run again.
    if (states.some((state) => state.status === 'downloading')) this.active.add(group.id)
    if (!this.active.has(group.id)) return
    const run = this.runOf(group.id)
    const nameOf = (id: string): string =>
      names.get(id) ??
      states
        .map((state) => state.networks.find((network) => network.id === id)?.label)
        .find((label) => label !== undefined) ??
      id
    const inputs: PlanNetworkInput[] = group.interfaceIds.map((id) => ({
      id,
      name: nameOf(id),
      present: present.has(id),
      track: run.tracks.get(id) ?? newTrack(this.baselines.get(id) ?? 0)
    }))
    this.learn(run, inputs, states, nameOf)
    const waiting = group.pending.filter((item) => !item.error && !this.starting.has(item.id))
    const measuring = this.measuring.has(group.id)
    const finishedPlan = (result?: ReturnType<typeof planGroup>): void =>
      this.publish(run, inputs, states, waiting.length, measuring, result)
    if (lanes.length === 0) {
      finishedPlan()
      return
    }

    if (measuring) {
      if (!this.finishMeasuring(group.id, states, inputs, run)) {
        finishedPlan()
        return
      }
    } else if (
      waiting.length > 0 &&
      states.length === 0 &&
      lanes.length > 1 &&
      !this.measured.has(group.id)
    ) {
      // Nothing is known of the networks yet: the first file runs over all of them to find out.
      const first = waiting.find((item) => !group.pinned.includes(item.id)) ?? waiting[0]
      const id = await this.startItem(group, first, lanes, true)
      this.measuring.set(group.id, { startedAt: Date.now(), downloadId: id })
      if (!id) this.measuring.delete(group.id)
      else this.note(run, 'measure', 'Started the first file on every connection to measure them.')
      this.measured.add(group.id)
      this.publish(run, inputs, states, waiting.length, !!id)
      return
    }

    const result = planGroup({
      now: Date.now(),
      networks: inputs,
      running: states
        .filter((state) => state.status === 'downloading' || state.status === 'paused')
        .map((state) => ({
          id: state.id,
          name: state.fileName,
          remaining:
            state.totalBytes > 0 ? Math.max(0, state.totalBytes - state.bytesDownloaded) : 0,
          total: state.totalBytes,
          networks: state.networks
            .filter((network) => network.enabled)
            .map((network) => network.id),
          splittable: state.kind === 'http' && state.totalBytes > 0 && state.totalBlocks > 1,
          lastChangeAt: run.changedAt.get(state.id) ?? 0,
          pinned: group.pinned.includes(state.id)
        })),
      waiting: waiting.map((item) => ({
        id: item.id,
        name: item.request.suggestedFileName,
        size: item.request.totalBytes,
        pinned: group.pinned.includes(item.id) ? item.request.interfaceIds : undefined
      }))
    })
    finishedPlan(result)
    if (result.actions.length > 0) {
      await this.apply(run, result.actions)
      // The downloads show the new networks next tick; files start then.
      return
    }
    if (waiting.length === 0) return

    // Lanes with a file on them; a file on several networks holds them all.
    const busy = new Set<string>()
    for (const state of states) {
      for (const network of state.networks) if (network.enabled) busy.add(network.id)
    }
    for (const item of waiting) {
      if (!group.pinned.includes(item.id)) continue
      const ids = item.request.interfaceIds.filter((id) => lanes.includes(id))
      if (ids.length === 0 || ids.some((id) => busy.has(id))) continue
      const keys = ids.map((id) => `${group.id}:${id}`)
      if (keys.some((key) => this.starting.has(key))) continue
      for (const key of keys) this.starting.add(key)
      void this.startItem(group, item, ids, true).finally(() => {
        for (const key of keys) this.starting.delete(key)
      })
      for (const id of ids) busy.add(id)
    }
    for (const lane of lanes) {
      const key = `${group.id}:${lane}`
      if (busy.has(lane) || this.starting.has(key)) continue
      const id = result.order.find(
        (candidate) => result.assignments[candidate] === lane && !group.pinned.includes(candidate)
      )
      const item = waiting.find((entry) => entry.id === id)
      if (!item) continue
      this.starting.add(key)
      void this.startItem(group, item, [lane], true).finally(() => this.starting.delete(key))
    }
  }

  /** Feeds each network's track the speed a file of the group had on it this second. */
  private learn(
    run: GroupRun,
    inputs: PlanNetworkInput[],
    states: DownloadState[],
    nameOf: (id: string) => string
  ): void {
    for (const input of inputs) {
      let sample: number | null = null
      if (input.present) {
        for (const state of states) {
          if (state.status !== 'downloading') continue
          const network = state.networks.find((entry) => entry.id === input.id && entry.enabled)
          if (network) sample = (sample ?? 0) + Math.max(0, network.speedBytesPerSec)
        }
      }
      const { track, change } = trackNetwork(input.track, sample, Date.now())
      input.track = track
      run.tracks.set(input.id, track)
      if (track.baseline > 0) this.baselines.set(input.id, track.baseline)
      if (!change) continue
      const name = nameOf(input.id)
      if (change.kind === 'slow') {
        this.note(run, 'slow', `${name} slowed from ${mb(change.from)} to ${mb(change.to)}.`)
      } else if (change.kind === 'recover') {
        this.note(run, 'recover', `${name} recovered to ${mb(change.to)}.`)
      } else {
        this.note(run, 'faster', `${name} sped up from ${mb(change.from)} to ${mb(change.to)}.`)
      }
    }
  }

  private async apply(run: GroupRun, actions: PlanAction[]): Promise<void> {
    // Adds first, so a file is never left with no network (which would pause it).
    const ordered = [
      ...actions.filter((a) => a.kind === 'add'),
      ...actions.filter((a) => a.kind === 'drop')
    ]
    for (const action of ordered) {
      try {
        await this.manager.setNetworkEnabled(action.fileId, action.networkId, action.kind === 'add')
      } catch {
        continue
      }
      run.changedAt.set(action.fileId, Date.now())
      this.note(run, action.why === 'lost' ? 'lost' : action.why, action.reason)
    }
  }

  /** Stores the plan for the window, and tells it when something other than a speed changed. */
  private publish(
    run: GroupRun,
    inputs: PlanNetworkInput[],
    states: DownloadState[],
    waiting: number,
    measuring: boolean,
    result?: ReturnType<typeof planGroup>
  ): void {
    const networks: PlanNetwork[] = inputs.map((input) => ({
      id: input.id,
      name: input.name,
      speedBps: Math.round(sustained(input.track)),
      baselineBps: Math.round(input.track.baseline),
      state: result?.networkStates[input.id] ?? (input.present ? 'fast' : 'lost')
    }))
    const summary = summarize({
      mode: 'auto',
      measuring,
      networks: networks.map((n) => ({
        name: n.name ?? n.id,
        speedBps: n.speedBps,
        state: n.state
      })),
      waiting,
      running: states.filter((state) => state.status === 'downloading').length
    })
    run.planned = result?.assignments ?? run.planned
    run.plan = { mode: 'auto', measuring, networks, summary, log: [...run.log] }
    const fingerprint = JSON.stringify([
      summary,
      run.log.length,
      networks.map((n) => [n.id, n.state]),
      run.planned
    ])
    if (fingerprint !== run.fingerprint) {
      run.fingerprint = fingerprint
      this.store.notify()
    }
  }

  /** Whether the measuring is over. Once it is, the first file keeps to the fastest network and
   * the others are free for the rest. */
  private finishMeasuring(
    groupId: string,
    states: DownloadState[],
    inputs: PlanNetworkInput[],
    run: GroupRun
  ): boolean {
    const measure = this.measuring.get(groupId)
    if (!measure) return true
    const first = states.find((state) => state.id === measure.downloadId)
    if (first?.status === 'downloading' && Date.now() - measure.startedAt < MEASURE_MS) {
      return false
    }
    this.measuring.delete(groupId)
    const speedOf = (id: string): number => {
      const input = inputs.find((entry) => entry.id === id)
      return input ? sustained(input.track) : 0
    }
    const live = inputs.filter((input) => input.present)
    this.note(
      run,
      'measure',
      `Measured ${live.map((input) => `${input.name} ${mb(speedOf(input.id))}`).join(', ')}.`
    )
    if (first && first.networks.filter((network) => network.enabled).length > 1) {
      const best = live
        .filter((input) =>
          first.networks.some((network) => network.id === input.id && network.enabled)
        )
        .sort((a, b) => speedOf(b.id) - speedOf(a.id))[0]
      for (const network of first.networks) {
        if (network.enabled && network.id !== best?.id) {
          void this.manager.setNetworkEnabled(first.id, network.id, false)
        }
      }
      if (best) run.changedAt.set(first.id, Date.now())
    }
    return true
  }
}

function mb(bytes: number): string {
  const value = bytes / (1024 * 1024)
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} MB/s`
}
