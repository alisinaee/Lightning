import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useNetworkUsage } from '../hooks/useNetworks'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { useAppStore } from '../store/useAppStore'
import { formatSpeed } from '../utils/format'
import { UsageBar } from './LimitsDialog'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Switch } from './ui/switch'

/** The networks new downloads combine, switched on or off here; each download can still change
 * its own. Also how fast each is going right now, and how much of its data limit is left. */
export function NetworksMenu({ onOpenLimits }: { onOpenLimits: () => void }): React.JSX.Element {
  const interfaces = useAppStore((store) => store.interfaces)
  const preferences = useAppStore((store) => store.networkPreferences)
  const setNetworkPreference = useAppStore((store) => store.setNetworkPreference)
  const downloads = useAppStore((store) => store.downloads)
  const networkVisual = useNetworkVisuals()
  const [open, setOpen] = useState(false)
  const usage = useNetworkUsage(open)

  // Every running download's speed over each network, added up.
  const speeds = new Map<string, number>()
  for (const download of Object.values(downloads)) {
    if (download.status !== 'downloading') continue
    for (const network of download.networks) {
      speeds.set(network.id, (speeds.get(network.id) ?? 0) + network.speedBytesPerSec)
    }
  }
  const total = [...speeds.values()].reduce((sum, speed) => sum + speed, 0)
  const on = interfaces.filter((iface) => !preferences[iface.id]?.off)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex h-8 items-center gap-2.5 rounded-lg border border-border bg-card px-3 text-[13px]"
          />
        }
      >
        <span className="flex gap-1" aria-hidden>
          {interfaces.slice(0, 4).map((iface) => (
            <span
              key={iface.id}
              className="size-2 rounded-full"
              style={{
                background: networkVisual(iface.id, iface.kind, iface.displayName).solid,
                opacity: preferences[iface.id]?.off ? 0.3 : 1
              }}
            />
          ))}
        </span>
        {on.length} {on.length === 1 ? 'network' : 'networks'}
        <span className="font-mono text-[11.5px] text-muted-foreground">
          {total > 0 ? formatSpeed(total) : 'idle'}
        </span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] gap-0 p-0">
        <div className="flex flex-col gap-1.5 border-b-[0.5px] border-border p-4">
          <div className="text-[14px] font-semibold">Default networks</div>
          <div className="text-[12.5px] leading-snug text-[var(--text-secondary)]">
            New downloads combine the networks turned on here. You can change this for any single
            download.
          </div>
        </div>
        {interfaces.map((iface) => {
          const visual = networkVisual(iface.id, iface.kind, iface.displayName)
          const preference = preferences[iface.id]
          const used = usage[iface.id] ?? 0
          const dataLimit = preference?.dataLimit
          const reached = dataLimit !== undefined && used >= dataLimit
          const speed = speeds.get(iface.id) ?? 0
          return (
            <div
              key={iface.id}
              className="flex flex-col gap-2 border-b-[0.5px] border-border px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: visual.solid }}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="truncate text-[13.5px] font-medium">{visual.name}</div>
                  <div
                    className={`font-mono text-[11px] ${reached ? 'text-[var(--color-danger)]' : 'text-muted-foreground'}`}
                  >
                    {reached
                      ? 'Data limit reached · paused'
                      : `${iface.displayName} · ${speed > 0 ? formatSpeed(speed) : 'idle'}`}
                  </div>
                </div>
                <Switch
                  aria-label={`Use ${visual.name} for new downloads`}
                  checked={!preference?.off}
                  onCheckedChange={(checked) =>
                    setNetworkPreference(iface.id, { off: checked ? undefined : true })
                  }
                />
                <button
                  type="button"
                  aria-label={`${visual.name} limits`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setOpen(false)
                    onOpenLimits()
                  }}
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
              {dataLimit !== undefined && <UsageBar used={used} limit={dataLimit} />}
            </div>
          )
        })}
        <button
          type="button"
          className="px-4 py-3 text-[13px] font-medium text-primary hover:underline"
          onClick={() => {
            setOpen(false)
            onOpenLimits()
          }}
        >
          Speed &amp; data limits…
        </button>
      </PopoverContent>
    </Popover>
  )
}
