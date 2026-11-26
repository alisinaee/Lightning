import { t } from '@shared/i18n/react'
import {
  closestFormat,
  DEFAULT_YOUTUBE_OPTIONS,
  extractYoutubeId,
  formatForQuality,
  PRESET_FORMATS,
  videoLinkIn,
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
  /** The quality the person already chose: the download starts by itself once the fetch ends. */
  wanted: YoutubeFormatOption | null
  /** Being confirmed in the add dialog, not part of the queue (yet). */
  inDialog: boolean
}

const sameVideo = (a: string, b: string): boolean =>
  a === b || (extractYoutubeId(a) !== null && extractYoutubeId(a) === extractYoutubeId(b))

let fetchSeq = 0

/** Tells the person a fetched video is ready to choose. Clicking the notice opens its quality choice. */
const notifyReady = (id: string, title: string): void => {
  try {
    const note = new Notification(t('Ready to download'), { body: title, silent: true })
    note.onclick = () => useYoutubeStore.getState().openFetch(id)
  } catch {
    // The queue card still shows it.
  }
}

/** The preset for a quality: what can be chosen before the video is fetched. */
const presetFor = (quality: YoutubeOptions['quality']): YoutubeFormatOption =>
  PRESET_FORMATS.find((format) => format.formatId === formatForQuality(quality)) ??
  PRESET_FORMATS[0]

/** The add dialog, empty. */
const EMPTY_DIALOG = {
  offerId: null,
  activeFetchId: null,
  inputUrl: '',
  probeState: 'idle',
  currentProbe: null,
  probeError: null,
  selectedFormat: null
} as const

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
  /** The person asked to add a video: a video link on the clipboard goes straight to its confirmation,
   * anything else opens the dialog for a link. */
  openAdd: () => Promise<void>
  /** From the confirmation back to the link field. */
  editLink: () => void
  openOffer: (offer: { id: string; url: string; title: string }) => void
  /** Opens the add dialog on a video page or stream and fetches it there (any site). `confirm`: the
   * person is asked even when Options starts videos on its own. */
  openVideoDialog: (url: string, confirm?: boolean) => Promise<void>
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

  queueFetch: (
    url: string,
    offerId?: string | null,
    change?: Partial<YoutubeFetch>
  ) => Promise<void>
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
  openAdd: async () => {
    const text = await window.lightning.readClipboardText().catch(() => '')
    const link = videoLinkIn(text)
    const known = link
      ? Object.values(get().jobs).some((job) => sameVideo(job.url, link)) // added before: not again
      : false
    const fetched = link ? get().fetches.find((item) => sameVideo(item.url, link)) : undefined
    if (!link || known || fetched?.wanted || fetched?.state === 'error') {
      set({ ...EMPTY_DIALOG, addOpen: true, selectedFormat: presetFor(get().options.quality) })
    } else if (fetched) get().openFetch(fetched.id)
    else await get().openVideoDialog(link, true)
  },
  editLink: () => {
    get().setAddOpen(false)
    set({ addOpen: true, selectedFormat: presetFor(get().options.quality) })
  },
  setAddOpen: (open) => {
    if (open) {
      set({ addOpen: true })
      return
    }
    // A link only the dialog was confirming goes with it. One from the queue stays there, so the
    // person can still choose it later.
    const { activeFetchId, fetches } = get()
    const active = fetches.find((item) => item.id === activeFetchId)
    if (active?.inDialog) {
      if (active.offerId) void window.lightning.youtubeCancelOffer(active.offerId)
      set({ fetches: fetches.filter((item) => item !== active) })
    }
    set({ ...EMPTY_DIALOG, addOpen: false })
  },
  openLink: (url) => {
    void get().queueFetch(url)
  },
  openOffer: (offer) => {
    // Browser videos wait in the queue: several can be sent one after another.
    void get().queueFetch(offer.url, offer.id)
  },
  openVideoDialog: async (url, confirm = false) => {
    const trimmed = url.trim()
    if (!trimmed) return
    if (!confirm && get().options.autoStartDefault) {
      await get().queueFetch(trimmed)
      return
    }
    // The dialog is usable at once; the details arrive while the person looks at it.
    get().setAddOpen(false)
    const id = `fetch-${Date.now()}-${++fetchSeq}`
    set({
      addOpen: true,
      inputUrl: trimmed,
      activeFetchId: id,
      probeState: 'loading',
      selectedFormat: presetFor(get().options.quality)
    })
    await get().queueFetch(trimmed, null, { id, inDialog: true })
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

  // Puts the link in the fetch queue and fetches it in the background. When the fetch ends the link
  // waits in the list, or starts on its own: the quality is already chosen, or Options says so.
  queueFetch: async (url, offerId = null, change = {}) => {
    const trimmed = url.trim()
    if (!trimmed) return
    const item: YoutubeFetch = {
      id: `fetch-${Date.now()}-${++fetchSeq}`,
      url: trimmed,
      offerId,
      state: 'fetching',
      meta: null,
      error: null,
      wanted: null,
      inDialog: false,
      ...change
    }
    const { id } = item
    set((state) => ({ fetches: [...state.fetches, item] }))
    const update = (change: Partial<YoutubeFetch>): void =>
      set((state) => ({
        fetches: state.fetches.map((entry) => (entry.id === id ? { ...entry, ...change } : entry))
      }))
    try {
      const meta = await window.lightning.youtubeProbe(trimmed, offerId ?? undefined)
      const current = get().fetches.find((entry) => entry.id === id)
      // Dismissed while fetching: drop the result.
      if (!current) return
      const shown = get().activeFetchId === id
      const wanted =
        current.wanted ??
        (get().options.autoStartDefault && !current.inDialog && !shown
          ? presetFor(get().options.quality)
          : null)
      if (wanted) {
        const format = closestFormat(meta.formats, wanted)
        if (!format) throw new Error(t('No downloadable format for this video'))
        await get().startJob(id, meta, format, offerId)
        return
      }
      update({ state: 'ready', meta })
      if (shown) {
        const picked = get().selectedFormat ?? presetFor(get().options.quality)
        set({
          probeState: 'ready',
          currentProbe: meta,
          selectedFormat: closestFormat(meta.formats, picked)
        })
      } else notifyReady(id, meta.title)
    } catch (err: unknown) {
      const error = (err as Error)?.message || t('Failed to fetch this link')
      update({ state: 'error', error })
      if (get().activeFetchId === id) set({ probeState: 'error', probeError: error })
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
        // A dialog open on another video stays as it is.
        ...(state.activeFetchId === fetchId ? { ...EMPTY_DIALOG, addOpen: false } : {})
      }))
    } catch (err: unknown) {
      const message = (err as Error)?.message || t('Could not start YouTube download')
      set((state) => ({
        fetches: state.fetches.map((item) =>
          item.id === fetchId ? { ...item, state: 'error', error: message } : item
        ),
        ...(state.activeFetchId === fetchId ? { probeError: message } : {})
      }))
    }
  },

  openFetch: (id) => {
    const fetch = get().fetches.find((item) => item.id === id)
    if (!fetch || fetch.state === 'error' || fetch.wanted) return
    get().setAddOpen(false)
    const preset = presetFor(get().options.quality)
    set({
      addOpen: true,
      activeFetchId: id,
      offerId: fetch.offerId,
      inputUrl: fetch.url,
      probeState: fetch.meta ? 'ready' : 'loading',
      currentProbe: fetch.meta,
      probeError: null,
      selectedFormat: fetch.meta ? closestFormat(fetch.meta.formats, preset) : preset
    })
  },

  retryFetch: async (id) => {
    const fetch = get().fetches.find((item) => item.id === id)
    if (!fetch) return
    // Out of the queue without releasing a browser offer, then in again as a fresh fetch.
    set((state) => ({ fetches: state.fetches.filter((item) => item.id !== id) }))
    await get().queueFetch(fetch.url, fetch.offerId, { wanted: fetch.wanted })
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

  // The person is done here: whatever is still to be fetched goes on in the background.
  startDownload: async (formatOverride?: YoutubeFormatOption) => {
    const { currentProbe, activeFetchId, offerId, inputUrl, probeState } = get()
    const format = formatOverride || get().selectedFormat
    if (!format) return
    if (currentProbe && activeFetchId) {
      await get().startJob(activeFetchId, currentProbe, format, offerId)
      return
    }
    if (activeFetchId && probeState === 'loading') {
      set((state) => ({
        fetches: state.fetches.map((item) =>
          item.id === activeFetchId ? { ...item, wanted: format, inDialog: false } : item
        ),
        ...EMPTY_DIALOG,
        addOpen: false
      }))
      return
    }
    if (!inputUrl.trim()) return
    get().setAddOpen(false)
    await get().queueFetch(inputUrl, null, { wanted: format })
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
