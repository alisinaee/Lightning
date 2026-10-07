import type { DownloadState, HttpDownloadState } from '@shared/types'
import { isVpn } from '@shared/networks'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { HISTORY_POINTS as POINTS } from '../hooks/useSpeedHistory'
import { useAppStore } from '../store/useAppStore'
import { formatBytes, formatDuration, formatSpeed } from '../utils/format'
import { rankRunning } from '../utils/statusMenu'

const HISTORY_POINTS = POINTS

/** One row of the menu: a name and what it holds. */
function Line({
  name,
  value,
  strong
}: {
  name: React.ReactNode
  value: React.ReactNode
  strong?: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
      <span className="min-w-0 truncate text-muted-foreground">{name}</span>
      <span className={`shrink-0 tabular-nums ${strong ? 'font-medium text-foreground' : ''}`}>
        {value}
      </span>
    </div>
  )
}

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-1.5 border-t-[0.5px] border-border pt-2.5 first:border-t-0 first:pt-0">
      <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

/** The speed over the last minute as a small filled line. */
function Graph({ points }: { points: number[] }): React.JSX.Element {
  const peak = Math.max(1, ...points)
  const width = 280
  const height = 44
  const step = width / (HISTORY_POINTS - 1)
  const offset = (HISTORY_POINTS - points.length) * step
  const coords = points.map(
    (value, index) =>
      `${(offset + index * step).toFixed(1)},${(height - 2 - (value / peak) * (height - 6)).toFixed(1)}`
  )
  return (
    <div>
      <svg
        role="img"
        aria-label="Total speed over the last minute"
        viewBox={`0 0 ${width} ${height}`}
        className="h-11 w-full text-primary"
        preserveAspectRatio="none"
      >
        {points.length > 1 && (
          <>
            <polygon
              points={`${offset},${height} ${coords.join(' ')} ${offset + (points.length - 1) * step},${height}`}
              fill="currentColor"
              opacity={0.15}
            />
            <polyline
              points={coords.join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>
      <div className="flex justify-between text-[10.5px] text-muted-foreground">
        <span>1 min ago</span>
        <span>peak {formatSpeed(peak === 1 ? 0 : peak)}</span>
        <span>now</span>
      </div>
    </div>
  )
}

const percentOf = (download: DownloadState): number =>
  download.totalBytes > 0
    ? Math.min(100, Math.floor((download.bytesDownloaded / download.totalBytes) * 100))
    : 0

/** What the menu opened from the status bar shows, each part as Settings → Status bar has it. */
export function StatusMenuContent({
  points,
  free
}: {
  points: number[]
  free: number | null
}): React.JSX.Element {
  const prefs = useAppStore((store) => store.statusBar)
  const downloads = useAppStore((store) => store.downloads)
  const interfaces = useAppStore((store) => store.interfaces)
  const destinationDir = useAppStore((store) => store.destinationDir)
  const setView = useAppStore((store) => store.setView)
  const networkVisual = useNetworkVisuals()

  const all = Object.values(downloads)
  const running = all.filter((download) => download.status === 'downloading')
  const count = (status: DownloadState['status']): number =>
    all.filter((download) => download.status === status).length
  const speed = running.reduce((sum, download) => sum + download.speedBytesPerSec, 0)
  const left = running.reduce(
    (sum, download) =>
      sum +
      (download.totalBytes > 0 ? Math.max(0, download.totalBytes - download.bytesDownloaded) : 0),
    0
  )
  const received = running.reduce((sum, download) => sum + download.bytesDownloaded, 0)

  // Per network: its speed, the downloads on it and its connections (streams or peers) open now.
  const perNetwork = new Map<
    string,
    { speed: number; downloads: number; active: number; open: number }
  >()
  for (const download of running) {
    const own = new Set<string>()
    for (const network of download.networks) {
      if (isVpn(network)) continue
      const row = perNetwork.get(network.id) ?? { speed: 0, downloads: 0, active: 0, open: 0 }
      row.speed += network.speedBytesPerSec
      if (network.speedBytesPerSec > 0 && !own.has(network.id)) {
        own.add(network.id)
        row.downloads += 1
      }
      perNetwork.set(network.id, row)
    }
    const connections =
      download.kind === 'http'
        ? (download as HttpDownloadState).streams.map((stream) => ({
            id: stream.interfaceId,
            moving: stream.status === 'downloading' && stream.speedBytesPerSec > 0,
            open: stream.status === 'downloading' || stream.status === 'retrying'
          }))
        : download.peers.map((peer) => ({
            id: download.networks[0]?.id ?? '',
            moving: peer.speedBytesPerSec > 0,
            open: true
          }))
    for (const connection of connections) {
      const row = perNetwork.get(connection.id)
      if (!row) continue
      if (connection.open) row.open += 1
      if (connection.moving) row.active += 1
    }
  }
  const rows = [...perNetwork.entries()]
    .map(([id, row]) => {
      const iface = interfaces.find((entry) => entry.id === id)
      const visual = iface
        ? networkVisual(iface.id, iface.kind, iface.displayName)
        : { name: id, solid: 'var(--text-secondary)' }
      return { id, ...row, name: visual.name, color: visual.solid }
    })
    .sort((a, b) => b.speed - a.speed)
  const topSpeed = Math.max(1, ...rows.map((row) => row.speed))
  const connectionTotal = rows.reduce((sum, row) => sum + row.open, 0)
  const listed = rankRunning(running)
  const shown = listed.slice(0, prefs.menuRows)

  const nothing = running.length === 0

  return (
    <div role="region" aria-label="Download activity" className="flex flex-col gap-3 font-sans">
      {prefs.menuGraph && (
        <Section title="Speed">
          <Graph points={points} />
        </Section>
      )}

      {prefs.menuTotals && (
        <Section title="Total">
          <Line name="Speed now" value={formatSpeed(speed)} strong />
          <Line name="Running" value={running.length} />
          <Line name="Received" value={formatBytes(received)} />
          {left > 0 && <Line name="Left" value={formatBytes(left)} />}
          {left > 0 && speed > 0 && (
            <Line name="Time left (all)" value={formatDuration(left / speed)} />
          )}
        </Section>
      )}

      {prefs.menuNetworks && (
        <Section title="Networks">
          {rows.length === 0 && (
            <div className="text-[12.5px] text-muted-foreground">Nothing moving</div>
          )}
          {rows.map((row) => (
            <div key={row.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-[12.5px]">
                <span className="size-2 shrink-0 rounded-full" style={{ background: row.color }} />
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                <span className="shrink-0 font-medium tabular-nums">{formatSpeed(row.speed)}</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, (row.speed / topSpeed) * 100)}%`,
                    background: row.color
                  }}
                />
              </div>
              {prefs.menuConnections && (
                <div className="text-[11px] text-muted-foreground">
                  {row.open} {row.open === 1 ? 'connection' : 'connections'} · {row.active} moving ·{' '}
                  {row.downloads} {row.downloads === 1 ? 'download' : 'downloads'}
                </div>
              )}
            </div>
          ))}
          {prefs.menuConnections && rows.length > 1 && (
            <Line name="All networks" value={`${connectionTotal} connections`} />
          )}
        </Section>
      )}

      {prefs.menuDownloads && (
        <Section
          title={`Running${listed.length > shown.length ? ` · ${shown.length} of ${listed.length}` : ''}`}
        >
          {nothing && (
            <div className="text-[12.5px] text-muted-foreground">Nothing is downloading</div>
          )}
          {shown.map((download) => (
            <button
              key={download.id}
              type="button"
              onClick={() => setView({ name: 'download', id: download.id })}
              className="flex flex-col gap-1 rounded-md px-1.5 py-1 text-left outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex items-baseline justify-between gap-2 text-[12.5px]">
                <span className="min-w-0 truncate">{download.fileName}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatSpeed(download.speedBytesPerSec)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(2, percentOf(download))}%` }}
                  />
                </span>
                <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {percentOf(download)}%
                </span>
                <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {download.timeLeftSeconds ? formatDuration(download.timeLeftSeconds) : '–'}
                </span>
              </span>
            </button>
          ))}
        </Section>
      )}

      {prefs.menuQueue && (
        <Section title="Queue">
          <Line
            name="Waiting · paused · failed"
            value={`${count('queued')} · ${count('paused')} · ${count('error')}`}
          />
        </Section>
      )}

      {prefs.menuDisk && (
        <Section title="Disk">
          <Line name="Free space" value={free === null ? '–' : formatBytes(free)} strong />
          <div className="truncate text-[11px] text-muted-foreground" title={destinationDir}>
            {destinationDir}
          </div>
        </Section>
      )}
    </div>
  )
}
