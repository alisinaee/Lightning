import { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { formatBytes, formatSpeed } from '../utils/format'
import { ScreenFooter } from './ScreenFooter'
import { ThemeToggle } from './ThemeToggle'
import { SpeedInput } from './LimitFields'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Switch } from './ui/switch'
import { UpdateIndicator } from './UpdateIndicator'

const FREE_SPACE_POLL_MS = 30_000

/** Along the bottom of every screen: how fast everything is going and under what limit, the
 * queue, the slow mode switch, and the room left where downloads are saved. */
export function StatusBar(): React.JSX.Element {
  const downloads = useAppStore((store) => store.downloads)
  const speedLimit = useAppStore((store) => store.speedLimit)
  const slowMode = useAppStore((store) => store.slowMode)
  const slowModeSpeed = useAppStore((store) => store.slowModeSpeed)
  const destinationDir = useAppStore((store) => store.destinationDir)
  const [free, setFree] = useState<number | null>(null)

  useEffect(() => {
    let disposed = false
    const load = (): void => {
      void window.plexo
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
  for (const download of Object.values(downloads)) {
    if (download.status === 'downloading') speed += download.speedBytesPerSec
    if (download.status === 'queued') waiting++
  }
  const limit = slowMode ? slowModeSpeed : speedLimit

  return (
    <ScreenFooter className="gap-4 font-mono text-[11.5px] text-muted-foreground">
      {/* At rest it says nothing: a zero speed or an empty queue only reads as broken. */}
      {(speed > 0 || limit !== undefined) && (
        <span className="tabular-nums">
          {speed > 0 && (
            <>
              ↓ <span className="text-foreground">{formatSpeed(speed)}</span>
            </>
          )}
          {limit !== undefined && `${speed > 0 ? ' · ' : ''}limit ${formatSpeed(limit)}`}
        </span>
      )}
      {waiting > 0 && <span>{waiting} waiting in the queue</span>}
      <div className="flex-1" />
      <SlowModeControl />
      {free !== null && <span>{formatBytes(free)} free</span>}
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
    <Popover>
      <PopoverTrigger
        className="flex items-center gap-1.5 rounded-sm px-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Slow mode settings"
      >
        <span
          aria-hidden
          className={`size-1.5 rounded-full ${slowMode ? 'bg-[var(--color-usb)]' : 'bg-muted-foreground/40'}`}
        />
        Slow mode
        <span className={slowMode ? 'text-foreground' : undefined}>
          {slowMode ? formatSpeed(slowModeSpeed) : 'off'}
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
          <Switch aria-label="Slow mode" checked={slowMode} onCheckedChange={setSlowMode} />
        </div>
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="text-muted-foreground">Speed</span>
          <SpeedInput bytes={slowModeSpeed} label="Slow mode speed" onChange={setSlowModeSpeed} />
        </div>
      </PopoverContent>
    </Popover>
  )
}
