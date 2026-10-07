import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import type {
  DownloadGroup,
  GroupInfo,
  GroupMode,
  GroupPatch,
  GroupPlan,
  GroupRule,
  PendingGroupItem,
  StartDownloadRequest
} from '../../shared/types'
import { log } from '../logger'
import { readJson, updateJson } from '../jsonFile'
import { openRequest, sealRequest } from '../secrets'

// The groups ("Add several links" batches) and, for an auto group, the files that haven't started
// yet: they wait here, with what it takes to start them, so the group carries on after a restart.

const EMPTY_PLAN: GroupPlan = { mode: 'auto', measuring: false, networks: [], summary: '', log: [] }

/** A group that has no download for a moment (one is still being set up) isn't dropped at once. */
const EMPTY_GRACE_MS = 30_000

interface Saved {
  groups: DownloadGroup[]
  pending: Record<string, PendingGroupItem[]>
  pins: Record<string, string[]>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function isGroup(value: unknown): value is DownloadGroup {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.destinationDir === 'string' &&
    (value.mode === 'auto' || value.mode === 'manual') &&
    typeof value.createdAt === 'number' &&
    Array.isArray(value.interfaceIds) &&
    value.interfaceIds.every((id) => typeof id === 'string')
  )
}

function isPending(value: unknown): value is PendingGroupItem {
  return isRecord(value) && typeof value.id === 'string' && isRecord(value.request)
}

/** The file may be hand-edited or from another version: only what is well formed is kept. */
function sanitize(parsed: unknown): Saved {
  const saved: Saved = { groups: [], pending: {}, pins: {} }
  if (!isRecord(parsed)) return saved
  if (Array.isArray(parsed.groups)) saved.groups = parsed.groups.filter(isGroup)
  if (isRecord(parsed.pending)) {
    for (const group of saved.groups) {
      const items = parsed.pending[group.id]
      if (Array.isArray(items) && items.length > 0)
        saved.pending[group.id] = items.filter(isPending)
    }
  }
  if (isRecord(parsed.pins)) {
    for (const group of saved.groups) {
      const ids = parsed.pins[group.id]
      if (Array.isArray(ids)) saved.pins[group.id] = ids.filter((id) => typeof id === 'string')
    }
  }
  return saved
}

export class GroupStore {
  private saved: Saved = { groups: [], pending: {}, pins: {} }
  readonly loaded: Promise<void>

  /** `onChange` runs after every change, to tell the window. */
  constructor(private onChange: () => void) {
    this.loaded = readJson(this.path())
      .then((parsed) => {
        this.saved = sanitize(parsed)
        for (const items of Object.values(this.saved.pending)) {
          for (const item of items) item.request = openRequest(item.request)
        }
      })
      .catch(() => {})
  }

  private path(): string {
    return join(app.getPath('userData'), 'groups.json')
  }

  /** Whether any group still has files waiting for a network to run on. */
  hasPending(): boolean {
    return Object.values(this.saved.pending).some((items) => items.length > 0)
  }

  private save(): void {
    const snapshot = structuredClone(this.saved)
    for (const items of Object.values(snapshot.pending)) {
      for (const item of items) item.request = sealRequest(item.request)
    }
    void updateJson(this.path(), () => snapshot).catch(() => {})
    this.onChange()
  }

  /** Set by the scheduler: how a group is being downloaded and why. */
  planOf: ((group: GroupInfo) => Pick<GroupInfo, 'plan' | 'plannedNetworks'>) | null = null

  /** Tells the window something changed that isn't saved (the plan). */
  notify(): void {
    this.onChange()
  }

  list(): GroupInfo[] {
    return structuredClone(
      this.saved.groups.map((group) => {
        const base = {
          ...group,
          pending: this.saved.pending[group.id] ?? [],
          pinned: this.saved.pins[group.id] ?? []
        }
        const plan = this.planOf?.({ ...base, plan: EMPTY_PLAN, plannedNetworks: {} })
        return {
          ...base,
          plan: plan?.plan ?? EMPTY_PLAN,
          plannedNetworks: plan?.plannedNetworks ?? {}
        }
      })
    )
  }

  /** How many files of the group may run at once, when it has a limit. Cheap: asked often. */
  limitOf(id: string): number | undefined {
    return this.saved.groups.find((group) => group.id === id)?.maxAtOnce
  }

  get(id: string): GroupInfo | undefined {
    return this.list().find((group) => group.id === id)
  }

  create(input: {
    name: string
    destinationDir: string
    mode: GroupMode
    interfaceIds: string[]
    maxAtOnce?: number
    rule?: GroupRule
    dnsId?: string
    fileCount: number
    ownsFolder?: boolean
    startLater?: boolean
  }): DownloadGroup {
    const name =
      input.name.trim() ||
      `${input.fileCount} ${input.fileCount === 1 ? 'file' : 'files'} · ${new Date().toLocaleDateString()}`
    const group: DownloadGroup = {
      id: randomUUID(),
      name,
      destinationDir: input.destinationDir,
      mode: input.mode,
      createdAt: Date.now(),
      interfaceIds: input.interfaceIds,
      ...(input.maxAtOnce && input.maxAtOnce > 0 ? { maxAtOnce: Math.floor(input.maxAtOnce) } : {}),
      ...(input.mode === 'manual' ? { rule: input.rule ?? 'perFile' } : {}),
      ...(input.dnsId ? { dnsId: input.dnsId } : {}),
      ...(input.ownsFolder ? { ownsFolder: true } : {}),
      ...(input.startLater ? { held: true } : {})
    }
    this.saved.groups.push(group)
    this.save()
    return group
  }

  /** A group added for later is started: its files may begin. */
  release(id: string): void {
    const group = this.saved.groups.find((entry) => entry.id === id)
    if (!group?.held) return
    delete group.held
    this.save()
  }

  update(id: string, patch: GroupPatch): void {
    const group = this.saved.groups.find((entry) => entry.id === id)
    if (!group) return
    const name = patch.name?.trim()
    if (name) group.name = name
    if (patch.mode === 'auto' || patch.mode === 'manual') {
      group.mode = patch.mode
      // A group made before the rule existed keeps working per file until one is chosen.
      if (patch.mode === 'manual') group.rule ??= 'perFile'
    }
    if (patch.rule === 'general' || patch.rule === 'perFile') group.rule = patch.rule
    if (
      Array.isArray(patch.interfaceIds) &&
      patch.interfaceIds.length > 0 &&
      patch.interfaceIds.every((value) => typeof value === 'string')
    ) {
      group.interfaceIds = [...new Set(patch.interfaceIds)]
    }
    if (patch.dnsId === null) delete group.dnsId
    else if (typeof patch.dnsId === 'string' && patch.dnsId) group.dnsId = patch.dnsId
    if (patch.maxAtOnce === null) delete group.maxAtOnce
    else if (typeof patch.maxAtOnce === 'number' && patch.maxAtOnce >= 1) {
      group.maxAtOnce = Math.min(64, Math.floor(patch.maxAtOnce))
    }
    this.save()
  }

  /** The DNS a group asks for, if it asks. */
  dnsOf(id: string): string | undefined {
    return this.saved.groups.find((group) => group.id === id)?.dnsId
  }

  /** The networks every waiting file of the group will start on (a general rule). */
  setPendingNetworks(groupId: string, networks: string[]): void {
    const items = this.saved.pending[groupId]
    if (!items || items.length === 0) return
    for (const item of items) item.request.interfaceIds = networks
    this.save()
  }

  /** The user picked a file's networks (`networks`), or gave it back to Auto (null). */
  choose(groupId: string, fileId: string, networks: string[] | null): void {
    const pins = new Set(this.saved.pins[groupId] ?? [])
    const item = this.saved.pending[groupId]?.find((entry) => entry.id === fileId)
    if (networks && networks.length > 0) {
      pins.add(fileId)
      if (item) item.request.interfaceIds = networks
      log.info('auto', `You chose ${networks.join(' + ')} for a file, so Auto leaves it alone.`)
    } else {
      pins.delete(fileId)
      log.info('auto', 'A file was given back to Auto.')
    }
    if (pins.size > 0) this.saved.pins[groupId] = [...pins]
    else delete this.saved.pins[groupId]
    this.save()
  }

  /** A pinned waiting file started as a download: the pin goes with it. */
  movePin(groupId: string, itemId: string, downloadId: string): void {
    const pins = this.saved.pins[groupId]
    if (!pins?.includes(itemId)) return
    this.saved.pins[groupId] = [...pins.filter((id) => id !== itemId), downloadId]
  }

  remove(id: string): void {
    this.saved.groups = this.saved.groups.filter((group) => group.id !== id)
    delete this.saved.pending[id]
    delete this.saved.pins[id]
    this.save()
  }

  addPending(groupId: string, requests: StartDownloadRequest[]): void {
    if (!this.saved.groups.some((group) => group.id === groupId)) return
    const items = (this.saved.pending[groupId] ??= [])
    for (const request of requests) items.push({ id: randomUUID(), request })
    this.save()
  }

  removePending(groupId: string, itemId: string): void {
    const items = this.saved.pending[groupId]
    if (!items) return
    const left = items.filter((item) => item.id !== itemId)
    if (left.length === items.length) return
    if (left.length > 0) this.saved.pending[groupId] = left
    else delete this.saved.pending[groupId]
    this.save()
  }

  /** Lets files that failed to start try again: the ones named, or every failed one. */
  retryPending(groupId: string, only?: string[]): number {
    let retried = 0
    for (const item of this.saved.pending[groupId] ?? []) {
      if (item.error && (!only || only.includes(item.id))) {
        item.error = undefined
        retried++
      }
    }
    if (retried > 0) this.save()
    return retried
  }

  failPending(groupId: string, itemId: string, error: string): void {
    const item = this.saved.pending[groupId]?.find((entry) => entry.id === itemId)
    if (!item) return
    item.error = error
    this.save()
  }

  /** Drops groups that hold nothing any more: no download in the list or history (`inUse` has
   * the groups that still do) and no file waiting. */
  prune(inUse: Set<string>): void {
    const now = Date.now()
    const keep = this.saved.groups.filter(
      (group) =>
        inUse.has(group.id) ||
        (this.saved.pending[group.id]?.length ?? 0) > 0 ||
        now - group.createdAt < EMPTY_GRACE_MS
    )
    if (keep.length === this.saved.groups.length) return
    this.saved.groups = keep
    this.save()
  }
}
