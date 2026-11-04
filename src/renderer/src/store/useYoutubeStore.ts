import type {
  YoutubeFormatOption,
  YoutubeJob,
  YoutubeStatus,
  YoutubeVideoMeta
} from '@shared/youtube'
import { create } from 'zustand'

export type YoutubeJobFilter = 'all' | 'active' | 'finished' | 'failed'

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

  // Video probe state
  inputUrl: string
  probeState: 'idle' | 'loading' | 'ready' | 'error'
  currentProbe: YoutubeVideoMeta | null
  probeError: string | null
  selectedFormat: YoutubeFormatOption | null

  setInputUrl: (url: string) => void
  setJob: (job: YoutubeJob) => void
  loadJobs: () => Promise<void>
  refreshStatus: () => Promise<void>
  removeJobLocal: (id: string) => void
  setJobFilter: (filter: YoutubeJobFilter) => void
  setSearch: (search: string) => void
  setSelectedFormat: (format: YoutubeFormatOption | null) => void

  probeUrl: (url: string) => Promise<void>
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

  inputUrl: '',
  probeState: 'idle',
  currentProbe: null,
  probeError: null,
  selectedFormat: null,

  setInputUrl: (inputUrl) => set({ inputUrl }),
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
  setJobFilter: (jobFilter) => set({ jobFilter }),
  setSearch: (search) => set({ search }),
  setSelectedFormat: (selectedFormat) => set({ selectedFormat }),

  probeUrl: async (url: string) => {
    const trimmed = url.trim()
    if (!trimmed) return
    set({ probeState: 'loading', probeError: null, currentProbe: null, selectedFormat: null })
    try {
      const meta = await window.lightning.youtubeProbe(trimmed)
      set({
        probeState: 'ready',
        currentProbe: meta,
        selectedFormat: meta.formats[0] ?? null
      })
    } catch (err: unknown) {
      set({
        probeState: 'error',
        probeError: (err as Error)?.message || 'Failed to probe YouTube URL'
      })
    }
  },

  startDownload: async (formatOverride?: YoutubeFormatOption) => {
    const { currentProbe, selectedFormat } = get()
    const format = formatOverride || selectedFormat
    if (!currentProbe || !format) return

    try {
      const job = await window.lightning.youtubeStart({
        url: currentProbe.url,
        title: currentProbe.title,
        thumbnail: currentProbe.thumbnail,
        formatId: format.formatId,
        resolution: format.resolution
      })
      set((state) => ({
        jobs: { ...state.jobs, [job.id]: job },
        probeState: 'idle',
        currentProbe: null,
        inputUrl: '',
        selectedFormat: null
      }))
    } catch (err: unknown) {
      set({
        probeError: (err as Error)?.message || 'Could not start YouTube download'
      })
    }
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
