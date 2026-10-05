import { connectionsOnly, isVpn } from '@shared/networks'
import type { FileKind } from '../utils/fileKind'
import { applyDownloadUpdate } from '@shared/downloadUpdate'
import type {
  AppSettings,
  DownloadState,
  DownloadUpdate,
  FinishedDownload,
  GroupInfo,
  NetworkInterfaceInfo,
  NetworkPreference,
  NetworkPreferences,
  SettingsPush,
  ThemeSource,
  UpdateInfo
} from '@shared/types'
import { create } from 'zustand'

export interface GroupUi {
  open: boolean
  decisions: boolean
}

const GROUP_UI_KEY = 'lightning.groupUi'

function loadGroupUi(): Record<string, GroupUi> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(GROUP_UI_KEY) ?? '{}')
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, GroupUi>) : {}
  } catch {
    return {}
  }
}

/** What the list shows by status: the menu's four, and the sidebar's finer ones. */
export type DownloadFilter =
  'all' | 'progress' | 'finished' | 'failed' | 'downloading' | 'queued' | 'paused'

/** The list's columns, as the user left them (see components/downloads/columns.ts). */
export type ColumnId = 'name' | 'size' | 'status' | 'speed' | 'eta' | 'added' | 'connections'
export type SortKey = ColumnId
export interface TableLayout {
  sort: { key: SortKey; dir: 'asc' | 'desc' }
  widths: Partial<Record<ColumnId, number>>
  hidden: ColumnId[]
  /** Whole file names over as many lines as they need, not cut with "…". */
  wrapNames: boolean
}

const TABLE_KEY = 'lightning.table'
const DEFAULT_TABLE: TableLayout = {
  sort: { key: 'status', dir: 'asc' },
  widths: {},
  hidden: [],
  wrapNames: false
}

const COLUMN_IDS: ColumnId[] = ['name', 'size', 'status', 'speed', 'eta', 'added', 'connections']

/** A saved table layout made safe to use: unknown columns dropped, widths numbers in a sane range,
 * the name and status columns never hidden, and the defaults for anything unreadable. */
export function sanitizeTable(raw: unknown): TableLayout {
  const parsed = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const known = (id: unknown): id is ColumnId => COLUMN_IDS.includes(id as ColumnId)
  const sort = parsed.sort as { key?: unknown; dir?: unknown } | undefined
  const widths: Partial<Record<ColumnId, number>> = {}
  if (parsed.widths && typeof parsed.widths === 'object') {
    for (const [id, width] of Object.entries(parsed.widths)) {
      if (known(id) && typeof width === 'number' && Number.isFinite(width)) {
        widths[id] = Math.min(2000, Math.max(20, Math.round(width)))
      }
    }
  }
  const hidden = Array.isArray(parsed.hidden)
    ? [...new Set(parsed.hidden.filter(known))].filter((id) => id !== 'name' && id !== 'status')
    : []
  return {
    sort:
      sort && known(sort.key) && (sort.dir === 'asc' || sort.dir === 'desc')
        ? { key: sort.key, dir: sort.dir }
        : DEFAULT_TABLE.sort,
    widths,
    hidden,
    wrapNames: parsed.wrapNames === true
  }
}

function loadTable(): TableLayout {
  try {
    return sanitizeTable(JSON.parse(localStorage.getItem(TABLE_KEY) ?? '{}'))
  } catch {
    return DEFAULT_TABLE
  }
}

/** Forgets the saved layout: the table is as it first was. */
function forgetTable(): void {
  try {
    localStorage.removeItem(TABLE_KEY)
  } catch {
    // Nothing saved to forget.
  }
}

function saveTable(layout: TableLayout): void {
  try {
    localStorage.setItem(TABLE_KEY, JSON.stringify(layout))
  } catch {
    // Not remembered across launches; still kept for this one.
  }
}

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** What the window shows: the list of downloads, or one download. */
export type View = { name: 'list' } | { name: 'download'; id: string }

interface AppStore {
  /** The connections the UI lists: never a VPN tunnel (those are one separate layer). */
  interfaces: NetworkInterfaceInfo[]
  /** The VPN tunnels detected; shown only by the VPN control. */
  vpnInterfaces: NetworkInterfaceInfo[]
  /** Everything detected, VPN tunnels included. For colours and starting downloads only. */
  allInterfaces: NetworkInterfaceInfo[]
  interfacesStatus: LoadStatus
  interfacesError: string | null
  latencies: Record<string, number | null>
  /** User customizations (name/color) per network interface id — persisted in the main process. */
  networkPreferences: NetworkPreferences

  /** Persisted in the main process alongside nativeTheme.themeSource. */
  themeSource: ThemeSource

  /** Null until the one-time startup check resolves, or if it found nothing worth showing
   * (already up to date, already dismissed, or the check failed). */
  availableUpdate: UpdateInfo | null

  homeDir: string
  downloadsDir: string

  /** Every download that isn't finished, by id — running, queued, paused or failed. */
  downloads: Record<string, DownloadState>
  /** Finished downloads, newest first (see main/download/history.ts). */
  history: FinishedDownload[]
  /** Groups of downloads (see main/groups), with the files of an auto group still waiting. */
  groups: GroupInfo[]
  /** The group whose edit dialog is open. */
  editingGroupId: string | null
  view: View
  downloadFilter: DownloadFilter
  setDownloadFilter: (filter: DownloadFilter) => void
  /** The sidebar's file-type group, or null for every kind. */
  kindFilter: FileKind | null
  setKindFilter: (kind: FileKind | null) => void
  /** The search box over the list. */
  search: string
  setSearch: (text: string) => void
  /** Sort, column widths and hidden columns of the downloads table; remembered. */
  tableLayout: TableLayout
  sortBy: (key: SortKey) => void
  setColumnWidth: (id: ColumnId, width: number) => void
  /** Several columns at once, e.g. two that trade width across a divider. */
  setColumnWidths: (widths: Partial<Record<ColumnId, number>>) => void
  setWrapNames: (on: boolean) => void
  toggleColumn: (id: ColumnId) => void
  /** Back to the default layout, forgetting the saved one. */
  resetTableLayout: () => void
  /** The New download dialog, over whatever the window shows. */
  newDownloadOpen: boolean
  /** The Add several links dialog. */
  multiLinksOpen: boolean
  /** Persisted — how many downloads run at once; the rest wait in the queue. */
  downloadsAtOnce: number
  /** Persisted — the speed limits (see AppSettings). */
  speedLimit: number | undefined
  slowMode: boolean
  slowModeSpeed: number
  /** Persisted — whether VPN tunnels may be used as connections. */
  useVpn: boolean
  setUseVpn: (useVpn: boolean) => void
  /** Settings changed from main (the Test lab), not by the window: shown, not saved again. */
  receiveSettings: (settings: SettingsPush) => void

  /** Lifted out of the Idle screen so it survives a swap to/from the No-connections screen. */
  draftUrl: string
  /** The link last started: still on the clipboard afterwards, so not offered again. */
  startedUrl: string
  /** Persisted — the last folder picked, falling back to downloadsDir. */
  destinationDir: string

  /** Asks the main process for the network list now; it also pushes every change. */
  loadInterfaces: () => Promise<void>
  receiveInterfaces: (interfaces: NetworkInterfaceInfo[]) => void
  refreshLatencies: () => Promise<void>
  setNetworkPreference: (id: string, patch: NetworkPreference) => void
  setThemeSource: (source: ThemeSource) => void
  checkForUpdate: () => Promise<void>
  dismissUpdate: () => void
  /** A snapshot or an update of a download, from the main process. */
  receiveDownloadUpdate: (update: DownloadUpdate) => void
  /** Finished downloads as main lists them; any that finished leave `downloads`. */
  receiveHistory: (history: FinishedDownload[]) => void
  receiveGroups: (groups: GroupInfo[]) => void
  /** Which groups are open in the list, and which have their decisions list open. Kept here (not
   * in the row) so a row that moves between sections, or remounts, stays as the user left it. */
  groupUi: Record<string, GroupUi>
  toggleGroupUi: (id: string, key: keyof GroupUi) => void
  /** Text typed into a group's "Add links" box, kept while the dialog is open or pushes arrive. */
  groupDrafts: Record<string, string>
  setGroupDraft: (id: string, text: string) => void
  /** The ticked downloads of the list. */
  selectedDownloads: Set<string>
  setSelectedDownloads: (next: Set<string> | ((previous: Set<string>) => Set<string>)) => void
  editGroup: (id: string | null) => void
  /** Removes a download (cancelling one under way), or forgets a finished one. */
  removeDownload: (id: string, options?: { trashFile?: boolean }) => void
  setView: (view: View) => void
  /** Opens New download, with `link` in its link field when one is given. */
  openNewDownload: (link?: string, replacesId?: string) => void
  /** A finished download whose file is gone, which the download now being set up replaces. */
  replacesId: string | null
  closeNewDownload: () => void
  openMultiLinks: () => void
  closeMultiLinks: () => void
  setDownloadsAtOnce: (count: number) => void
  /** Each one applies at once, to every download (see main/network/limits.ts). */
  setSpeedLimit: (bytesPerSec: number | undefined) => void
  setSlowMode: (on: boolean) => void
  setSlowModeSpeed: (bytesPerSec: number) => void
  setDraftUrl: (url: string) => void
  setDestinationDir: (dir: string) => void
}

// Settings saved by the main process, read once before the first paint (see InitialState).
const initial = window.lightning.initialState

/** Every setting changes optimistically: the store is updated first so the UI feels instant,
 * then this saves it. The store stays the source of truth either way — a failed save just means
 * the change isn't remembered next launch. */
function persist(patch: AppSettings): void {
  window.lightning.updateSettings(patch).catch(() => {})
}

export const useAppStore = create<AppStore>((set, get) => ({
  interfaces: [],
  vpnInterfaces: [],
  allInterfaces: [],
  interfacesStatus: 'idle',
  interfacesError: null,
  latencies: {},
  networkPreferences: initial.networkPreferences,
  themeSource: initial.themeSource,
  availableUpdate: null,

  homeDir: initial.homeDir,
  downloadsDir: initial.downloadsDir,

  downloads: {},
  history: [],
  groups: [],
  editingGroupId: null,
  view: { name: 'list' },
  downloadFilter: 'all',
  setDownloadFilter: (downloadFilter) => set({ downloadFilter }),
  kindFilter: null,
  setKindFilter: (kindFilter) => set({ kindFilter }),
  search: '',
  setSearch: (search) => set({ search }),
  tableLayout: loadTable(),
  // Clicking the sorted column flips it; another column starts ascending.
  sortBy: (key) => {
    const { sort } = get().tableLayout
    const tableLayout = {
      ...get().tableLayout,
      sort: {
        key,
        dir: sort.key === key && sort.dir === 'asc' ? ('desc' as const) : ('asc' as const)
      }
    }
    set({ tableLayout })
    saveTable(tableLayout)
  },
  setColumnWidth: (id, width) => {
    const tableLayout = {
      ...get().tableLayout,
      widths: { ...get().tableLayout.widths, [id]: Math.round(width) }
    }
    set({ tableLayout })
    saveTable(tableLayout)
  },
  setColumnWidths: (widths) => {
    const rounded = Object.fromEntries(
      Object.entries(widths).map(([id, width]) => [id, Math.round(width)])
    )
    const tableLayout = {
      ...get().tableLayout,
      widths: { ...get().tableLayout.widths, ...rounded }
    }
    set({ tableLayout })
    saveTable(tableLayout)
  },

  setWrapNames: (wrapNames) => {
    const tableLayout = { ...get().tableLayout, wrapNames }
    set({ tableLayout })
    saveTable(tableLayout)
  },

  toggleColumn: (id) => {
    const { hidden } = get().tableLayout
    const tableLayout = {
      ...get().tableLayout,
      hidden: hidden.includes(id) ? hidden.filter((other) => other !== id) : [...hidden, id]
    }
    set({ tableLayout })
    saveTable(tableLayout)
  },
  resetTableLayout: () => {
    forgetTable()
    set({ tableLayout: DEFAULT_TABLE })
  },
  newDownloadOpen: false,
  multiLinksOpen: false,
  downloadsAtOnce: initial.downloadsAtOnce,
  speedLimit: initial.speedLimit,
  slowMode: initial.slowMode,
  slowModeSpeed: initial.slowModeSpeed,
  useVpn: initial.useVpn,
  receiveSettings: (settings) => set({ ...settings }),
  setUseVpn: (useVpn) => {
    set({ useVpn })
    persist({ useVpn })
  },

  draftUrl: '',
  startedUrl: '',
  destinationDir: initial.destinationDir ?? initial.downloadsDir,

  loadInterfaces: async () => {
    // A re-scan keeps showing the last result rather than flashing back to 'loading'.
    if (get().interfacesStatus !== 'ready') set({ interfacesStatus: 'loading' })
    set({ interfacesError: null })
    try {
      get().receiveInterfaces(await window.lightning.listInterfaces())
    } catch (error) {
      set({
        interfacesStatus: 'error',
        interfacesError: error instanceof Error ? error.message : String(error)
      })
    }
  },

  receiveInterfaces: (allInterfaces) =>
    set({
      allInterfaces,
      interfaces: connectionsOnly(allInterfaces),
      vpnInterfaces: allInterfaces.filter(isVpn),
      interfacesStatus: 'ready',
      interfacesError: null
    }),

  refreshLatencies: async () => {
    try {
      const latencies = await window.lightning.pingInterfaces()
      set({ latencies })
    } catch {
      // Latency is a nice-to-have readout — a failed probe just leaves stale values.
    }
  },

  // An explicit `undefined` in `patch` clears that field; main drops an entry left with neither.
  setNetworkPreference: (id, patch) => {
    const networkPreferences = {
      ...get().networkPreferences,
      [id]: { ...get().networkPreferences[id], ...patch }
    }
    set({ networkPreferences })
    persist({ networkPreferences })
  },

  setThemeSource: (themeSource) => {
    set({ themeSource })
    persist({ themeSource })
  },

  checkForUpdate: async () => {
    try {
      const availableUpdate = await window.lightning.checkForUpdate()
      set({ availableUpdate })
    } catch {
      // Best-effort — a failed check just leaves the banner hidden.
    }
  },

  dismissUpdate: () => {
    const update = get().availableUpdate
    if (!update) return
    // Keeps the update visible as a quiet titlebar icon rather than clearing it outright.
    set({ availableUpdate: { ...update, dismissed: true } })
    persist({ dismissedUpdateVersion: update.version })
  },

  receiveDownloadUpdate: (update) => {
    const { downloads, history } = get()
    // Finished already: an update that arrives late mustn't bring it back.
    if (history.some((entry) => entry.id === update.state.id)) return
    const previous = downloads[update.state.id] ?? null
    const download = applyDownloadUpdate(previous, update)
    if (!download || download === previous) return
    set({ downloads: { ...downloads, [download.id]: download } })
  },

  receiveHistory: (history) => {
    const downloads = { ...get().downloads }
    for (const entry of history) delete downloads[entry.id]
    set({ history, downloads })
  },

  receiveGroups: (groups) => {
    // Keep what the window already holds when nothing changed, so a push that brings the same
    // groups again re-renders nothing.
    const before = get().groups
    if (JSON.stringify(before) === JSON.stringify(groups)) return
    set({ groups })
  },
  groupUi: loadGroupUi(),
  toggleGroupUi: (id, key) => {
    const current = get().groupUi[id] ?? { open: false, decisions: false }
    const groupUi = { ...get().groupUi, [id]: { ...current, [key]: !current[key] } }
    set({ groupUi })
    try {
      localStorage.setItem(GROUP_UI_KEY, JSON.stringify(groupUi))
    } catch {
      // Not remembered across launches; still kept for this one.
    }
  },
  groupDrafts: {},
  setGroupDraft: (id, text) => set({ groupDrafts: { ...get().groupDrafts, [id]: text } }),
  selectedDownloads: new Set<string>(),
  setSelectedDownloads: (next) =>
    set({
      selectedDownloads: typeof next === 'function' ? next(get().selectedDownloads) : next
    }),
  editGroup: (editingGroupId) => set({ editingGroupId }),

  removeDownload: (id, options) => {
    const { [id]: removed, ...downloads } = get().downloads
    void removed
    set({ downloads, history: get().history.filter((entry) => entry.id !== id) })
    void window.lightning.removeDownload(id, options).catch(() => {})
  },

  setView: (view) => set({ view }),

  replacesId: null,
  openNewDownload: (link, replacesId) =>
    set(
      link === undefined
        ? { newDownloadOpen: true, replacesId: null }
        : { newDownloadOpen: true, draftUrl: link, replacesId: replacesId ?? null }
    ),

  closeNewDownload: () => set({ newDownloadOpen: false, replacesId: null }),
  openMultiLinks: () => set({ multiLinksOpen: true }),
  closeMultiLinks: () => set({ multiLinksOpen: false }),

  setDownloadsAtOnce: (downloadsAtOnce) => {
    set({ downloadsAtOnce })
    persist({ downloadsAtOnce })
  },

  setSpeedLimit: (speedLimit) => {
    set({ speedLimit })
    persist({ speedLimit })
  },

  setSlowMode: (slowMode) => {
    set({ slowMode })
    persist({ slowMode })
  },

  setSlowModeSpeed: (slowModeSpeed) => {
    set({ slowModeSpeed })
    persist({ slowModeSpeed })
  },

  setDraftUrl: (draftUrl) => set({ draftUrl }),
  setDestinationDir: (destinationDir) => {
    set({ destinationDir })
    persist({ destinationDir })
  }
}))
