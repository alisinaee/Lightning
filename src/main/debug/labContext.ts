import { randomBytes } from 'node:crypto'
import { readdir, rm } from 'node:fs/promises'
import { describeError } from '../../shared/errors'
import type {
  AppSettings,
  CreateGroupInput,
  DownloadState,
  FinishedDownload,
  GroupInfo,
  GroupMode,
  GroupPatch,
  PlanEvent,
  StartDownloadRequest
} from '../../shared/types'
import type { DownloadManager } from '../download/downloadManager'
import { listHistory } from '../download/history'
import type { GroupStore } from '../groups/groupStore'
import type { NetworkMonitor } from '../network/interfaces'
import type { FakeServer, NetCount, VerifyResult } from './fakeServer'
import { simNetworks } from './simNetworks'

// What a plan can do (see LabContext) and how the runner (lab.ts) backs it. A plan only calls the
// app through the same operations the window's dialogs and rows use.

/** Thrown to stop a plan at once: the person pressed Stop, or the plan ran out of time. */
export class LabAbort extends Error {}
/** Thrown by a failed `require`: the rest of the plan means nothing. */
export class LabFatal extends Error {}

export interface Matcher<T = unknown> {
  desc: string
  test: (actual: T) => boolean
}

const matcher = <T>(desc: string, test: (actual: T) => boolean): Matcher<T> => ({ desc, test })

/** Ready-made expectations for ctx.expect. */
export const is = {
  gt: (n: number) => matcher<number>(`more than ${n}`, (a) => a > n),
  gte: (n: number) => matcher<number>(`at least ${n}`, (a) => a >= n),
  lt: (n: number) => matcher<number>(`less than ${n}`, (a) => a < n),
  lte: (n: number) => matcher<number>(`at most ${n}`, (a) => a <= n),
  between: (low: number, high: number) =>
    matcher<number>(`between ${low} and ${high}`, (a) => a >= low && a <= high),
  oneOf: <T>(...values: T[]) =>
    matcher<T>(`one of ${values.map((v) => JSON.stringify(v)).join(', ')}`, (a) =>
      values.includes(a)
    ),
  truthy: matcher<unknown>('yes', Boolean)
}

export interface FileSpec {
  /** The file's name when saved. */
  name: string
  mb: number
  /** Extra server options (`fail=2&kbps=500`, see fakeServer.ts). */
  query?: string
  /** The server gives no ranges: one stream, one network. */
  noRange?: boolean
}

/** A file of the lab's server: where it is and how big. */
export interface LabFile {
  name: string
  /** Its path on the server, which also decides its bytes. */
  path: string
  url: string
  size: number
  noRange: boolean
}

export type Snapshot = DownloadState | FinishedDownload

export interface Sampled {
  seconds: number
  /** Bytes the server sent to each network in the window. */
  bytes: Record<string, number>
  /** Bytes a second, the same. */
  rate: Record<string, number>
  total: number
}

export interface LabContext {
  readonly server: FakeServer
  /** The temporary folder the plan's downloads go to. */
  readonly dir: string
  readonly signal: AbortSignal
  /** Milliseconds since the plan began. */
  elapsed(): number
  step(name: string, fn: () => Promise<void>): Promise<void>
  note(message: string): void
  /** Records what was expected and what happened; the plan goes on. Returns whether it held. */
  expect<T>(label: string, actual: T, expected: T | Matcher<T>, hint?: string): boolean
  /** Like expect, but a failure stops the plan. */
  require<T>(label: string, actual: T, expected: T | Matcher<T>, hint?: string): void
  net: {
    add(id: string): Promise<void>
    remove(id: string): Promise<void>
    list(): string[]
    /** What the app lets a new download pick: the VPN is left out unless Use VPN is on. */
    selectable(): string[]
  }
  settings: { set(patch: AppSettings): Promise<void> }
  file(spec: FileSpec): LabFile
  startDownload(file: LabFile, networks: string[], options?: { streams?: number }): Promise<LabFile>
  startGroup(spec: {
    name: string
    mode: GroupMode
    networks: string[]
    files: LabFile[]
    /** The networks of single files (by file name) in a manual group. */
    perFile?: Record<string, string[]>
  }): Promise<string>
  addToGroup(groupId: string, files: LabFile[], networks?: string[]): Promise<void>
  updateGroup(groupId: string, patch: GroupPatch): Promise<void>
  removeGroup(groupId: string): Promise<void>
  group(groupId: string): GroupInfo | undefined
  planLog(): PlanEvent[]
  /** Where the file is now: running, queued, or finished; undefined if it isn't anywhere. */
  find(file: LabFile): Promise<Snapshot | undefined>
  all(): Promise<Snapshot[]>
  live(): readonly DownloadState[]
  pause(file: LabFile): Promise<void>
  resume(file: LabFile): Promise<void>
  cancel(file: LabFile): Promise<void>
  remove(file: LabFile): Promise<void>
  /** Switches a running file's networks to exactly `networks`, as its row's buttons do. */
  setNetworks(file: LabFile, networks: string[]): Promise<void>
  /** Chooses the file's networks in an Auto group (null gives it back to Auto). */
  pinFile(groupId: string, file: LabFile, networks: string[] | null): Promise<void>
  pauseGroup(groupId: string): Promise<void>
  resumeGroup(groupId: string): Promise<void>
  /** Polls until `cond` holds; records the wait as an assertion, and returns whether it held. */
  waitFor(
    label: string,
    cond: () => boolean | Promise<boolean>,
    timeoutMs: number,
    options?: { fatal?: boolean; giveUp?: () => string | null | Promise<string | null> }
  ): Promise<boolean>
  waitDone(file: LabFile, timeoutMs: number): Promise<boolean>
  sleep(ms: number): Promise<void>
  sample(ms: number): Promise<Sampled>
  /** Runs `fn` after `ms` (cancelled when the plan ends). */
  after(ms: number, fn: () => void | Promise<void>): void
  verifyFile(file: LabFile, label?: string): Promise<VerifyResult>
  /** The names in the plan's folder. */
  listDir(): Promise<string[]>
  counters(): Record<string, NetCount>
  fileCounters(file: LabFile): Record<string, NetCount>
  /** The plan waits for the person (see the restart plan). */
  awaitPerson(message: string): void
  /** Keeps the plan's files and downloads after it ends (the restart plan's first half). */
  keep(): void
  /** Takes over what an earlier run left (after a restart): its links' tag and its groups. */
  adopt(tag: string, groupIds: string[]): void
  readonly tag: string
}

export interface LabOps {
  applySettings(patch: AppSettings): Promise<void>
  createGroup(input: CreateGroupInput): Promise<{ group: GroupInfo; failed: string[] }>
  updateGroup(id: string, patch: GroupPatch): Promise<void>
  removeGroup(id: string): Promise<void>
  addGroupItems(id: string, requests: StartDownloadRequest[]): Promise<{ failed: string[] }>
  setGroupFileChoice(id: string, fileId: string, networks: string[] | null): Promise<void>
  resumeGroup(id: string): Promise<void>
}

export interface LabDeps {
  manager: DownloadManager
  groups: GroupStore
  networks: NetworkMonitor
  ops: LabOps
  readSettings(): Promise<AppSettings>
  push(): void
}

/** What a run makes (and later cleans up), and the hooks into its record. */
export interface RunHooks {
  record(
    label: string,
    ok: boolean,
    expected: string,
    actual: string,
    hint: string | undefined
  ): void
  note(message: string): void
  planLog: PlanEvent[]
  setAwaiting(message: string): void
}

export const show = (value: unknown): string => {
  if (typeof value === 'string') return value.length > 140 ? `${value.slice(0, 140)}...` : value
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2)
  const text = JSON.stringify(value) ?? String(value)
  return text.length > 160 ? `${text.slice(0, 160)}...` : text
}

const isMatcher = (value: unknown): value is Matcher =>
  typeof value === 'object' &&
  value !== null &&
  'desc' in value &&
  'test' in value &&
  typeof (value as Matcher).test === 'function'

const sameValue = (a: unknown, b: unknown): boolean =>
  Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b)

export const mb = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MB`

/** One plan's context, and what it made. */
export class RunContext implements LabContext {
  tag = `lab${randomBytes(3).toString('hex')}`
  readonly startedAt = Date.now()
  readonly ownGroups = new Set<string>()
  readonly ownFiles: LabFile[] = []
  readonly restores: Array<() => Promise<void>> = []
  readonly timers = new Set<NodeJS.Timeout>()
  readonly settingsBefore = new Map<keyof AppSettings, unknown>()
  kept = false
  stepRunner: ((name: string, fn: () => Promise<void>) => Promise<void>) | null = null
  private history: { at: number; entries: FinishedDownload[] } = { at: 0, entries: [] }

  constructor(
    readonly server: FakeServer,
    readonly dir: string,
    readonly signal: AbortSignal,
    private deps: LabDeps,
    private hooks: RunHooks
  ) {}

  elapsed(): number {
    return Date.now() - this.startedAt
  }

  private check(): void {
    if (this.signal.aborted) throw new LabAbort('stopped')
  }

  async step(name: string, fn: () => Promise<void>): Promise<void> {
    if (!this.stepRunner) return fn()
    return this.stepRunner(name, fn)
  }

  note(message: string): void {
    this.hooks.note(message)
  }

  expect<T>(label: string, actual: T, expected: T | Matcher<T>, hint?: string): boolean {
    const ok = isMatcher(expected) ? expected.test(actual) : sameValue(actual, expected as unknown)
    this.hooks.record(
      label,
      ok,
      isMatcher(expected) ? expected.desc : show(expected),
      show(actual),
      hint
    )
    return ok
  }

  require<T>(label: string, actual: T, expected: T | Matcher<T>, hint?: string): void {
    if (!this.expect(label, actual, expected, hint)) throw new LabFatal(`${label} did not hold`)
  }

  net = {
    add: async (id: string): Promise<void> => {
      simNetworks.add(id)
      await this.deps.networks.refresh()
    },
    remove: async (id: string): Promise<void> => {
      simNetworks.remove(id)
      await this.deps.networks.refresh()
    },
    list: (): string[] => simNetworks.list().map((spec) => spec.id),
    selectable: (): string[] => this.deps.networks.selectable().map((iface) => iface.id)
  }

  settings = {
    set: async (patch: AppSettings): Promise<void> => {
      const before = await this.deps.readSettings()
      for (const key of Object.keys(patch) as (keyof AppSettings)[]) {
        if (!this.settingsBefore.has(key)) this.settingsBefore.set(key, before[key])
      }
      await this.deps.ops.applySettings(patch)
      this.note(`settings: ${JSON.stringify(patch)}`)
    }
  }

  file(spec: FileSpec): LabFile {
    const path = `/${this.tag}/${spec.name}`
    const query = [`mb=${spec.mb}`, spec.noRange ? 'norange=1' : '', spec.query ?? '']
      .filter(Boolean)
      .join('&')
    const file: LabFile = {
      name: spec.name,
      path,
      url: this.server.url(path, query),
      size: Math.round(spec.mb * 1024 * 1024),
      noRange: spec.noRange === true
    }
    this.ownFiles.push(file)
    return file
  }

  private request(file: LabFile, networks: string[], streams?: number): StartDownloadRequest {
    return {
      kind: 'http',
      url: file.url,
      destinationDir: this.dir,
      suggestedFileName: file.name,
      totalBytes: file.size,
      supportsRanges: !file.noRange,
      interfaceIds: file.noRange ? networks.slice(0, 1) : networks,
      etag: `"lab-${file.name}-${file.size}"`,
      lastModified: null,
      streamsPerNetwork: streams
    }
  }

  async startDownload(
    file: LabFile,
    networks: string[],
    options: { streams?: number } = {}
  ): Promise<LabFile> {
    this.check()
    await this.deps.manager.start(this.request(file, networks, options.streams))
    this.note(`started ${file.name} (${mb(file.size)}) on ${networks.join(' + ')}`)
    return file
  }

  async startGroup(spec: {
    name: string
    mode: GroupMode
    networks: string[]
    files: LabFile[]
    perFile?: Record<string, string[]>
  }): Promise<string> {
    this.check()
    const { group, failed } = await this.deps.ops.createGroup({
      name: spec.name,
      destinationDir: this.dir,
      mode: spec.mode,
      interfaceIds: spec.networks,
      requests: spec.files.map((file) =>
        this.request(
          file,
          spec.mode === 'manual' ? (spec.perFile?.[file.name] ?? spec.networks) : spec.networks
        )
      )
    })
    this.ownGroups.add(group.id)
    this.note(`group "${spec.name}" (${spec.mode}) with ${spec.files.length} files`)
    this.expect(`group "${spec.name}" started every file`, failed, [])
    return group.id
  }

  async addToGroup(groupId: string, files: LabFile[], networks?: string[]): Promise<void> {
    const group = this.group(groupId)
    const ids = networks ?? group?.interfaceIds ?? []
    const { failed } = await this.deps.ops.addGroupItems(
      groupId,
      files.map((file) => this.request(file, ids))
    )
    this.expect('added files all started or queued', failed, [])
  }

  updateGroup(groupId: string, patch: GroupPatch): Promise<void> {
    return this.deps.ops.updateGroup(groupId, patch)
  }

  async removeGroup(groupId: string): Promise<void> {
    await this.deps.ops.removeGroup(groupId)
    this.ownGroups.delete(groupId)
  }

  group(groupId: string): GroupInfo | undefined {
    return this.deps.groups.get(groupId)
  }

  planLog(): PlanEvent[] {
    return this.hooks.planLog
  }

  live(): readonly DownloadState[] {
    return this.deps.manager.liveStates().filter((state) => this.isMine(state))
  }

  private isMine(state: { url: string }): boolean {
    return state.url.includes(`/${this.tag}/`)
  }

  private async historyEntries(): Promise<FinishedDownload[]> {
    if (Date.now() - this.history.at > 400) {
      const entries = await listHistory().catch(() => [])
      this.history = { at: Date.now(), entries: entries.filter((e) => this.isMine(e)) }
    }
    return this.history.entries
  }

  async all(): Promise<Snapshot[]> {
    const live = this.live()
    const liveIds = new Set(live.map((state) => state.id))
    const finished = (await this.historyEntries()).filter((entry) => !liveIds.has(entry.id))
    return [...live, ...finished]
  }

  async find(file: LabFile): Promise<Snapshot | undefined> {
    const live = this.live().find((state) => state.url.includes(file.path))
    if (live) return live
    return (await this.historyEntries()).find((entry) => entry.url.includes(file.path))
  }

  private async need(file: LabFile): Promise<Snapshot> {
    const found = await this.find(file)
    if (!found) throw new Error(`${file.name} is not in the downloads`)
    return found
  }

  async pause(file: LabFile): Promise<void> {
    await this.deps.manager.pause((await this.need(file)).id)
  }

  async resume(file: LabFile): Promise<void> {
    this.deps.manager.resume((await this.need(file)).id)
  }

  async cancel(file: LabFile): Promise<void> {
    await this.deps.manager.cancel((await this.need(file)).id)
  }

  async remove(file: LabFile): Promise<void> {
    await this.deps.manager.remove((await this.need(file)).id)
  }

  async setNetworks(file: LabFile, next: string[]): Promise<void> {
    const state = await this.need(file)
    if (state.status === 'error') this.deps.manager.resume(state.id)
    const current = state.networks.filter((n) => n.enabled).map((n) => n.id)
    for (const id of next) {
      if (!current.includes(id)) await this.deps.manager.setNetworkEnabled(state.id, id, true)
    }
    for (const id of current) {
      if (!next.includes(id)) await this.deps.manager.setNetworkEnabled(state.id, id, false)
    }
  }

  async pinFile(groupId: string, file: LabFile, networks: string[] | null): Promise<void> {
    const group = this.group(groupId)
    if (!group) throw new Error('The group is gone')
    const running = this.live().find((state) => state.url.includes(file.path))
    if (networks === null) {
      const id =
        running?.id ?? group.pending.find((item) => item.request.url.includes(file.path))?.id
      if (id) await this.deps.ops.setGroupFileChoice(groupId, id, null)
      return
    }
    if (running) {
      await this.setNetworks(file, networks)
      await this.deps.ops.setGroupFileChoice(groupId, running.id, networks)
      return
    }
    const waiting = group.pending.find((item) => item.request.url.includes(file.path))
    if (!waiting) throw new Error(`${file.name} is not in the group`)
    await this.deps.ops.setGroupFileChoice(groupId, waiting.id, networks)
  }

  async pauseGroup(groupId: string): Promise<void> {
    for (const state of this.deps.manager.groupDownloads(groupId)) {
      if (state.status === 'downloading' || state.status === 'queued') {
        await this.deps.manager.pause(state.id)
      }
    }
  }

  resumeGroup(groupId: string): Promise<void> {
    return this.deps.ops.resumeGroup(groupId)
  }

  async waitFor(
    label: string,
    cond: () => boolean | Promise<boolean>,
    timeoutMs: number,
    options: { fatal?: boolean; giveUp?: () => string | null | Promise<string | null> } = {}
  ): Promise<boolean> {
    const began = Date.now()
    let held = false
    let gaveUp: string | null = null
    while (Date.now() - began < timeoutMs) {
      this.check()
      try {
        held = await cond()
      } catch {
        held = false
      }
      if (held) break
      gaveUp = (await options.giveUp?.()) ?? null
      if (gaveUp) break
      await this.sleep(200)
    }
    const took = ((Date.now() - began) / 1000).toFixed(1)
    this.hooks.record(
      label,
      held,
      `within ${(timeoutMs / 1000).toFixed(0)} s`,
      held ? `after ${took} s` : (gaveUp ?? `not after ${took} s`),
      undefined
    )
    if (!held && options.fatal) throw new LabFatal(`${label} did not happen`)
    return held
  }

  waitDone(file: LabFile, timeoutMs: number): Promise<boolean> {
    return this.waitFor(
      `${file.name} finishes`,
      async () => (await this.find(file))?.status === 'completed',
      timeoutMs,
      {
        giveUp: async () => {
          const state = await this.find(file)
          return state?.status === 'error' || state?.status === 'cancelled'
            ? `ended as ${state.status}: ${state.error ?? 'no reason given'}`
            : null
        }
      }
    )
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.signal.aborted) return reject(new LabAbort('stopped'))
      const timer = setTimeout(() => {
        this.signal.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(new LabAbort('stopped'))
      }
      this.signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  async sample(ms: number): Promise<Sampled> {
    const before = this.server.counters()
    const began = Date.now()
    await this.sleep(ms)
    const seconds = (Date.now() - began) / 1000
    const after = this.server.counters()
    const bytes: Record<string, number> = {}
    const rate: Record<string, number> = {}
    let total = 0
    for (const key of Object.keys(after)) {
      bytes[key] = after[key].bytes - (before[key]?.bytes ?? 0)
      rate[key] = bytes[key] / seconds
      total += bytes[key]
    }
    this.note(
      `sampled ${seconds.toFixed(1)} s: ` +
        Object.entries(rate)
          .map(([key, value]) => `${key} ${mb(value)}/s`)
          .join(', ')
    )
    return { seconds, bytes, rate, total }
  }

  after(ms: number, fn: () => void | Promise<void>): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      if (!this.signal.aborted) void Promise.resolve(fn()).catch(() => {})
    }, ms)
    this.timers.add(timer)
  }

  async verifyFile(file: LabFile, label = `${file.name} is byte-exact`): Promise<VerifyResult> {
    const state = await this.find(file)
    if (!state || state.status !== 'completed') {
      this.expect(label, `not finished (${state?.status ?? 'gone'})`, 'the saved file matches')
      return { ok: false, firstMismatch: 0, actualSize: -1 }
    }
    const result = await this.server.verifyFile(file.path, state.destinationPath, file.size)
    this.hooks.record(
      label,
      result.ok,
      `all ${file.size} bytes match the pattern`,
      result.ok
        ? 'every byte matches'
        : `first wrong byte at ${result.firstMismatch}, saved size ${result.actualSize}`,
      'The saved file differs from what the server sent: data was written to the wrong place or lost.'
    )
    return result
  }

  async listDir(): Promise<string[]> {
    return readdir(this.dir).catch(() => [])
  }

  counters(): Record<string, NetCount> {
    return this.server.counters()
  }

  fileCounters(file: LabFile): Record<string, NetCount> {
    return this.server.fileCounters(file.path)
  }

  awaitPerson(message: string): void {
    this.hooks.setAwaiting(message)
  }

  keep(): void {
    this.kept = true
  }

  adopt(tag: string, groupIds: string[]): void {
    this.tag = tag
    for (const id of groupIds) this.ownGroups.add(id)
  }

  /** Removes everything the plan made, whatever state it is in. Returns what could not be removed. */
  async cleanup(): Promise<string[]> {
    const problems: string[] = []
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    const attempt = async (what: string, fn: () => Promise<unknown>): Promise<void> => {
      try {
        await fn()
      } catch (error) {
        problems.push(`${what}: ${describeError(error)}`)
      }
    }
    if (!this.kept) {
      for (const id of [...this.ownGroups]) {
        await attempt(`remove group ${id}`, () => this.deps.ops.removeGroup(id))
      }
      this.ownGroups.clear()
      // Anything still listed that the plan made, in a group or not.
      for (const state of this.live()) {
        await attempt(`remove ${state.fileName}`, () => this.deps.manager.remove(state.id))
      }
      this.history.at = 0
      for (const entry of await this.historyEntries()) {
        await attempt(`forget ${entry.fileName}`, () => this.deps.manager.remove(entry.id))
      }
      for (const state of this.deps.manager.liveStates()) {
        if (state.destinationPath.startsWith(this.dir)) {
          await attempt(`remove stray ${state.fileName}`, () => this.deps.manager.remove(state.id))
        }
      }
      const left = this.live().length
      if (left > 0) problems.push(`${left} download(s) are still listed`)
    }
    for (const restore of this.restores.reverse()) await attempt('restore', restore)
    const before = [...this.settingsBefore]
    if (before.length > 0) {
      const patch: Record<string, unknown> = {}
      for (const [key, value] of before) patch[key] = value
      await attempt('restore settings', () => this.deps.ops.applySettings(patch as AppSettings))
    }
    this.settingsBefore.clear()
    this.server.reset()
    if (!this.kept)
      await attempt('delete test files', () => rm(this.dir, { recursive: true, force: true }))
    return problems
  }
}
