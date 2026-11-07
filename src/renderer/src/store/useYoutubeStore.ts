import {
  DEFAULT_YOUTUBE_OPTIONS,
  formatForQuality,
  type YoutubeFormatOption,
  type YoutubeJob,
  type YoutubeOptions,
  type YoutubeStatus,
  type YoutubeVideoMeta
} from '@shared/youtube'
import { create } from 'zustand'

export type YoutubeJobFilter = 'all' | 'active' | 'finished' | 'failed'

/** One link in the fetch queue: fetched in the background, waiting for the person to choose. */
export interface YoutubeFetch {
  id: string
  url: string
  offerId: string | null
  state: 'fetching' | 'ready' | 'error'
  meta: YoutubeVideoMeta | null
  error: string | null
}

let fetchSeq = 0

/** Tells the person a fetched video is ready to choose. Clicking the notice opens its quality choice. */
const notifyReady = (id: string, title: string): void => {
  try {
    const note = new Notification('Ready to download', { body: title, silent: true })
    note.onclick = () => useYoutubeStore.getState().openFetch(id)
  } catch {
    // The queue card still shows it.
  }
}

/** The format for a quality, or the first one the video has. */
const formatFor = (
  meta: YoutubeVideoMeta,
  quality: YoutubeOptions['quality']
): YoutubeFormatOption | null => {
  const wanted = formatForQuality(quality)
  return meta.formats.find((format) => format.formatId === wanted) ?? meta.formats[0] ?? null
}

export const isActiveYoutubeJob = (job: YoutubeJob): boolean =>
  job.status === 'queued' || job.status === 'downloading' || job.status === 'paused'

export const isFailedYoutubeJob = (job: YoutubeJob): boolean => job.status === 'error'

export const isFinishedYoutubeJob = (job: YoutubeJob): boolean =>
  job.status === 'completed' || job.status === 'cancelled'

interface YoutubeStore {
  jobs: Record<string, YoutubeJob>
  status: YoutubeStatus | null
  jobFilter: YoutubeJobFilter
  search: string
  /** The job ids picked with their checkboxes, as on the Downloads list. */
  selected: Set<string>
  options: YoutubeOptions
  /** The add dialog, and the browser video it is confirming (if one came from the extension). */
  addOpen: boolean
  offerId: string | null

  // Video probe state
  inputUrl: string
  probeState: 'idle' | 'loading' | 'ready' | 'error'
  currentProbe: YoutubeVideoMeta | null
  probeError: string | null
  selectedFormat: YoutubeFormatOption | null
  /** Links being fetched in the background, shown as a list until the person decides. */
  fetches: YoutubeFetch[]
  /** The fetch whose quality the add dialog is showing, if any. */
  activeFetchId: string | null

  setInputUrl: (url: string) => void
  setAddOpen: (open: boolean) => void
  openAdd: () => void
  openOffer: (offer: { id: string; url: string; title: string }) => void
  openLink: (url: string) => void
  loadOptions: () => Promise<void>
  setOptions: (change: Partial<YoutubeOptions>) => Promise<void>
  setJob: (job: YoutubeJob) => void
  loadJobs: () => Promise<void>
  refreshStatus: () => Promise<void>
  removeJobLocal: (id: string) => void
  setJobFilter: (filter: YoutubeJobFilter) => void
  setSearch: (search: string) => void
  setSelected: (selected: Set<string>) => void
  setSelectedFormat: (format: YoutubeFormatOption | null) => void

  queueFetch: (url: string, offerId?: string | null) => Promise<void>
  startJob: (
    fetchId: string,
    meta: YoutubeVideoMeta,
    format: YoutubeFormatOption,
    offerId: string | null
  ) => Promise<void>
  openFetch: (id: string) => void
  dismissFetch: (id: string) => Promise<void>
  /** Fetch a failed link again (after a sign-in was set up), keeping its place for a browser offer. */
  retryFetch: (id: string) => Promise<void>
  startDownload: (format?: YoutubeFormatOption) => Promise<void>
  pauseJob: (id: string) => Promise<void>
  resumeJob: (id: string) => Promise<void>
  cancelJob: (id: string) => Promise<void>
  retryJob: (id: string) => Promise<void>
  removeJob: (id: string, deleteFile?: boolean) => Promise<void>
  revealJob: (id: string) => void
  openJob: (id: string) => void
  clearProbe: () => void
}

export const useYoutubeStore = create<YoutubeStore>((set, get) => ({
  jobs: {},
  status: null,
  jobFilter: 'all',
  search: '',
  selected: new Set(),
  options: DEFAULT_YOUTUBE_OPTIONS,
  addOpen: false,
  offerId: null,
  fetches: [],
  activeFetchId: null,

  loadOptions: async () => {
    try {
      set({ options: await window.lightning.youtubeGetOptions() })
    } catch {
      // keep the defaults
    }
  },
  setOptions: async (change) => {
    set((state) => ({ options: { ...state.options, ...change } }))
    try {
      set({ options: await window.lightning.youtubeSetOptions(change) })
    } catch {
      // the local copy stays until the next load
    }
  },

  inputUrl: '',
  probeState: 'idle',
  currentProbe: null,
  probeError: null,
  selectedFormat: null,

  setInputUrl: (inputUrl) => set({ inputUrl }),
  openAdd: () => set({ addOpen: true }),
  setAddOpen: (open) => {
    if (open) {
      set({ addOpen: true })
      return
    }
    // Closing leaves a fetched video in the queue, so the person can still choose it later.
    set({
      addOpen: false,
      offerId: null,
      activeFetchId: null,
      probeState: 'idle',
      currentProbe: null,
      probeError: null,
      selectedFormat: null
    })
  },
  openLink: (url) => {
    void get().queueFetch(url)
  },
  openOffer: (offer) => {
    void get().queueFetch(offer.url, offer.id)
  },
  setJob: (job) => set((state) => ({ jobs: { ...state.jobs, [job.id]: job } })),
  loadJobs: async () => {
    try {
      const list = await window.lightning.youtubeListJobs()
      set({ jobs: Object.fromEntries(list.map((job) => [job.id, job])) })
    } catch {
      // not available yet
    }
  },
  refreshStatus: async () => {
    try {
      set({ status: await window.lightning.youtubeStatus() })
    } catch {
      set({ status: { binary: false, ffmpeg: false } })
    }
  },
  removeJobLocal: (id) =>
    set((state) => {
      const jobs = { ...state.jobs }
      delete jobs[id]
      return { jobs }
    }),
  // A new filter clears the selection, as on Downloads: what was picked may not be listed now.
  setJobFilter: (jobFilter) => set({ jobFilter, selected: new Set() }),
  setSearch: (search) => set({ search }),
  setSelected: (selected) => set({ selected }),
  setSelectedFormat: (selectedFormat) => set({ selectedFormat }),

  // Puts the link in the fetch queue and returns at once; the dialog closes and the person keeps
  // working. When the fetch ends the link waits in the list, or starts on its own if Options says so.
  queueFetch: async (url: string, offerId: string | null = null) => {
    const trimmed = url.trim()
    if (!trimmed) return
    const id = `fetch-${Date.now()}-${++fetchSeq}`
    set((state) => ({
      fetches: [
        ...state.fetches,
        { id, url: trimmed, offerId, state: 'fetching', meta: null, error: null }
      ],
      addOpen: false,
      inputUrl: ''
    }))
    const update = (change: Partial<YoutubeFetch>): void =>
      set((state) => ({
        fetches: state.fetches.map((item) => (item.id === id ? { ...item, ...change } : item))
      }))
    try {
      const meta = await window.lightning.youtubeProbe(trimmed)
      // Dismissed while fetching: drop the result.
      if (!get().fetches.some((item) => item.id === id)) return
      if (get().options.autoStartDefault) {
        const format = formatFor(meta, get().options.quality)
        if (!format) throw new Error('No downloadable format for this video')
        await get().startJob(id, meta, format, offerId)
        return
      }
      update({ state: 'ready', meta })
      notifyReady(id, meta.title)
    } catch (err: unknown) {
      update({ state: 'error', error: (err as Error)?.message || 'Failed to fetch this link' })
    }
  },

  // Starts a download for a fetch and removes that fetch from the queue.
  startJob: async (fetchId, meta, format, offerId) => {
    try {
      const job = await window.lightning.youtubeStart({
        url: meta.url,
        title: meta.title,
        thumbnail: meta.thumbnail,
        formatId: format.formatId,
        resolution: format.resolution,
        offerId: offerId ?? undefined
      })
      set((state) => ({
        jobs: { ...state.jobs, [job.id]: job },
        fetches: state.fetches.filter((item) => item.id !== fetchId),
        activeFetchId: state.activeFetchId === fetchId ? null : state.activeFetchId,
        probeState: 'idle',
        currentProbe: null,
        selectedFormat: null,
        offerId: null,
        addOpen: false
      }))
    } catch (err: unknown) {
      const message = (err as Error)?.message || 'Could not start YouTube download'
      set((state) => ({
        fetches: state.fetches.map((item) =>
          item.id === fetchId ? { ...item, state: 'error', error: message } : item
        ),
        probeError: message
      }))
    }
  },

  openFetch: (id) => {
    const fetch = get().fetches.find((item) => item.id === id)
    if (!fetch || fetch.state !== 'ready' || !fetch.meta) return
    set({
      addOpen: true,
      activeFetchId: id,
      offerId: fetch.offerId,
      inputUrl: fetch.url,
      probeState: 'ready',
      currentProbe: fetch.meta,
      probeError: null,
      selectedFormat: formatFor(fetch.meta, get().options.quality)
    })
  },

  retryFetch: async (id) => {
    const fetch = get().fetches.find((item) => item.id === id)
    if (!fetch) return
    // Out of the queue without releasing a browser offer, then in again as a fresh fetch.
    set((state) => ({ fetches: state.fetches.filter((item) => item.id !== id) }))
    await get().queueFetch(fetch.url, fetch.offerId)
  },

  dismissFetch: async (id) => {
    const fetch = get().fetches.find((item) => item.id === id)
    if (!fetch) return
    set((state) => ({
      fetches: state.fetches.filter((item) => item.id !== id),
      activeFetchId: state.activeFetchId === id ? null : state.activeFetchId,
      addOpen: state.activeFetchId === id ? false : state.addOpen
    }))
    // A browser video waiting for an answer is released when it is dismissed.
    if (fetch.offerId) await window.lightning.youtubeCancelOffer(fetch.offerId)
  },

  startDownload: async (formatOverride?: YoutubeFormatOption) => {
    const { currentProbe, selectedFormat, activeFetchId, offerId } = get()
    const format = formatOverride || selectedFormat
    if (!currentProbe || !format) return
    await get().startJob(activeFetchId ?? '', currentProbe, format, offerId)
  },

  pauseJob: async (id) => {
    await window.lightning.youtubePauseJob(id)
  },
  resumeJob: async (id) => {
    await window.lightning.youtubeResumeJob(id)
  },
  cancelJob: async (id) => {
    await window.lightning.youtubeCancelJob(id)
  },
  retryJob: async (id) => {
    await window.lightning.youtubeRetryJob(id)
  },
  removeJob: async (id, deleteFile) => {
    get().removeJobLocal(id)
    await window.lightning.youtubeRemoveJob(id, deleteFile)
  },
  revealJob: (id) => {
    window.lightning.youtubeRevealJob(id)
  },
  openJob: (id) => {
    window.lightning.youtubeOpenJob(id)
  },
  clearProbe: () =>
    set({ probeState: 'idle', currentProbe: null, probeError: null, selectedFormat: null })
}))
