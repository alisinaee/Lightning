import { type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { shell } from 'electron'
import type { ResolvedPrefs } from '../../shared/types'
import {
  DEFAULT_YOUTUBE_OPTIONS,
  extractYoutubeId,
  isYoutubeUrl,
  type StartYoutubeRequest,
  type YoutubeJob,
  type YoutubeOptions
} from '../../shared/youtube'
import { getDefaultDownloadsDir } from '../download/paths'
import { addFinishedSource, isFileGone } from '../fileSync'
import { readJson, updateJson } from '../jsonFile'
import { log } from '../logger'
import { proxyArg, runYtDlp, spawnYtDlp, youtubeDataDir } from './binary'
import { optionCookies } from './cookies'
import { canImpersonateChrome, looksBlocked, originReferer } from './anySite'

/** A Netscape cookies file a download reads. A temporary one is deleted when the download ends. */
export interface CookieFile {
  file: string
  temporary: boolean
}

/** How many playlist videos download at once. */
const GROUP_SLOTS = 2

/** A folder name that is safe on every system. */
export function safeFolderName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, 120) || 'Playlist'
}

/** A title as a file name: never hidden, and short enough for every file system. */
function safeFileName(title: string): string {
  let name = safeFolderName(title).replace(/^\.+/, '')
  while (Buffer.byteLength(name) > 180) name = Array.from(name).slice(0, -1).join('')
  return name.trim() || 'Video'
}

/** The name as part of a yt-dlp output template. */
const templateText = (name: string): string => name.replace(/%/g, '%%')

export interface YoutubeJobManagerOptions {
  getPrefs: () => Promise<ResolvedPrefs>
  getOptions: () => Promise<YoutubeOptions>
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

/** Marks the line on which yt-dlp says where the finished file is. */
const FILE_MARK = '[lightning-file] '

export class YoutubeJobManager {
  private jobs: Map<string, YoutubeJob> = new Map()
  private active: Map<string, ActiveRun> = new Map()
  private options: YoutubeJobManagerOptions
  private loaded = false
  private cookieFiles: Map<string, CookieFile> = new Map()
  /** The page a browser offer came from (referer and user agent), for that video's download only. */
  private requestExtras: Map<string, { referer?: string; userAgent?: string }> = new Map()
  /** Playlist videos waiting for a free slot, and the ones downloading now. */
  private groupWaiting: string[] = []
  private groupRunning: Set<string> = new Set()
  private disposed = false

  constructor(options: YoutubeJobManagerOptions) {
    this.options = options
    addFinishedSource(() => this.removeMissingFinished())
  }

  /** Auto sync: a finished video whose file was moved or deleted leaves the list (the record
   * only). One with no file recorded stays. Returns how many went. */
  async removeMissingFinished(): Promise<number> {
    if (!(await this.options.getPrefs()).autoSyncFiles) return 0
    const candidates = [...this.jobs.values()].filter(
      (job): job is YoutubeJob & { fileName: string } =>
        job.status === 'completed' && Boolean(job.fileName)
    )
    const checks = await Promise.all(
      candidates.map(async (job) => ((await isFileGone(job.fileName)) ? job.id : null))
    )
    const gone = checks.filter((id): id is string => id !== null)
    if (gone.length === 0) return 0
    for (const id of gone) {
      if (this.jobs.get(id)?.status === 'completed') this.jobs.delete(id)
    }
    await this.persist()
    log.info('youtube', `removed ${gone.length} finished from the list: their files are gone`)
    return gone.length
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
          await this.repairFileName(job)
          this.jobs.set(job.id, job)
          // A playlist video that never started goes back in line.
          if (job.groupId && job.status === 'queued') this.groupWaiting.push(job.id)
        }
        this.redoMistakenForOthers()
        // Not waited for: macOS may first ask the person about the folder.
        void this.measureOld()
        this.pump()
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

  /** Earlier versions gave different streams the same file name ("index", "1080p"): yt-dlp took the
   * first one's file for the others and they ended without being downloaded. Those start again. */
  private redoMistakenForOthers(): void {
    const all = [...this.jobs.values()]
    for (const job of all) {
      if (job.status !== 'completed' || !job.fileName || job.outputName || job.received > 0)
        continue
      const mistaken = all.some(
        (other) => other.fileName === job.fileName && other.received > 0 && other.url !== job.url
      )
      if (!mistaken) continue
      job.fileName = undefined
      job.status = 'queued'
      job.finishedAt = undefined
      job.percent = 0
      job.total = 0
      this.groupWaiting.push(job.id)
      log.info('youtube', 'downloading again: another video had its file name', { id: job.id })
    }
  }

  /** The output template of a job. A stream's title and id are often only "index" or "1080p", and one
   * YouTube video can be wanted at two qualities: each job gets a file name nothing else has, or
   * yt-dlp would take the other file for this video and download nothing. */
  private outputFor(
    job: YoutubeJob,
    options: YoutubeOptions,
    generic: boolean,
    files: string[]
  ): string {
    if (generic && options.outputTemplate === DEFAULT_YOUTUBE_OPTIONS.outputTemplate) {
      // One an earlier version began continues under the name it has.
      if (!job.outputName && job.received > 0) return options.outputTemplate
      if (!job.outputName) {
        const taken = new Set<string>()
        const jobs = [...this.jobs.values()].filter((other) => other.id !== job.id)
        for (const other of jobs) {
          if (other.outputName) taken.add(other.outputName.toLowerCase())
          if (other.fileName) {
            const file = basename(other.fileName)
            taken.add(file.slice(0, file.length - extname(file).length).toLowerCase())
          }
        }
        const isTaken = (name: string): boolean => {
          const lower = name.normalize('NFC').toLowerCase()
          return (
            taken.has(lower) ||
            files.some((file) => file.normalize('NFC').toLowerCase().startsWith(`${lower}.`))
          )
        }
        const base = safeFileName(job.title)
        let name = base
        for (let n = 2; isTaken(name); n += 1) name = `${base} (${n})`
        job.outputName = name
      }
      return `${templateText(job.outputName)}.%(ext)s`
    }
    const id = extractYoutubeId(job.url)
    const other = [...this.jobs.values()].some(
      (item) =>
        item.id !== job.id &&
        item.createdAt <= job.createdAt &&
        item.destDir === job.destDir &&
        (generic
          ? item.url !== job.url && item.title === job.title
          : id !== null && extractYoutubeId(item.url) === id && item.formatId !== job.formatId)
    )
    if (!other || (!job.outputName && job.received > 0)) return options.outputTemplate
    job.outputName ??= generic ? job.id.slice(0, 8) : safeFileName(job.resolution)
    const mark = ` (${templateText(job.outputName)})`
    return options.outputTemplate.includes('.%(ext)s')
      ? options.outputTemplate.replace('.%(ext)s', `${mark}.%(ext)s`)
      : `${options.outputTemplate}${mark}`
  }

  /** The finished file's own size: the last progress seen is only its sound track, when video and
   * sound are separate. */
  private async measure(job: YoutubeJob): Promise<void> {
    if (job.status !== 'completed' || !job.fileName) return
    const size = await stat(job.fileName).then(
      (info) => info.size,
      () => 0
    )
    if (size > 0) job.total = job.received = size
  }

  /** Sizes recorded by earlier versions, corrected. */
  private async measureOld(): Promise<void> {
    for (const job of [...this.jobs.values()]) {
      const before = job.total
      await this.measure(job)
      if (job.total !== before) this.options.onChange(job)
    }
  }

  /** A playlist becomes a group: one job per video, in a folder named for the playlist. The videos
   * download two at a time (see pump). Returns the new jobs. */
  async startPlaylist(request: StartYoutubeRequest, cookies?: CookieFile): Promise<YoutubeJob[]> {
    await this.load()
    const options = await this.options.getOptions()
    const proxy = proxyArg(await this.options.getPrefs())
    const args = ['--flat-playlist', '--yes-playlist', '--dump-single-json', '--no-warnings']
    if (proxy) args.push('--proxy', proxy)
    const shared = cookies ?? optionCookies(options)
    if (shared) args.push('--cookies', shared.file)
    if (options.playlistItems) args.push('--playlist-items', options.playlistItems)
    args.push(request.url)

    const { code, stdout, stderr } = await runYtDlp(args, 120_000)
    if (code !== 0 || !stdout.trim()) {
      throw new Error(stderr.trim() || `Could not read the playlist (exit code ${code})`)
    }
    const raw = JSON.parse(stdout) as {
      title?: string
      entries?: { id?: string; title?: string }[]
    }
    const entries = (raw.entries ?? [])
      .filter((entry): entry is { id: string; title?: string } =>
        /^[\w-]{6,}$/.test(entry.id ?? '')
      )
      .slice(0, 1000)
    if (entries.length === 0) throw new Error('That playlist has no videos')
    // "Stop after N files" (0 means no limit) applies to the playlist's videos taken in order.
    const limit = options.maxDownloads > 0 ? options.maxDownloads : entries.length

    const groupId = randomUUID()
    const groupTitle = (raw.title || request.title || 'Playlist').slice(0, 200)
    const folder = safeFolderName(groupTitle)
    const destDir = join(request.destDir || options.folder || getDefaultDownloadsDir(), folder)

    const created: YoutubeJob[] = []
    for (const entry of entries.slice(0, limit)) {
      const id = randomUUID()
      let entryCookies = shared
      if (cookies?.temporary) {
        // Each video needs its own copy: a download deletes its copy when it ends.
        const file = join(youtubeDataDir(), `cookies-${id}.txt`)
        await copyFile(cookies.file, file)
        entryCookies = { file, temporary: true }
      }
      const job: YoutubeJob = {
        id,
        url: `https://www.youtube.com/watch?v=${entry.id}`,
        title: entry.title || entry.id,
        formatId: request.formatId,
        resolution: request.resolution,
        destDir,
        status: 'queued',
        received: 0,
        total: 0,
        speed: 0,
        percent: 0,
        createdAt: Date.now(),
        groupId,
        groupTitle
      }
      this.jobs.set(id, job)
      if (entryCookies) this.cookieFiles.set(id, entryCookies)
      this.groupWaiting.push(id)
      created.push(job)
    }
    if (cookies?.temporary) await rm(cookies.file, { force: true })

    await this.persist()
    for (const job of created) this.options.onChange(job)
    this.pump()
    return created
  }

  /** Starts playlist videos while fewer than GROUP_SLOTS are running. */
  private pump(): void {
    if (this.disposed) return
    while (this.groupRunning.size < GROUP_SLOTS && this.groupWaiting.length > 0) {
      const id = this.groupWaiting.shift()
      const job = id ? this.jobs.get(id) : undefined
      if (!job || job.status !== 'queued') continue
      this.groupRunning.add(job.id)
      void this.runDownload(job)
    }
  }

  /** Fills in what a probe learned after the job started (a browser video is queued before it is probed). */
  setMeta(id: string, meta: { title?: string; thumbnail?: string }): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (meta.title) job.title = meta.title
    if (meta.thumbnail) job.thumbnail = meta.thumbnail
    this.options.onChange(job)
    void this.persist()
  }

  listJobs(): YoutubeJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.createdAt - a.createdAt)
  }

  getJob(id: string): YoutubeJob | undefined {
    return this.jobs.get(id)
  }

  async startJob(
    request: StartYoutubeRequest,
    cookies?: CookieFile,
    extras?: { referer?: string; userAgent?: string }
  ): Promise<YoutubeJob> {
    await this.load()
    const options = await this.options.getOptions()
    const destDir = request.destDir || options.folder || getDefaultDownloadsDir()

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
    if (cookies) this.cookieFiles.set(job.id, cookies)
    if (extras) this.requestExtras.set(job.id, extras)
    await this.persist()
    this.options.onChange(job)

    this.runDownload(job)
    return job
  }

  /** `impersonated`: this run is the Chrome retry for a site that refused a plain client. */
  private async runDownload(job: YoutubeJob, impersonated = false): Promise<void> {
    const prefs = await this.options.getPrefs()
    const proxy = proxyArg(prefs)

    await mkdir(job.destDir, { recursive: true })

    const options = await this.options.getOptions()
    const generic = !isYoutubeUrl(job.url)
    // Asked for without blocking: macOS may first ask the person about the folder.
    const files = await readdir(job.destDir).catch(() => [] as string[])
    const outputTemplate = join(
      templateText(job.destDir),
      this.outputFor(job, options, generic, files)
    )
    await this.persist()
    const progressTemplate =
      '%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s'

    // Any site but YouTube: its own rules (see anySite.ts); the YouTube-only options stay off there.
    const extras = this.requestExtras.get(job.id)
    const audioOnly = options.quality === 'audio' || job.formatId.startsWith('bestaudio')
    const args = [
      '--newline',
      '--no-playlist',
      '--no-warnings',
      '--progress-template',
      progressTemplate,
      // The finished file's own path, after merging and conversion (--print alone would hush the rest).
      '--print',
      `after_move:${FILE_MARK}%(filepath)s`,
      '--no-quiet',
      '--progress',
      '--encoding',
      'utf-8',
      '-f',
      options.formatOverride || job.formatId,
      '-o',
      outputTemplate,
      '-R',
      String(options.retries),
      '--socket-timeout',
      String(options.socketTimeout)
    ]

    if (audioOnly) {
      args.push('-x', '--audio-format', options.audioFormat)
    } else {
      // Video and audio are merged into one file by ffmpeg.
      args.push('--merge-output-format', generic ? 'mp4' : options.mergeFormat)
    }
    if (options.formatSort) args.push('-S', options.formatSort)
    if (options.metadata) args.push('--embed-metadata')
    if (options.embedThumbnail) args.push('--embed-thumbnail')
    if (options.embedChapters) args.push('--embed-chapters')
    if (!generic && options.sponsorBlock === 'mark') {
      args.push('--sponsorblock-mark', 'default')
    }
    if (!generic && options.sponsorBlock === 'remove') {
      args.push('--sponsorblock-remove', 'default')
    }
    if (options.subtitles) {
      args.push('--write-subs', '--sub-langs', options.subtitleLangs, '--embed-subs')
    }
    if (options.writeInfoJson) args.push('--write-info-json')
    if (options.writeDescription) args.push('--write-description')
    if (options.writeThumbnail) args.push('--write-thumbnail')
    if (options.useRemoteTime) args.push('--mtime')
    if (options.writeAutoSubs) args.push('--write-auto-subs')
    if (options.splitChapters) args.push('--split-chapters')
    if (options.liveFromStart) args.push('--live-from-start')
    if (options.matchFilter) args.push('--match-filter', options.matchFilter)
    if (options.noOverwrites) args.push('--no-overwrites')
    if (options.restrictFilenames) args.push('--restrict-filenames')
    if (options.windowsFilenames) args.push('--windows-filenames')
    if (options.limitRate) args.push('-r', options.limitRate)
    // Segmented (HLS, DASH) streams of other sites download eight fragments at a time.
    // A stream left behind by a run that was cut short is repaired as a fresh one is.
    if (generic) args.push('--fixup', 'force')
    if (generic) args.push('-N', '8', '--continue', '--fragment-retries', String(options.retries))
    else if (options.concurrentFragments > 1) {
      args.push('-N', String(options.concurrentFragments))
    }
    if (options.sleepInterval > 0) args.push('--sleep-interval', String(options.sleepInterval))
    if (options.dateAfter) args.push('--dateafter', options.dateAfter)
    if (options.dateBefore) args.push('--datebefore', options.dateBefore)
    if (impersonated) args.push('--impersonate', 'chrome')
    else if (options.impersonate) args.push('--impersonate', options.impersonate)
    if (!generic && options.skipDownloaded) {
      args.push('--download-archive', join(youtubeDataDir(), 'archive.txt'))
    }
    const referer = extras?.referer ?? (generic ? originReferer(job.url) : undefined)
    if (referer) args.push('--referer', referer)
    // As Chrome, the user agent is the impersonation's own: another one would give it away.
    if (extras?.userAgent && !impersonated) args.push('--user-agent', extras.userAgent)
    // The name the dialog showed: a stream's own is often only "index" or "master".
    if (generic && job.title) {
      args.push('--replace-in-metadata', 'title', '(?s)^.+$', job.title.replace(/\\/g, '\\\\'))
    }
    if (proxy) {
      args.push('--proxy', proxy)
    }
    // A cookies file sent with this download wins; otherwise the one chosen in the options.
    const cookies = this.cookieFiles.get(job.id) ?? optionCookies(options)
    if (cookies) {
      args.push('--cookies', cookies.file)
    } else if (options.cookiesBrowser) {
      args.push('--cookies-from-browser', options.cookiesBrowser)
    }

    args.push('--', job.url)

    if (this.disposed) return
    job.status = 'downloading'
    job.error = undefined
    this.options.onChange(job)

    let child: ChildProcess
    try {
      child = spawnYtDlp(args)
    } catch (err: unknown) {
      this.groupRunning.delete(job.id)
      job.status = 'error'
      job.error = String((err as Error)?.message || err)
      this.options.onChange(job)
      this.options.onFinished(job)
      await this.dropCookies(job.id)
      await this.persist()
      return
    }

    const run: ActiveRun = { child }
    this.active.set(job.id, run)
    job.pid = child.pid

    let lineBuffer = ''
    let lastError = ''

    // Decoded as a stream, so a character split between two chunks stays whole.
    child.stdout?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk: string) => {
      lineBuffer += chunk
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
      // A site that refused a plain client gets one more run as Chrome, when this yt-dlp can do that.
      if (
        generic &&
        !impersonated &&
        !options.impersonate &&
        code !== 0 &&
        run.stopped === undefined &&
        looksBlocked(lastError) &&
        (await canImpersonateChrome())
      ) {
        void this.runDownload(job, true)
        return
      }
      this.groupRunning.delete(job.id)
      this.pump()
      // A paused download keeps its cookies so it can resume.
      if (run.stopped !== 'pause') await this.dropCookies(job.id)
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
        if (lineBuffer) this.handleProgressLine(job, lineBuffer)
        // Only a file that is really there: another file must never be opened or deleted for this video.
        if (job.fileName && !existsSync(job.fileName)) job.fileName = undefined
        await this.measure(job)
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
      this.groupRunning.delete(job.id)
      this.pump()
      await this.dropCookies(job.id)
      job.pid = undefined
      job.status = 'error'
      job.error = err.message
      this.options.onChange(job)
      this.options.onFinished(job)
      await this.persist()
    })
  }

  /** Forgets a download's cookies file, deleting it when the file was made for that download only. */
  private async dropCookies(id: string): Promise<void> {
    const cookies = this.cookieFiles.get(id)
    if (!cookies) return
    this.cookieFiles.delete(id)
    if (cookies.temporary) await rm(cookies.file, { force: true })
  }

  private handleProgressLine(job: YoutubeJob, rawLine: string): void {
    const line = rawLine.trim()
    if (!line) return

    if (line.startsWith(FILE_MARK)) {
      job.fileName = line.slice(FILE_MARK.length)
      this.options.onChange(job)
      return
    }
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

  /** Earlier versions took any file of the folder (often a hidden one) as the finished video. Such a
   * record is given its real file, found by the video's id, or none. */
  private async repairFileName(job: YoutubeJob): Promise<void> {
    if (!job.fileName || !basename(job.fileName).startsWith('.')) return
    const id = /(?:[?&]v=|\/shorts\/|youtu\.be\/)([\w-]{6,})/.exec(job.url)?.[1]
    const files = id ? await readdir(job.destDir).catch(() => [] as string[]) : []
    const match = files.find(
      (file) =>
        !file.startsWith('.') &&
        file.includes(`[${id}]`) &&
        /\.(mp4|mkv|webm|mov|m4a|mp3|opus|ogg|flac|wav|aac)$/i.test(file)
    )
    job.fileName = match ? join(job.destDir, match) : undefined
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

  /** Starts a stopped download again; `cookies` (a file for this download only) signs it in. */
  async retryJob(id: string, cookies?: CookieFile): Promise<void> {
    const job = this.jobs.get(id)
    if (!job) return
    if (cookies) {
      await this.dropCookies(id)
      this.cookieFiles.set(id, cookies)
    }
    job.status = 'queued'
    job.error = undefined
    job.askingBrowserUntil = undefined
    this.options.onChange(job)
    this.runDownload(job)
  }

  async removeJob(id: string, deleteFile = false): Promise<void> {
    await this.cancelJob(id)
    const job = this.jobs.get(id)
    if (deleteFile && job?.fileName) {
      try {
        await rm(job.fileName, { force: true })
      } catch {
        // ignore
      }
    }
    this.jobs.delete(id)
    await this.persist()
  }

  /** Stops active yt-dlp processes on shutdown so jobs resume as paused on next launch. */
  async dispose(): Promise<void> {
    this.disposed = true
    for (const [id, run] of this.active) {
      run.stopped = 'pause'
      run.child.kill('SIGTERM')
      const job = this.jobs.get(id)
      if (job && job.status === 'downloading') {
        job.status = 'paused'
        job.pid = undefined
        job.speed = 0
      }
    }
    this.active.clear()
    this.groupRunning.clear()
    if (this.loaded) await this.persist()
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
