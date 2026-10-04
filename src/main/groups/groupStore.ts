import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import type {
  DownloadGroup,
  GroupInfo,
  GroupMode,
  PendingGroupItem,
  StartDownloadRequest
} from '../../shared/types'
import { readJson, updateJson } from '../jsonFile'

// The groups ("Add several links" batches) and, for an auto group, the files that haven't started
// yet: they wait here, with what it takes to start them, so the group carries on after a restart.

/** A group that has no download for a moment (one is still being set up) isn't dropped at once. */
const EMPTY_GRACE_MS = 30_000

interface Saved {
  groups: DownloadGroup[]
  pending: Record<string, PendingGroupItem[]>
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
  const saved: Saved = { groups: [], pending: {} }
  if (!isRecord(parsed)) return saved
  if (Array.isArray(parsed.groups)) saved.groups = parsed.groups.filter(isGroup)
  if (isRecord(parsed.pending)) {
    for (const group of saved.groups) {
      const items = parsed.pending[group.id]
      if (Array.isArray(items) && items.length > 0)
        saved.pending[group.id] = items.filter(isPending)
    }
  }
  return saved
}

export class GroupStore {
  private saved: Saved = { groups: [], pending: {} }
  readonly loaded: Promise<void>

  /** `onChange` runs after every change, to tell the window. */
  constructor(private onChange: () => void) {
    this.loaded = readJson(this.path())
      .then((parsed) => {
        this.saved = sanitize(parsed)
      })
      .catch(() => {})
  }

  private path(): string {
    return join(app.getPath('userData'), 'groups.json')
  }

  private save(): void {
    const snapshot = structuredClone(this.saved)
    void updateJson(this.path(), () => snapshot).catch(() => {})
    this.onChange()
  }

  list(): GroupInfo[] {
    return structuredClone(
      this.saved.groups.map((group) => ({ ...group, pending: this.saved.pending[group.id] ?? [] }))
    )
  }

  get(id: string): GroupInfo | undefined {
    return this.list().find((group) => group.id === id)
  }

  create(input: {
    name: string
    destinationDir: string
    mode: GroupMode
    interfaceIds: string[]
    fileCount: number
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
      interfaceIds: input.interfaceIds
    }
    this.saved.groups.push(group)
    this.save()
    return group
  }

  update(id: string, patch: { name?: string; mode?: GroupMode }): void {
    const group = this.saved.groups.find((entry) => entry.id === id)
    if (!group) return
    const name = patch.name?.trim()
    if (name) group.name = name
    if (patch.mode === 'auto' || patch.mode === 'manual') group.mode = patch.mode
    this.save()
  }

  remove(id: string): void {
    this.saved.groups = this.saved.groups.filter((group) => group.id !== id)
    delete this.saved.pending[id]
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
