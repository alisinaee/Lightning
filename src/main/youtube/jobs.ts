import { type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { shell } from 'electron'
import type { ResolvedPrefs } from '../../shared/types'
import type { StartYoutubeRequest, YoutubeJob } from '../../shared/youtube'
import { getDefaultDownloadsDir } from '../download/paths'
import { readJson, updateJson } from '../jsonFile'
import { log } from '../logger'
import { proxyArg, spawnYtDlp, youtubeDataDir } from './binary'

export interface YoutubeJobManagerOptions {
  getPrefs: () => Promise<ResolvedPrefs>
  onChange: (job: YoutubeJob) => void
  onFinished: (job: YoutubeJob) => void
}

interface ActiveRun {
  child: ChildProcess
  stopped?: 'pause' | 'cancel' | 'remove'
}

function parseBytes(str: string): number {
  const num = parseFloat(str)
  if (isNaN(num)) return 0
  const upper = str.toUpperCase()
  if (upper.includes('G')) return Math.round(num * 1024 * 1024 * 1024)
  if (upper.includes('M')) return Math.round(num * 1024 * 1024)
  if (upper.includes('K')) return Math.round(num * 1024)
  return Math.round(num)
}

function parseSpeed(str: string): number {
  if (!str || str === 'NA') return 0
  return parseBytes(str.replace('/s', ''))
}

function parseEta(str: string): number | undefined {
  if (!str || str === 'NA') return undefined
  const parts = str.split(':').map((p) => parseInt(p, 10))
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1]
  }
  if (parts.length === 1 && !isNaN(parts[0])) {
    return parts[0]
  }
  return undefined
}

export class YoutubeJobManager {
  private jobs: Map<string, YoutubeJob> = new Map()
  private active: Map<string, ActiveRun> = new Map()
  private options: YoutubeJobManagerOptions
  private loaded = false

  constructor(options: YoutubeJobManagerOptions) {
    this.options = options
  }

  private storageFile(): string {
    return join(youtubeDataDir(), 'jobs.json')
  }

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const stored = (await readJson(this.storageFile())) as YoutubeJob[] | undefined
      if (Array.isArray(stored)) {
        for (const job of stored) {
          if (job.status === 'downloading') {
            job.status = 'paused'
          }
          this.jobs.set(job.id, job)
        }
      }
    } catch (err: unknown) {
      log.warn('youtube', `could not load jobs: ${String((err as Error)?.message || err)}`)
    }
  }

  private async persist(): Promise<void> {
    await mkdir(youtubeDataDir(), { recursive: true })
    const list = Array.from(this.jobs.values())
    await updateJson(this.storageFile(), () => list)
  }

  listJobs(): YoutubeJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.createdAt - a.createdAt)
  }

  getJob(id: string): YoutubeJob | undefined {
    return this.jobs.get(id)
  }

  async startJob(request: StartYoutubeRequest): Promise<YoutubeJob> {
    await this.load()
    const destDir = request.destDir || getDefaultDownloadsDir()

    const job: YoutubeJob = {
      id: randomUUID(),
      url: request.url,
      title: request.title,
      thumbnail: request.thumbnail,
      formatId: request.formatId,
      resolution: request.resolution,
      destDir,
      status: 'queued',
      received: 0,
      total: 0,
      speed: 0,
      percent: 0,
      createdAt: Date.now()
    }

    this.jobs.set(job.id, job)
    await this.persist()
    this.options.onChange(job)

    this.runDownload(job)
    return job
  }

  private async runDownload(job: YoutubeJob): Promise<void> {
    const prefs = await this.options.getPrefs()
    const proxy = proxyArg(prefs)

    await mkdir(job.destDir, { recursive: true })

    const outputTemplate = join(job.destDir, '%(title)s [%(id)s].%(ext)s')
    const progressTemplate =
      '%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s'

    const args = [
      '--newline',
      '--no-playlist',
      '--no-warnings',
      '--progress-template',
      progressTemplate,
      '-f',
      job.formatId,
      '-o',
      outputTemplate
    ]

    if (proxy) {
      args.push('--proxy', proxy)
    }

    args.push(job.url)

    job.status = 'downloading'
    job.error = undefined
    this.options.onChange(job)

    let child: ChildProcess
    try {
      child = spawnYtDlp(args)
    } catch (err: unknown) {
      job.status = 'error'
      job.error = String((err as Error)?.message || err)
      this.options.onChange(job)
      this.options.onFinished(job)
      await this.persist()
      return
    }

    const run: ActiveRun = { child }
    this.active.set(job.id, run)
    job.pid = child.pid

    let lineBuffer = ''
    let lastError = ''

    child.stdout?.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString('utf-8')
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() ?? ''

      for (const line of lines) {
        this.handleProgressLine(job, line)
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8')
      lastError += text
    })

    child.on('close', async (code) => {
      this.active.delete(job.id)
      job.pid = undefined
      job.speed = 0

      if (run.stopped === 'pause') {
        job.status = 'paused'
      } else if (run.stopped === 'cancel' || run.stopped === 'remove') {
        job.status = 'cancelled'
      } else if (code === 0) {
        job.status = 'completed'
        job.percent = 100
        job.finishedAt = Date.now()
        await this.detectOutputFile(job)
        this.options.onFinished(job)
      } else {
        job.status = 'error'
        job.error = lastError.trim() || `Download failed with exit code ${code}`
        this.options.onFinished(job)
      }

      this.options.onChange(job)
      await this.persist()
    })

    child.on('error', async (err) => {
      this.active.delete(job.id)
      job.pid = undefined
      job.status = 'error'
      job.error = err.message
      this.options.onChange(job)
      this.options.onFinished(job)
      await this.persist()
    })
  }

  private handleProgressLine(job: YoutubeJob, rawLine: string): void {
    const line = rawLine.trim()
    if (!line) return

    // Template format: percent|speed|eta|downloaded|total
    if (line.includes('|')) {
      const [pctStr, speedStr, etaStr, dlStr, totalStr] = line.split('|')
      const pct = parseFloat(pctStr?.replace('%', '') ?? '0')
      if (!isNaN(pct)) {
        job.percent = Math.min(100, Math.max(0, pct))
      }
      job.speed = parseSpeed(speedStr ?? '')
      job.eta = parseEta(etaStr ?? '')

      const dl = parseInt(dlStr ?? '0', 10)
      if (!isNaN(dl) && dl > 0) {
        job.received = dl
      }
      const tot = parseInt(totalStr ?? '0', 10)
      if (!isNaN(tot) && tot > 0) {
        job.total = tot
      }

      this.options.onChange(job)
    } else if (line.startsWith('[download] Destination:')) {
      job.fileName = line.replace('[download] Destination:', '').trim()
      this.options.onChange(job)
    }
  }

  private async detectOutputFile(job: YoutubeJob): Promise<void> {
    try {
      const files = await readdir(job.destDir)
      // Find file that contains the youtube video title or video id
      const match = files.find((f) => !f.endsWith('.part') && !f.endsWith('.ytdl'))
      if (match) {
        job.fileName = join(job.destDir, match)
      }
    } catch {
      // ignore
    }
  }

  async pauseJob(id: string): Promise<void> {
    const run = this.active.get(id)
    const job = this.jobs.get(id)
    if (!job) return

    if (run) {
      run.stopped = 'pause'
      run.child.kill('SIGTERM')
    } else if (job.status === 'downloading' || job.status === 'queued') {
      job.status = 'paused'
      this.options.onChange(job)
      await this.persist()
    }
  }

  async resumeJob(id: string): Promise<void> {
    const job = this.jobs.get(id)
    if (!job || job.status === 'downloading') return
    this.runDownload(job)
  }

  async cancelJob(id: string): Promise<void> {
    const run = this.active.get(id)
    const job = this.jobs.get(id)
    if (!job) return

    if (run) {
      run.stopped = 'cancel'
      run.child.kill('SIGTERM')
    }
    job.status = 'cancelled'
    this.options.onChange(job)
    await this.persist()
  }

  async retryJob(id: string): Promise<void> {
    const job = this.jobs.get(id)
    if (!job) return
    job.status = 'queued'
    job.error = undefined
    this.options.onChange(job)
    this.runDownload(job)
  }

  async removeJob(id: string, deleteFile = false): Promise<void> {
    await this.cancelJob(id)
    const job = this.jobs.get(id)
    if (deleteFile && job?.fileName && existsSync(job.fileName)) {
      try {
        await rm(job.fileName, { force: true })
      } catch {
        // ignore
      }
    }
    this.jobs.delete(id)
    await this.persist()
  }

  revealJob(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (job.fileName && existsSync(job.fileName)) {
      shell.showItemInFolder(job.fileName)
    } else if (existsSync(job.destDir)) {
      shell.openPath(job.destDir)
    }
  }

  openJob(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (job.fileName && existsSync(job.fileName)) {
      shell.openPath(job.fileName)
    }
  }
}
