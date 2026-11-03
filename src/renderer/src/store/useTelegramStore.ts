import type { TdlJob, TdlLoginMode, TdlStatus } from '@shared/telegram'
import { create } from 'zustand'

/** Which jobs the list shows. */
export type TelegramJobFilter = 'all' | 'active' | 'finished' | 'failed'

export const isActiveJob = (job: TdlJob): boolean =>
  job.status === 'queued' ||
  job.status === 'exporting' ||
  job.status === 'running' ||
  job.status === 'paused'

export const isFailedJob = (job: TdlJob): boolean =>
  job.status === 'error' || job.items.some((item) => item.status === 'failed')

export const isFinishedJob = (job: TdlJob): boolean =>
  job.status === 'completed' || job.status === 'cancelled'

interface TelegramStore {
  jobs: Record<string, TdlJob>
  /** Null until main has answered. */
  status: TdlStatus | null
  jobFilter: TelegramJobFilter
  search: string
  /** Ids of the jobs ticked in the list. */
  selected: Set<string>
  /** Groups the person opened (collapsed by default). */
  expanded: Set<string>
  addOpen: boolean
  addSeed: string[]
  exportOpen: boolean
  loginOpen: boolean
  loginMode: TdlLoginMode

  setJob: (job: TdlJob) => void
  loadJobs: () => Promise<void>
  refreshStatus: () => Promise<void>
  removeJobLocal: (id: string) => void
  setJobFilter: (filter: TelegramJobFilter) => void
  setSearch: (search: string) => void
  setSelected: (selected: Set<string>) => void
  toggleExpanded: (id: string) => void
  openAdd: (links?: string[]) => void
  closeAdd: () => void
  openExport: () => void
  closeExport: () => void
  openLogin: (mode?: TdlLoginMode) => void
  closeLogin: () => void
}

export const useTelegramStore = create<TelegramStore>((set, get) => ({
  jobs: {},
  status: null,
  jobFilter: 'all',
  search: '',
  selected: new Set(),
  expanded: new Set(),
  addOpen: false,
  addSeed: [],
  exportOpen: false,
  loginOpen: false,
  loginMode: 'qr',

  setJob: (job) => set((state) => ({ jobs: { ...state.jobs, [job.id]: job } })),
  loadJobs: async () => {
    try {
      const list = await window.lightning.tdlListJobs()
      set({ jobs: Object.fromEntries(list.map((job) => [job.id, job])) })
    } catch {
      // Main has no Telegram support (yet): the section stays empty.
    }
  },
  refreshStatus: async () => {
    try {
      set({ status: await window.lightning.tdlStatus() })
    } catch {
      set({ status: { binary: false, loggedIn: false } })
    }
  },
  removeJobLocal: (id) =>
    set((state) => {
      const jobs = { ...state.jobs }
      delete jobs[id]
      const selected = new Set(state.selected)
      selected.delete(id)
      return { jobs, selected }
    }),
  setJobFilter: (jobFilter) => set({ jobFilter, selected: new Set() }),
  setSearch: (search) => set({ search }),
  setSelected: (selected) => set({ selected }),
  toggleExpanded: (id) => {
    const expanded = new Set(get().expanded)
    if (!expanded.delete(id)) expanded.add(id)
    set({ expanded })
  },
  openAdd: (links) => set({ addOpen: true, addSeed: links ?? [] }),
  closeAdd: () => set({ addOpen: false, addSeed: [] }),
  openExport: () => set({ exportOpen: true }),
  closeExport: () => set({ exportOpen: false }),
  openLogin: (mode) => set({ loginOpen: true, loginMode: mode ?? get().loginMode }),
  closeLogin: () => set({ loginOpen: false })
}))
