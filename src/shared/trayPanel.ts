import type { DownloadState, NetworkPreferences, StatusBarPrefs } from './types'
import { percentOf, summarizeActivity, type NetworkActivity } from './trayModel'

/** Everything the panel under the menu-bar icon draws, as one snapshot the main process sends it
 * about once a second. Colours are the panel's own business (it knows the theme): it is given
 * the networks and the person's choices for them, as the main window has them. */
export interface PanelState {
  version: string
  accent: string
  /** Which parts to draw (Settings → Status bar). */
  show: Pick<
    StatusBarPrefs,
    'trayTotals' | 'trayGraph' | 'trayNetworks' | 'trayDownloads' | 'trayQueue' | 'trayActions'
  >
  speed: number
  running: number
  received: number
  left: number
  /** The total speed once a second, oldest first. */
  history: number[]
  networks: NetworkActivity[]
  networkPreferences: NetworkPreferences
  downloads: PanelDownload[]
  /** How many more are running than are listed. */
  more: number
  queued: number
  paused: number
  failed: number
}

export interface PanelDownload {
  id: string
  name: string
  percent: number
  speed: number
  timeLeft: number | null
  /** Bytes left; null when the size is not known. */
  left: number | null
}

export function buildPanelState(input: {
  downloads: readonly DownloadState[]
  history: number[]
  prefs: StatusBarPrefs
  names: Record<string, string>
  networkPreferences: NetworkPreferences
  accent: string
  version: string
}): PanelState {
  const activity = summarizeActivity(input.downloads, input.names)
  const ranked = [...activity.running].sort((a, b) => b.speedBytesPerSec - a.speedBytesPerSec)
  const listed = ranked.slice(0, input.prefs.trayRows)
  return {
    version: input.version,
    accent: input.accent,
    show: {
      trayTotals: input.prefs.trayTotals,
      trayGraph: input.prefs.trayGraph,
      trayNetworks: input.prefs.trayNetworks,
      trayDownloads: input.prefs.trayDownloads,
      trayQueue: input.prefs.trayQueue,
      trayActions: input.prefs.trayActions
    },
    speed: activity.speed,
    running: activity.running.length,
    received: activity.received,
    left: activity.left,
    history: input.history,
    networks: activity.networks.filter((network) => network.speed > 0 || network.open > 0),
    networkPreferences: input.networkPreferences,
    downloads: listed.map((download) => ({
      id: download.id,
      name: download.fileName,
      percent: percentOf(download),
      speed: download.speedBytesPerSec,
      timeLeft: download.timeLeftSeconds ?? null,
      left:
        download.totalBytes > 0 ? Math.max(0, download.totalBytes - download.bytesDownloaded) : null
    })),
    more: Math.max(0, ranked.length - listed.length),
    queued: activity.queued,
    paused: activity.paused,
    failed: activity.failed
  }
}

/** What a click in the panel asks for. */
export type PanelAction =
  | { type: 'open-download'; id: string }
  | { type: 'pause'; id: string }
  | {
      type:
        'new-download' | 'several-links' | 'pause-all' | 'resume-all' | 'settings' | 'show' | 'quit'
    }
