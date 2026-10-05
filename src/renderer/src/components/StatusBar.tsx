import { useEffect, useState } from 'react'
import { isVpn } from '@shared/networks'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { useAppStore } from '../store/useAppStore'
import { formatBytes, formatSpeed } from '../utils/format'
import { ScheduleChip } from './ScheduleChip'
import { ScreenFooter } from './ScreenFooter'
import { ThemeToggle } from './ThemeToggle'
import { SpeedInput } from './LimitFields'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Switch } from './ui/switch'
import { UpdateIndicator } from './UpdateIndicator'

const FREE_SPACE_POLL_MS = 30_000

/** One bar along the bottom: how many downloads, the total speed, each connection's speed when
 * there is room, then slow mode and the free space. */
export function StatusBar(): React.JSX.Element {
  const downloads = useAppStore((store) => store.downloads)
  const history = useAppStore((store) => store.history)
  const speedLimit = useAppStore((store) => store.speedLimit)
  const slowMode = useAppStore((store) => store.slowMode)
  const slowModeSpeed = useAppStore((store) => store.slowModeSpeed)
  const destinationDir = useAppStore((store) => store.destinationDir)
  const interfaces = useAppStore((store) => store.interfaces)
  const networkVisual = useNetworkVisuals()
  const [free, setFree] = useState<number | null>(null)

  useEffect(() => {
    let disposed = false
    const load = (): void => {
      void window.lightning
        .freeSpace(destinationDir)
        .then((bytes) => !disposed && setFree(bytes))
        .catch(() => {})
    }
    load()
    const interval = setInterval(load, FREE_SPACE_POLL_MS)
    return () => {
      disposed = true
      clearInterval(interval)
    }
  }, [destinationDir])

  let speed = 0
  let waiting = 0
  const perNetwork = new Map<string, number>()
  for (const download of Object.values(downloads)) {
    if (download.status === 'downloading') {
      speed += download.speedBytesPerSec
      for (const network of download.networks) {
        if (isVpn(network) || network.speedBytesPerSec <= 0) continue
        perNetwork.set(network.id, (perNetwork.get(network.id) ?? 0) + network.speedBytesPerSec)
      }
    }
    if (download.status === 'queued') waiting++
  }
  const listed = Object.keys(downloads).length + history.length
  const limit = slowMode ? slowModeSpeed : speedLimit
  const chips = [...perNetwork.entries()].map(([id, bytes]) => {
    const iface = interfaces.find((entry) => entry.id === id)
    const visual = iface
      ? networkVisual(iface.id, iface.kind, iface.displayName)
      : { name: id, solid: 'var(--text-secondary)' }
    return { id, bytes, name: visual.name, color: visual.solid }
  })

  return (
    <ScreenFooter className="gap-3 font-mono text-[11.5px] text-muted-foreground">
      <span className="shrink-0 text-foreground">
        {listed} {listed === 1 ? 'download' : 'downloads'}
      </span>
      {speed > 0 && (
        <span className="shrink-0 tabular-nums">
          ↓ <span className="text-foreground">{formatSpeed(speed)}</span>
        </span>
      )}
      {limit !== undefined && (
        <span className="shrink-0 tabular-nums">limit {formatSpeed(limit)}</span>
      )}
      {waiting > 0 && <span className="shrink-0">{waiting} waiting</span>}
      <ScheduleChip />
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
        {chips.map((chip) => (
          <span key={chip.id} className="flex shrink-0 items-center gap-1.5 tabular-nums">
            <span className="size-1.5 rounded-full" style={{ background: chip.color }} />
            <span className="max-w-[120px] truncate">{chip.name}</span>
            <span className="text-foreground">{formatSpeed(chip.bytes)}</span>
          </span>
        ))}
      </div>
      <SlowModeControl />
      {free !== null && <span className="shrink-0">{formatBytes(free)} free</span>}
      <UpdateIndicator />
      <ThemeToggle />
    </ScreenFooter>
  )
}

/** Slow mode in the status bar: the item shows the state; clicking it opens the switch and the
 * speed, both applied as they change. */
function SlowModeControl(): React.JSX.Element {
  const slowMode = useAppStore((store) => store.slowMode)
  const slowModeSpeed = useAppStore((store) => store.slowModeSpeed)
  const setSlowMode = useAppStore((store) => store.setSlowMode)
  const setSlowModeSpeed = useAppStore((store) => store.setSlowModeSpeed)
  return (
    <span className="flex shrink-0 items-center gap-2">
      <Switch aria-label="Slow mode" checked={slowMode} onCheckedChange={setSlowMode} />
      <Popover>
        <PopoverTrigger
          className="flex items-center gap-1.5 rounded-sm px-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Slow mode speed"
        >
          Slow mode
          <span className={slowMode ? 'text-foreground' : undefined}>
            {formatSpeed(slowModeSpeed)}
          </span>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-[300px] gap-3 p-3 font-sans">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">Slow mode</div>
              <div className="text-[12px] leading-snug text-muted-foreground">
                Caps all downloads at this speed, replacing the total limit. Handy during calls.
              </div>
            </div>
            <Switch
              aria-label="Enable slow mode"
              checked={slowMode}
              onCheckedChange={setSlowMode}
            />
          </div>
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className="text-muted-foreground">Speed</span>
            <SpeedInput bytes={slowModeSpeed} label="Slow mode speed" onChange={setSlowModeSpeed} />
          </div>
        </PopoverContent>
      </Popover>
    </span>
  )
}
