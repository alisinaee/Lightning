import { assignFiles } from './assignFiles'

// The reactive part of an auto group: a pure planner. Each second the scheduler feeds it what the
// networks deliver and which files are where; it says which waiting file goes on which network and
// which running files should gain or lose a network. Nothing here touches downloads.

export const HISTORY_SECONDS = 30
/** A network that delivers less than this share of its baseline... */
export const SLOW_RATIO = 0.4
/** ...for this many seconds in a row, with a file running on it, is slow. */
export const SLOW_SECONDS = 6
/** It is back once it holds this share of its baseline again (a gap, so it doesn't flap). */
export const RECOVER_RATIO = 0.7
/** A sustained speed this many times the baseline is a speed-up. */
export const SPEEDUP_RATIO = 1.5
/** A file's networks change at most this often. */
export const COOLDOWN_MS = 15_000
/** A network that gives under this share of a file's speed is dropped from it. */
export const USELESS_SHARE = 0.1
/** Another busy network must be this many times faster than the slow one to be added. */
export const MUCH_FASTER = 3
/** Idle networks help a file with more than this share and this many bytes left. */
export const STEAL_SHARE = 0.25
export const STEAL_MIN_BYTES = 50 * 1024 * 1024
const BASELINE_WEIGHT = 0.3
/** Samples needed before a median is taken as the speed a network holds (and the baseline). */
const SUSTAIN_SAMPLES = 5

export type TrackState = 'fast' | 'slow'

/** What is known of one network while the group runs. Plain data, replaced by `trackNetwork`. */
export interface Track {
  /** Bytes a second, once a second, over the seconds a file of the group ran on it. */
  samples: number[]
  baseline: number
  state: TrackState
  lastFasterAt: number
}

export const newTrack = (baseline = 0): Track => ({
  samples: [],
  baseline,
  state: 'fast',
  lastFasterAt: 0
})

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The speed a network holds, not a spike: the middle of its last five seconds. */
export function sustained(track: Track): number {
  if (track.samples.length === 0) return track.baseline
  // A connection's first seconds are often a burst out of socket buffers: with fewer than five
  // samples the lowest one stands for it, so a reading never claims more than was delivered.
  if (track.samples.length < SUSTAIN_SAMPLES) return Math.min(...track.samples)
  return median(track.samples.slice(-SUSTAIN_SAMPLES))
}

export interface TrackChange {
  kind: 'slow' | 'recover' | 'faster'
  from: number
  to: number
}

/** Takes one second's sample (null: no file of the group ran on it, so nothing was learned). */
export function trackNetwork(
  track: Track,
  sample: number | null,
  now: number
): { track: Track; change?: TrackChange } {
  if (sample === null) return { track: { ...track, samples: [] } }
  const samples = [...track.samples, sample].slice(-HISTORY_SECONDS)
  let { baseline, state, lastFasterAt } = track
  let change: TrackChange | undefined
  const now5 = median(samples.slice(-SUSTAIN_SAMPLES))
  if (samples.length >= SUSTAIN_SAMPLES && now5 > baseline) {
    if (baseline > 0 && now5 > baseline * SPEEDUP_RATIO && now - lastFasterAt > COOLDOWN_MS) {
      change = { kind: 'faster', from: baseline, to: now5 }
      lastFasterAt = now
    }
    baseline = baseline === 0 ? now5 : baseline * (1 - BASELINE_WEIGHT) + now5 * BASELINE_WEIGHT
  }
  const recent = samples.slice(-SLOW_SECONDS)
  if (
    state === 'fast' &&
    baseline > 0 &&
    recent.length >= SLOW_SECONDS &&
    recent.every((value) => value < baseline * SLOW_RATIO)
  ) {
    state = 'slow'
    change = { kind: 'slow', from: baseline, to: median(recent) }
  } else if (state === 'slow') {
    if (samples.length >= 3 && median(samples.slice(-3)) >= baseline * RECOVER_RATIO) {
      state = 'fast'
      change = { kind: 'recover', from: median(samples.slice(-SLOW_SECONDS - 2, -3)), to: now5 }
    } else if (
      samples.length >= HISTORY_SECONDS &&
      samples.every((value) => value < baseline * SLOW_RATIO)
    ) {
      // Slow for the whole history: that is what the network is now, not a dip.
      baseline = median(samples)
      state = 'fast'
    }
  }
  return { track: { samples, baseline, state, lastFasterAt }, change }
}

export interface PlanNetworkInput {
  id: string
  name: string
  /** Still there (and allowed: VPN tunnels are not passed unless they are to be used). */
  present: boolean
  track: Track
}

export interface PlanRunning {
  id: string
  name: string
  /** Bytes left; 0 when the size is not known. */
  remaining: number
  total: number
  /** The networks it is using now. */
  networks: string[]
  /** Whether it can be spread over several networks. */
  splittable: boolean
  /** When its networks last changed through the plan. */
  lastChangeAt: number
  /** The user chose its networks: the plan leaves it alone and only plans around its load. */
  pinned?: boolean
}

export interface PlanWaiting {
  id: string
  name: string
  /** 0 when not known. */
  size: number
  /** The networks the user chose for it; it starts on those and nothing else. */
  pinned?: string[]
}

export interface PlanState {
  now: number
  networks: PlanNetworkInput[]
  running: PlanRunning[]
  waiting: PlanWaiting[]
}

export interface PlanAction {
  kind: 'add' | 'drop'
  fileId: string
  networkId: string
  /** Plain English, for the plan log. */
  reason: string
  /** The log kind. */
  why: 'help' | 'release' | 'drop' | 'lost'
}

export interface PlanResult {
  /** Waiting file id -> network it is planned for. */
  assignments: Record<string, string>
  /** The order to start waiting files in (ids, biggest first). */
  order: string[]
  actions: PlanAction[]
  reasons: string[]
  /** Which networks hold which role, for the panel. */
  networkStates: Record<string, 'fast' | 'slow' | 'idle' | 'lost'>
}

const MB = 1024 * 1024
const rate = (bytes: number): string => {
  const value = bytes / MB
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} MB/s`
}
const size = (bytes: number): string =>
  bytes >= 1024 * MB ? `${(bytes / 1024 / MB).toFixed(1)} GB` : `${Math.round(bytes / MB)} MB`

/** What each network is worth now: its sustained speed; for one nothing has run on yet, the
 * average of the others (or 1). */
export function estimates(networks: PlanNetworkInput[]): Map<string, number> {
  const known = networks
    .filter((network) => network.present && sustained(network.track) > 0)
    .map((network) => sustained(network.track))
  const fallback = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 1
  return new Map(
    networks.map((network) => [network.id, Math.max(sustained(network.track) || fallback, 1)])
  )
}

export function planGroup(state: PlanState): PlanResult {
  const { now } = state
  const present = state.networks.filter((network) => network.present)
  const byId = new Map(state.networks.map((network) => [network.id, network]))
  const nameOf = (id: string): string => byId.get(id)?.name ?? id
  const speed = estimates(state.networks)
  const actions: PlanAction[] = []
  const reasons: string[] = []
  const changed = new Set<string>()
  // The networks each running file has after the actions so far.
  const using = new Map(state.running.map((file) => [file.id, [...file.networks]]))
  const free = (file: PlanRunning): boolean =>
    !file.pinned && !changed.has(file.id) && now - file.lastChangeAt >= COOLDOWN_MS

  const act = (action: PlanAction): void => {
    actions.push(action)
    reasons.push(action.reason)
    const list = using.get(action.fileId) ?? []
    using.set(
      action.fileId,
      action.kind === 'add'
        ? [...list, action.networkId]
        : list.filter((id) => id !== action.networkId)
    )
  }

  // Lane lost: a file on a network that went moves to the best one left, at once.
  for (const file of state.running) {
    if (file.pinned) continue
    const lost = file.networks.filter((id) => !byId.get(id)?.present)
    if (lost.length === 0 || present.length === 0) continue
    const kept = file.networks.filter((id) => byId.get(id)?.present)
    if (kept.length === 0) {
      const best = [...present].sort((a, b) => speed.get(b.id)! - speed.get(a.id)!)[0]
      act({
        kind: 'add',
        fileId: file.id,
        networkId: best.id,
        why: 'lost',
        reason: `${nameOf(lost[0])} disconnected, so ${best.name} took over ${file.name}.`
      })
    }
    for (const id of lost) {
      act({
        kind: 'drop',
        fileId: file.id,
        networkId: id,
        why: 'lost',
        reason: `${nameOf(id)} is gone, so ${file.name} no longer uses it.`
      })
    }
    changed.add(file.id)
  }

  const usedBy = (): Map<string, string[]> => {
    const map = new Map<string, string[]>()
    for (const [fileId, ids] of using) {
      for (const id of ids) map.set(id, [...(map.get(id) ?? []), fileId])
    }
    return map
  }

  // Waiting files: biggest first, each on the lane that would finish it soonest.
  const fixed = state.waiting.filter((file) => file.pinned?.some((id) => byId.get(id)?.present))
  const loose = state.waiting.filter((file) => !fixed.includes(file))
  const lanes = present.map((network) => {
    let busy = 0
    for (const file of state.running) {
      const ids = using.get(file.id) ?? []
      if (!ids.includes(network.id)) continue
      busy += (file.remaining || file.total || 0) / Math.max(ids.length, 1)
    }
    // Files the user pinned will load their networks too.
    for (const file of fixed) {
      const ids = file.pinned!.filter((id) => byId.get(id)?.present)
      if (ids.includes(network.id)) busy += file.size / ids.length
    }
    return { id: network.id, speed: speed.get(network.id)!, busyBytes: busy }
  })
  const assignments: Record<string, string> = {}
  let order: string[] = fixed.map((file) => file.id)
  for (const file of fixed) {
    assignments[file.id] = file.pinned!.find((id) => byId.get(id)?.present)!
  }
  if (lanes.length > 0 && loose.length > 0) {
    const plan = assignFiles(
      loose.map((file) => file.size),
      lanes
    )
    loose.forEach((file, index) => (assignments[file.id] = plan.laneIds[index]))
    order = [...order, ...plan.order.map((index) => loose[index].id)]
  }
  const wanted = new Set(Object.values(assignments))

  // Nothing else is waiting and one file runs: nothing competes for the networks, so it gets every
  // one present, without the share, size or cooldown gates the steps below apply.
  if (state.waiting.length === 0 && state.running.length === 1) {
    const [only] = state.running
    if (only.splittable && !only.pinned) {
      const added = present.filter((network) => !(using.get(only.id) ?? []).includes(network.id))
      for (const network of added) {
        act({
          kind: 'add',
          fileId: only.id,
          networkId: network.id,
          why: 'help',
          reason: `${network.name} had nothing left to download, so it joined ${only.name}${only.remaining > 0 ? ` (${size(only.remaining)} left)` : ''}.`
        })
      }
      if (added.length > 0) changed.add(only.id)
    }
  }

  // d. A helper network is wanted by a file of its own: give it back.
  for (const file of state.running) {
    if (!free(file)) continue
    const ids = using.get(file.id) ?? []
    if (ids.length < 2) continue
    const home = ids.reduce((best, id) => (speed.get(id)! > speed.get(best)! ? id : best), ids[0])
    for (const id of ids) {
      if (id === home || !wanted.has(id)) continue
      const waitingFile = state.waiting.find((entry) => assignments[entry.id] === id)
      act({
        kind: 'drop',
        fileId: file.id,
        networkId: id,
        why: 'release',
        reason: `${nameOf(id)} stopped helping ${file.name} so it can start ${waitingFile?.name ?? 'the next file'}.`
      })
      changed.add(file.id)
      break
    }
  }

  // b. A running file on a slow network: add the idle or much faster one, drop the slow one if
  // it is now useless. Adding keeps what was downloaded; nothing restarts.
  for (const file of state.running) {
    if (!file.splittable || !free(file)) continue
    const ids = using.get(file.id) ?? []
    const slow = ids.find((id) => byId.get(id)?.present && byId.get(id)!.track.state === 'slow')
    if (!slow) continue
    const slowSpeed = sustained(byId.get(slow)!.track)
    const taken = usedBy()
    const helper = present
      .filter((network) => !ids.includes(network.id) && !wanted.has(network.id))
      .filter(
        (network) => !taken.has(network.id) || speed.get(network.id)! >= slowSpeed * MUCH_FASTER
      )
      .sort((a, b) => speed.get(b.id)! - speed.get(a.id)!)[0]
    if (!helper) continue
    act({
      kind: 'add',
      fileId: file.id,
      networkId: helper.id,
      why: 'help',
      reason: `${nameOf(slow)} slowed from ${rate(byId.get(slow)!.track.baseline)} to ${rate(slowSpeed)}, so ${helper.name} joined ${file.name}.`
    })
    const total = ids.reduce(
      (sum, id) => sum + (id === slow ? slowSpeed : speed.get(id)!),
      speed.get(helper.id)!
    )
    if (slowSpeed < total * USELESS_SHARE) {
      act({
        kind: 'drop',
        fileId: file.id,
        networkId: slow,
        why: 'drop',
        reason: `${nameOf(slow)} gives under 10% of ${file.name}, so it was dropped from it.`
      })
    }
    changed.add(file.id)
  }

  // c. An idle network, nothing left to give it: it helps the file with the most left.
  const taken = usedBy()
  for (const network of present) {
    if (taken.has(network.id) || wanted.has(network.id)) continue
    const target = state.running
      .filter(
        (file) => file.splittable && free(file) && !(using.get(file.id) ?? []).includes(network.id)
      )
      .filter((file) => {
        if (file.remaining <= 0 || file.total <= 0) return false
        return file.remaining / file.total > STEAL_SHARE && file.remaining > STEAL_MIN_BYTES
      })
      .sort((a, b) => b.remaining - a.remaining)[0]
    if (!target) continue
    act({
      kind: 'add',
      fileId: target.id,
      networkId: network.id,
      why: 'help',
      reason: `${network.name} had nothing left to download, so it joined ${target.name} (${size(target.remaining)} left).`
    })
    changed.add(target.id)
    taken.set(network.id, [target.id])
  }

  const finalUse = usedBy()
  const networkStates: PlanResult['networkStates'] = {}
  for (const network of state.networks) {
    networkStates[network.id] = !network.present
      ? 'lost'
      : network.track.state === 'slow' && finalUse.has(network.id)
        ? 'slow'
        : finalUse.has(network.id) || wanted.has(network.id)
          ? 'fast'
          : 'idle'
  }
  return { assignments, order, actions, reasons, networkStates }
}

/** The one sentence the panel opens with. */
export function summarize(input: {
  mode: 'auto' | 'manual'
  measuring: boolean
  networks: { name: string; speedBps: number; state: string }[]
  waiting: number
  running: number
}): string {
  if (input.mode === 'manual') return 'Manual: each file uses the connections you chose.'
  if (input.measuring) return 'Measuring each connection for a few seconds…'
  const live = input.networks.filter((network) => network.state !== 'lost')
  if (live.length === 0) return 'No connection is available, so the group waits for one.'
  if (live.length === 1) {
    return `Only ${live[0].name} is connected, so the files download one after another.`
  }
  const sorted = [...live].sort((a, b) => b.speedBps - a.speedBps)
  const slow = sorted.filter((network) => network.state === 'slow')
  if (slow.length > 0) {
    return `${slow[0].name} slowed down (${rate(slow[0].speedBps)}), so Lightning is shifting work to ${sorted.find((n) => n.state !== 'slow')?.name ?? sorted[0].name}.`
  }
  if (input.waiting === 0 && input.running <= 1) {
    return `Finishing the last file on ${sorted[0].name}${sorted.length > 1 ? ' with help from the others' : ''}.`
  }
  const [first, ...rest] = sorted
  if (first.speedBps <= 0) return 'Lightning is learning how fast each connection is.'
  return `${first.name} is the fastest (${rate(first.speedBps)}) so it gets the biggest files. ${rest
    .map((network) => `${network.name} (${rate(network.speedBps)})`)
    .join(', ')} get${rest.length === 1 ? 's' : ''} the smaller ones, so all finish together.`
}
