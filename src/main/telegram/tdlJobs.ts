import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, open, readdir, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { app, shell } from 'electron'
import type { ResolvedPrefs } from '../../shared/types'
import { mediaKindOf, type TdlItem, type TdlJob, type TgMediaKind } from '../../shared/telegram'
import { readJson, updateJson } from '../jsonFile'
import { log } from '../logger'
import { baseArgs, failureReason, proxyArg, spawnTdl } from './tdlBinary'
import { filteredExport, readExport } from './tdlExport'
import {
  floodWaitSeconds,
  isErrorLine,
  LineSplitter,
  messageIdOf,
  parseProgressLine,
  stripAnsi
} from './tdlProgress'

const POLL_MS = 1000
const PERSIST_MS = 1000
const TAIL_LINES = 40
const LOG_READ_BYTES = 1024 * 1024

const KIND_FOLDERS: Record<TgMediaKind, string> = {
  video: 'Videos',
  photo: 'Photos',
  audio: 'Audio',
  document: 'Documents',
  other: 'Other'
}

interface Runtime {
  child: ChildProcess
  /** Why this process was stopped on purpose; its exit is then not a failure. */
  stopped?: 'pause' | 'cancel' | 'remove' | 'quit'
  timer: NodeJS.Timeout
  tail: string[]
  /** Error lines by message id, for the items that did not arrive. */
  errors: Map<string, string>
  flood: number | null
  /** Final files that were in the folder before the run: what skip-same skips. */
  existing: Set<string>
  logOffset: number
  lastBytes: Map<string, number>
  mode: 'restart' | 'continue'
}

export interface TdlJobManagerOptions {
  getPrefs: () => Promise<ResolvedPrefs>
  /** Called with a copy of the job after every change (the caller throttles). */
  onChange: (job: TdlJob) => void
  /** A job reached completed, error or cancelled. */
  onFinished: (job: TdlJob) => void
}

/** `${chat}/${message}` of a Telegram message link. */
export function keyOfLink(link: string): string | null {
  const path = /(?:t|telegram)\.me\/(.+?)(?:[?#].*)?$/i.exec(link)?.[1]
  const parts = path?.split('/').filter(Boolean) ?? []
  if (parts.length < 2) return null
  const chat = parts[0] === 'c' ? parts[1] : parts[0]
  const message = parts[parts.length - 1]
  return chat && /^\d+$/.test(message) ? `${chat}/${message}` : null
}

function messageOf(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1)
}

function itemMatcher(item: TdlItem): RegExp {
  const message = messageOf(item.key)
  return new RegExp(`(?<![0-9])${message}(?![0-9])`)
}

const isTemp = (name: string): boolean => /\.(tmp|part)$/i.test(name)

/** The part of a default-template name after <dialog>_<message>_. */
function shownName(file: string): string {
  return /^\d+_\d+_(.+)$/.exec(file)?.[1] ?? file
}

export class TdlJobManager {
  private jobs = new Map<string, TdlJob>()
  private running = new Map<string, Runtime>()
  /** Jobs that have not run yet, which tdl starts over (--restart) instead of continuing. */
  private fresh = new Set<string>()
  private persistTimer?: NodeJS.Timeout
  private loaded = false

  constructor(private readonly options: TdlJobManagerOptions) {}

  private get file(): string {
    return join(app.getPath('userData'), 'telegram-jobs.json')
  }

  async load(): Promise<void> {
    let saved: unknown
    try {
      saved = await readJson(this.file)
    } catch (error) {
      log.warn('telegram', 'could not read the job list', error)
    }
    const list = (saved as { jobs?: unknown } | undefined)?.jobs
    for (const entry of Array.isArray(list) ? (list as TdlJob[]) : []) {
      if (!entry || typeof entry.id !== 'string' || !Array.isArray(entry.items)) continue
      // A process from the last run is gone.
      if (entry.status === 'running' || entry.status === 'exporting') entry.status = 'paused'
      delete entry.pid
      for (const item of entry.items) {
        if (item.status === 'downloading') item.status = 'waiting'
        item.speed = 0
      }
      this.jobs.set(entry.id, entry)
    }
    this.loaded = true
    this.pump()
  }

  list(): TdlJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  async create(input: {
    links?: string[]
    exportFile?: string
    keys?: string[]
    dir: string
  }): Promise<string> {
    let source: TdlJob['source']
    let items: TdlItem[]
    if (input.links?.length) {
      const seen = new Set<string>()
      items = []
      const links: string[] = []
      for (const link of input.links) {
        const key = keyOfLink(link)
        if (!key || seen.has(key)) continue
        seen.add(key)
        links.push(link)
        items.push({
          key,
          link,
          fileName: `Message ${messageOf(key)}`,
          media: 'other',
          received: 0,
          total: 0,
          speed: 0,
          status: 'waiting'
        })
      }
      if (items.length === 0) throw new Error('No Telegram message links to download.')
      source = { type: 'links', links }
    } else if (input.exportFile) {
      const exported = await readExport(input.exportFile)
      const wanted = input.keys ? new Set(input.keys) : null
      items = exported.items.filter((item) => !wanted || wanted.has(item.key))
      if (items.length === 0) throw new Error('Nothing selected to download.')
      const file = wanted
        ? await filteredExport(
            input.exportFile,
            items.map((i) => i.key)
          )
        : input.exportFile
      source = { type: 'export', chat: exported.chat, range: `${items.length} files`, file }
    } else {
      throw new Error('Nothing to download.')
    }
    await mkdir(input.dir, { recursive: true })
    const job: TdlJob = {
      id: randomUUID(),
      source,
      dir: input.dir,
      status: 'queued',
      items,
      createdAt: Date.now()
    }
    this.jobs.set(job.id, job)
    this.fresh.add(job.id)
    this.changed(job)
    this.pump()
    return job.id
  }

  pause(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (job.status === 'queued') {
      job.status = 'paused'
      this.changed(job)
    } else if (this.running.has(id)) {
      this.stop(id, 'pause')
    }
  }

  resume(id: string): void {
    const job = this.jobs.get(id)
    if (!job || (job.status !== 'paused' && job.status !== 'error')) return
    job.status = 'queued'
    delete job.error
    delete job.finishedAt
    this.changed(job)
    this.pump()
  }

  cancel(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (this.running.has(id)) {
      this.stop(id, 'cancel')
      return
    }
    if (job.status === 'queued' || job.status === 'paused') this.finish(job, 'cancelled')
  }

  /** Runs the failed items again (and anything not yet downloaded). */
  retry(id: string): void {
    const job = this.jobs.get(id)
    if (!job || this.running.has(id)) return
    let any = false
    for (const item of job.items) {
      if (item.status === 'failed') {
        item.status = 'waiting'
        item.received = 0
        delete item.error
        any = true
      } else if (item.status === 'waiting') {
        any = true
      }
    }
    if (!any) return
    job.status = 'queued'
    delete job.error
    delete job.finishedAt
    this.changed(job)
    this.pump()
  }

  async remove(id: string, options?: { trashFiles?: boolean }): Promise<void> {
    const job = this.jobs.get(id)
    if (!job) return
    if (this.running.has(id)) this.stop(id, 'remove')
    this.jobs.delete(id)
    this.fresh.delete(id)
    if (options?.trashFiles) {
      for (const item of job.items) {
        if (!item.path) continue
        try {
          await shell.trashItem(item.path)
        } catch {
          // Already gone or not trashable: the job is forgotten all the same.
        }
      }
    }
    this.schedulePersist()
  }

  async reveal(jobId: string, key: string): Promise<boolean> {
    const path = this.pathOf(jobId, key)
    if (!path) return false
    shell.showItemInFolder(path)
    return true
  }

  async open(jobId: string, key: string): Promise<boolean> {
    const path = this.pathOf(jobId, key)
    return path ? (await shell.openPath(path)) === '' : false
  }

  /** On quit: stop the processes (their jobs resume as paused) and write the list. */
  async dispose(): Promise<void> {
    for (const id of [...this.running.keys()]) this.stop(id, 'quit')
    clearTimeout(this.persistTimer)
    if (this.loaded) await this.persistNow()
  }

  private pathOf(jobId: string, key: string): string | null {
    const path = this.jobs.get(jobId)?.items.find((item) => item.key === key)?.path
    return path && existsSync(path) ? path : null
  }

  // --- the queue -------------------------------------------------------------------------

  /** One tdl process at a time: its storage allows no more. Parallelism is -l and -t inside it. */
  private pump(): void {
    if (this.running.size > 0) return
    const next = this.list()
      .reverse()
      .find((job) => job.status === 'queued')
    if (next) void this.run(next)
  }

  private stop(id: string, why: NonNullable<Runtime['stopped']>): void {
    const runtime = this.running.get(id)
    if (!runtime) return
    runtime.stopped = why
    // Still starting up (no process yet): run() stops it once it has one.
    runtime.child?.kill()
  }

  private async run(job: TdlJob): Promise<void> {
    job.status = 'running'
    // Held while arguments are built, so a second pump does not start another process.
    const placeholder = { stopped: undefined } as unknown as Runtime
    this.running.set(job.id, placeholder)
    let runtime: Runtime
    try {
      const prefs = await this.options.getPrefs()
      const mode: Runtime['mode'] = this.fresh.delete(job.id) ? 'restart' : 'continue'
      const args = [...baseArgs(proxyArg(prefs)), 'dl', '-d', job.dir]
      args.push('-t', String(Math.min(16, Math.max(1, prefs.telegramThreads))))
      args.push('-l', String(Math.min(8, Math.max(1, prefs.telegramParallel))))
      args.push(mode === 'restart' ? '--restart' : '--continue')
      if (prefs.telegramSkipSame || mode === 'continue') args.push('--skip-same')
      if (prefs.telegramGroupAlbums) args.push('--group')
      if (prefs.telegramTakeout) args.push('--takeout')
      if (prefs.telegramTemplate) args.push('--template', prefs.telegramTemplate)
      const todo = job.items.filter(
        (item) => item.status === 'waiting' || item.status === 'downloading'
      )
      const all = todo.length === job.items.length
      if (job.source.type === 'links') {
        for (const item of todo) if (item.link) args.push('-u', item.link)
      } else if (all) {
        args.push('-f', job.source.file)
      } else {
        const file = await filteredExport(
          job.source.file,
          todo.map((item) => item.key)
        )
        args.push('-f', file)
      }
      await mkdir(job.dir, { recursive: true })
      const existing = new Set((await readdir(job.dir).catch(() => [])).filter((n) => !isTemp(n)))
      const logOffset = await stat(join(homedir(), '.tdl', 'log', 'latest.log')).then(
        (s) => s.size,
        () => 0
      )
      for (const item of todo) item.status = 'waiting'
      const child = spawnTdl(args)
      runtime = {
        child,
        timer: setInterval(() => void this.poll(job), POLL_MS),
        tail: [],
        errors: new Map(),
        flood: null,
        existing,
        logOffset,
        lastBytes: new Map(),
        mode
      }
      runtime.stopped = placeholder.stopped
      if (runtime.stopped) child.kill()
      this.running.set(job.id, runtime)
      job.pid = child.pid
      log.info('telegram', `job ${job.id.slice(0, 8)} started (${todo.length} files, ${mode})`)
      this.changed(job)
      const splitter = new LineSplitter()
      const read = (data: Buffer | string): void => {
        for (const line of splitter.push(String(data))) this.line(job, runtime, line)
      }
      child.stdout?.on('data', read)
      child.stderr?.on('data', read)
      child.on('error', (error) => void this.exited(job, runtime, null, error.message))
      child.on('close', (code) => void this.exited(job, runtime, code))
    } catch (error) {
      this.running.delete(job.id)
      job.status = 'error'
      job.error = error instanceof Error ? error.message : String(error)
      this.finish(job, 'error', job.error)
    }
  }

  private line(job: TdlJob, runtime: Runtime, raw: string): void {
    const update = parseProgressLine(raw)
    if (update) {
      const message = messageIdOf(update.name)
      const item = message ? job.items.find((i) => messageOf(i.key) === message) : undefined
      if (item && item.status !== 'done' && item.status !== 'skipped') {
        item.status =
          update.received >= update.total && update.total > 0 ? item.status : 'downloading'
        item.fileName = shownName(update.name)
        item.media = mediaKindOf(item.fileName)
        item.received = update.received
        if (update.total) item.total = update.total
        item.speed = update.speed
      }
      return
    }
    const line = stripAnsi(raw).trim()
    if (!line) return
    runtime.tail.push(line)
    if (runtime.tail.length > TAIL_LINES) runtime.tail.shift()
    const flood = floodWaitSeconds(line)
    if (flood !== null) runtime.flood = flood
    const message = messageIdOf(line)
    if (message && isErrorLine(line)) runtime.errors.set(message, line.slice(0, 200))
  }

  /** Every second: what is on disk is the truth about progress. */
  private async poll(job: TdlJob): Promise<void> {
    const runtime = this.running.get(job.id)
    if (!runtime) return
    if (await this.scan(job, runtime, true)) this.changed(job)
  }

  /** Matches the folder's files to the job's items. Returns whether anything changed. */
  private async scan(job: TdlJob, runtime: Runtime, live: boolean): Promise<boolean> {
    let names: string[]
    try {
      names = await readdir(job.dir)
    } catch {
      return false
    }
    let changed = false
    const claimed = new Set<string>()
    for (const item of job.items) {
      if (item.status === 'done' || item.status === 'skipped') continue
      const matcher = itemMatcher(item)
      const chat = item.key.slice(0, item.key.lastIndexOf('/'))
      const matches = names.filter((name) => matcher.test(name) && !claimed.has(name))
      const best = matches.find((name) => name.startsWith(`${chat}_`)) ?? matches[0]
      if (!best) continue
      claimed.add(best)
      const path = join(job.dir, best)
      const size = (await stat(path).catch(() => null))?.size
      if (size === undefined) continue
      if (isTemp(best)) {
        const before = runtime.lastBytes.get(item.key) ?? item.received
        const speed = live ? Math.max(0, (size - before) * (1000 / POLL_MS)) : 0
        runtime.lastBytes.set(item.key, size)
        if (item.status !== 'downloading' || item.received !== size) changed = true
        item.status = 'downloading'
        item.received = size
        item.speed = speed || item.speed
        const name = best.replace(/\.(tmp|part)$/i, '')
        item.fileName = shownName(name)
        item.media = mediaKindOf(item.fileName)
      } else {
        const wasThere = runtime.existing.has(best)
        item.status = wasThere ? 'skipped' : 'done'
        item.fileName = shownName(best)
        item.media = mediaKindOf(item.fileName)
        item.received = size
        item.total = size
        item.speed = 0
        item.path = path
        delete item.error
        changed = true
      }
    }
    return changed
  }

  private async exited(
    job: TdlJob,
    runtime: Runtime,
    code: number | null,
    spawnError?: string
  ): Promise<void> {
    if (this.running.get(job.id) !== runtime) return
    clearInterval(runtime.timer)
    await this.scan(job, runtime, false)
    const logErrors = await this.logErrors(runtime)
    this.running.delete(job.id)
    delete job.pid
    for (const item of job.items) item.speed = 0

    if (runtime.stopped === 'remove' || runtime.stopped === 'quit') {
      for (const item of job.items) if (item.status === 'downloading') item.status = 'waiting'
      if (runtime.stopped === 'quit') job.status = 'paused'
      this.pump()
      return
    }
    if (runtime.stopped === 'cancel') {
      for (const item of job.items) if (item.status === 'downloading') item.status = 'waiting'
      this.finish(job, 'cancelled')
      this.pump()
      return
    }
    if (runtime.stopped === 'pause') {
      for (const item of job.items) if (item.status === 'downloading') item.status = 'waiting'
      job.status = 'paused'
      this.changed(job)
      this.pump()
      return
    }

    const reason = (): string =>
      runtime.flood !== null
        ? `Telegram asked to wait ${runtime.flood} seconds (FLOOD_WAIT).`
        : (spawnError ?? failureReason(runtime.tail.join('\n')))
    if (code !== 0) {
      for (const item of job.items) if (item.status === 'downloading') item.status = 'waiting'
      this.finish(job, 'error', reason())
      this.pump()
      return
    }

    // tdl exits 0 even when some files failed, so the folder says what arrived.
    let failed = 0
    for (const item of job.items) {
      if (item.status === 'done' || item.status === 'skipped') continue
      const message = messageOf(item.key)
      item.status = 'failed'
      item.error =
        runtime.errors.get(message) ??
        logErrors.get(message) ??
        (runtime.flood !== null ? reason() : 'Not downloaded')
      failed++
    }
    await this.sortByKind(job)
    if (failed > 0) this.finish(job, 'error', `${failed} of ${job.items.length} files failed`)
    else this.finish(job, 'completed')
    this.pump()
  }

  /** Error lines tdl wrote to its log during the run, by message id. */
  private async logErrors(runtime: Runtime): Promise<Map<string, string>> {
    const errors = new Map<string, string>()
    try {
      const handle = await open(join(homedir(), '.tdl', 'log', 'latest.log'), 'r')
      try {
        const { size } = await handle.stat()
        const length = Math.min(LOG_READ_BYTES, Math.max(0, size - runtime.logOffset))
        if (length > 0) {
          const buffer = Buffer.alloc(length)
          await handle.read(buffer, 0, length, size - length)
          for (const line of buffer.toString('utf-8').split('\n')) {
            const message = messageIdOf(line)
            if (message && isErrorLine(line))
              errors.set(message, line.replace(/^\S+\s+/, '').slice(0, 200))
          }
        }
      } finally {
        await handle.close()
      }
    } catch {
      // No log: the folder alone decides.
    }
    return errors
  }

  private async sortByKind(job: TdlJob): Promise<void> {
    const prefs = await this.options.getPrefs()
    if (!prefs.telegramSortByKind) return
    for (const item of job.items) {
      if (
        item.status !== 'done' ||
        !item.path ||
        item.path.startsWith(join(job.dir, KIND_FOLDERS[item.media]))
      )
        continue
      try {
        const folder = join(job.dir, KIND_FOLDERS[item.media])
        await mkdir(folder, { recursive: true })
        let target = join(folder, basename(item.path))
        for (let n = 1; existsSync(target); n++) {
          target = join(folder, basename(item.path).replace(/(\.[^.]*)?$/, ` (${n})$1`))
        }
        await rename(item.path, target)
        item.path = target
      } catch (error) {
        log.warn('telegram', 'could not move a file into its folder', error)
      }
    }
  }

  private finish(job: TdlJob, status: 'completed' | 'error' | 'cancelled', error?: string): void {
    job.status = status
    job.finishedAt = Date.now()
    if (error) job.error = error
    else delete job.error
    this.changed(job)
    this.options.onFinished(job)
  }

  private changed(job: TdlJob): void {
    this.options.onChange(structuredClone(job))
    this.schedulePersist()
  }

  private schedulePersist(): void {
    if (this.persistTimer || !this.loaded) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined
      void this.persistNow()
    }, PERSIST_MS)
  }

  private persistNow(): Promise<void> {
    const jobs = this.list().reverse()
    return updateJson(this.file, () => ({ jobs })).catch((error) =>
      log.warn('telegram', 'could not save the job list', error)
    )
  }
}
