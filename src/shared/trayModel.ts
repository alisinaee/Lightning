import { isVpn } from './networks'
import type { DownloadState, StatusBarPrefs } from './types'

/** What the menu of the menu-bar icon holds, before it becomes a native menu: kept apart so it is
 * decided in one place and can be tested without a window. */
export type TrayLine =
  | { kind: 'info'; text: string }
  | { kind: 'download'; id: string; text: string }
  | { kind: 'separator' }

export interface TrayModel {
  /** Text beside the icon in the menu bar; empty for none. */
  title: string
  /** The status lines above the menu's commands. */
  lines: TrayLine[]
  running: number
  /** Whether there is anything for Pause All and Resume All to act on. */
  canPause: boolean
  canResume: boolean
  /** Changes whenever what is shown does, so an unchanged menu is not rebuilt. */
  signature: string
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  let value = bytes / 1024 ** exponent
  if (exponent < UNITS.length - 1 && Number(value.toFixed(exponent === 0 ? 0 : 1)) >= 1024) {
    exponent += 1
    value = bytes / 1024 ** exponent
  }
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${UNITS[exponent]}`
}

export const formatSpeed = (bytesPerSec: number): string => `${formatBytes(bytesPerSec)}/s`

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`
}

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

const percentOf = (download: DownloadState): number =>
  download.totalBytes > 0
    ? Math.min(100, Math.floor((download.bytesDownloaded / download.totalBytes) * 100))
    : 0

/** The status part of the menu from the downloads there are now. `names` are the names the
 * person gave their networks. */
export function buildTrayModel(
  downloads: readonly DownloadState[],
  names: Record<string, string>,
  prefs: StatusBarPrefs
): TrayModel {
  const running = downloads.filter((download) => download.status === 'downloading')
  const count = (...statuses: DownloadState['status'][]): number =>
    downloads.filter((download) => statuses.includes(download.status)).length
  const queued = count('queued')
  const paused = count('paused')
  const failed = count('error')
  const speed = running.reduce((sum, download) => sum + download.speedBytesPerSec, 0)

  const lines: TrayLine[] = []
  if (prefs.trayTotals) {
    lines.push({
      kind: 'info',
      text:
        running.length === 0
          ? 'Nothing is downloading'
          : `${running.length} downloading · ↓ ${formatSpeed(speed)}`
    })
  }

  if (prefs.trayNetworks && running.length > 0) {
    const perNetwork = new Map<string, { label: string; speed: number; open: number }>()
    for (const download of running) {
      for (const network of download.networks) {
        if (isVpn(network)) continue
        const row = perNetwork.get(network.id) ?? {
          label: names[network.id] || network.label,
          speed: 0,
          open: 0
        }
        row.speed += network.speedBytesPerSec
        perNetwork.set(network.id, row)
      }
      const connections =
        download.kind === 'http'
          ? download.streams
              .filter((stream) => stream.status === 'downloading' || stream.status === 'retrying')
              .map((stream) => stream.interfaceId)
          : download.peers.map(() => download.networks[0]?.id ?? '')
      for (const id of connections) {
        const row = perNetwork.get(id)
        if (row) row.open += 1
      }
    }
    for (const row of [...perNetwork.values()]
      .filter((entry) => entry.speed > 0)
      .sort((a, b) => b.speed - a.speed)) {
      lines.push({
        kind: 'info',
        text: `   ${clip(row.label, 24)}  ${formatSpeed(row.speed)} · ${row.open} ${row.open === 1 ? 'connection' : 'connections'}`
      })
    }
  }

  if (prefs.trayDownloads && running.length > 0) {
    if (lines.length > 0) lines.push({ kind: 'separator' })
    const ranked = [...running].sort((a, b) => b.speedBytesPerSec - a.speedBytesPerSec)
    for (const download of ranked.slice(0, prefs.trayRows)) {
      const left = download.timeLeftSeconds ? ` · ${formatTime(download.timeLeftSeconds)}` : ''
      lines.push({
        kind: 'download',
        id: download.id,
        text: `${clip(download.fileName, 34)}  ${percentOf(download)}% · ${formatSpeed(download.speedBytesPerSec)}${left}`
      })
    }
    if (ranked.length > prefs.trayRows) {
      lines.push({ kind: 'info', text: `…and ${ranked.length - prefs.trayRows} more` })
    }
  }

  if (prefs.trayQueue && (queued > 0 || paused > 0 || failed > 0)) {
    if (lines.length > 0) lines.push({ kind: 'separator' })
    lines.push({
      kind: 'info',
      text: [
        queued > 0 && `${queued} waiting`,
        paused > 0 && `${paused} paused`,
        failed > 0 && `${failed} failed`
      ]
        .filter(Boolean)
        .join(' · ')
    })
  }

  const title = prefs.trayTitle && speed > 0 ? ` ${formatSpeed(speed)}` : ''
  const model: Omit<TrayModel, 'signature'> = {
    title,
    lines,
    running: running.length,
    canPause: count('downloading', 'queued') > 0,
    canResume: paused > 0
  }
  return {
    ...model,
    signature: JSON.stringify([model.title, model.lines, model.canPause, model.canResume])
  }
}
