import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useLatencyPolling, useNetworkUsage } from '../hooks/useNetworks'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { isNetworkOff, isVpn } from '@shared/networks'
import { useAppStore } from '../store/useAppStore'
import { formatSpeed } from '../utils/format'
import { DnsPicker } from './DnsPicker'
import { useDns } from '../hooks/useDns'
import { UsageBar } from './LimitsDialog'
import { NetworkEditPopover } from './NetworkEditPopover'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Button } from './ui/button'
import { Switch } from './ui/switch'

const KIND_LABELS: Record<string, string> = {
  wifi: 'Wi-Fi',
  usb: 'USB network',
  ethernet: 'Ethernet',
  bridge: 'Bridge',
  vpn: 'VPN',
  other: 'Network'
}
const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? 'Network'

/** The networks new downloads combine, switched on or off here; each download can still change
 * its own. Also how fast each is going right now, and how much of its data limit is left. */
export function NetworksMenu({
  onOpenLimits
}: {
  /** Opens Speed & data limits on that network's page, or General for null. */
  onOpenLimits: (page: string | null) => void
}): React.JSX.Element {
  const interfaces = useAppStore((store) => store.interfaces)
  const preferences = useAppStore((store) => store.networkPreferences)
  const setNetworkPreference = useAppStore((store) => store.setNetworkPreference)
  const downloads = useAppStore((store) => store.downloads)
  const networkVisual = useNetworkVisuals()
  const latencies = useAppStore((store) => store.latencies)
  const [open, setOpen] = useState(false)
  const dns = useDns()
  const usage = useNetworkUsage(open)
  useLatencyPolling(open)

  // Every running download's speed over each network, added up.
  const speeds = new Map<string, number>()
  for (const download of Object.values(downloads)) {
    if (download.status !== 'downloading') continue
    for (const network of download.networks) {
      if (isVpn(network)) continue
      speeds.set(network.id, (speeds.get(network.id) ?? 0) + network.speedBytesPerSec)
    }
  }
  const on = interfaces.filter((iface) => !isNetworkOff(iface, preferences))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        // The button shows only "1/2": a screen reader gets it in words.
        aria-label={
          interfaces.length === 0
            ? undefined
            : `${on.length} of ${interfaces.length} ${interfaces.length === 1 ? 'network' : 'networks'} on`
        }
        render={<Button type="button" variant="secondary" className="gap-2.5 px-3 text-[13px]" />}
      >
        <span className="flex gap-1" aria-hidden>
          {interfaces.slice(0, 4).map((iface) => (
            <span
              key={iface.id}
              className="size-2 rounded-full"
              style={{
                background: networkVisual(iface.id, iface.kind, iface.displayName).solid,
                opacity: isNetworkOff(iface, preferences) ? 0.3 : 1
              }}
            />
          ))}
        </span>
        {interfaces.length === 0 ? (
          <span className="text-[var(--color-danger)]">No network</span>
        ) : (
          <>
            <span className="font-mono text-[12px] tabular-nums">
              {on.length}/{interfaces.length}
            </span>
          </>
        )}
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-max max-w-[520px] min-w-[380px] gap-0 p-0">
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
              // The whole row opens this network's limits (the chevron's button stretches over it);
              // the switch and the pencil sit above it and do their own thing.
              className="group relative flex flex-col gap-2 border-b-[0.5px] border-border px-4 py-3 hover:bg-muted"
            >
              <div className="flex items-center gap-3">
                <span
                  className="mt-[7px] size-2 shrink-0 self-start rounded-full"
                  style={{ background: visual.solid }}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="truncate text-[13.5px] font-medium">{visual.name}</span>
                    <span className="relative z-10 flex">
                      <NetworkEditPopover
                        interfaceId={iface.id}
                        interfaceKind={iface.kind}
                        osName={iface.displayName}
                      />
                    </span>
                  </div>
                  <div
                    className={`truncate font-mono text-[11px] ${reached ? 'text-[var(--color-danger)]' : 'text-muted-foreground'}`}
                  >
                    {reached
                      ? 'Data limit reached'
                      : iface.displayName !== visual.name
                        ? iface.displayName
                        : kindLabel(iface.kind)}
                  </div>
                </div>
                {/* Figures sit in columns of their own, so every row lines up whatever the names. */}
                <div className="flex shrink-0 flex-col items-end gap-1 font-mono text-[11px] leading-none text-muted-foreground tabular-nums">
                  <span className="w-[72px] text-right">
                    {speed > 0 ? formatSpeed(speed) : 'Idle'}
                  </span>
                  <span className="w-[72px] text-right">
                    {typeof latencies[iface.id] === 'number'
                      ? `${Math.round(latencies[iface.id]!)} ms`
                      : '–'}
                  </span>
                </div>
                <Switch
                  className="relative z-10"
                  aria-label={`Use ${visual.name} for new downloads`}
                  checked={!isNetworkOff(iface, preferences)}
                  onCheckedChange={(checked) => setNetworkPreference(iface.id, { off: !checked })}
                />
                <button
                  type="button"
                  aria-label={`${visual.name} limits`}
                  className="text-muted-foreground outline-none group-hover:text-foreground after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                  onClick={() => {
                    setOpen(false)
                    onOpenLimits(iface.id)
                  }}
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
              {dataLimit !== undefined && (
                <UsageBar
                  used={used}
                  limit={dataLimit}
                  period={preference?.dataLimitPeriod ?? 'month'}
                />
              )}
            </div>
          )
        })}
        <div className="flex items-center gap-3 border-b-[0.5px] border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-medium">DNS</div>
            <div className="text-[11.5px] leading-snug text-muted-foreground">
              How names are looked up. A group or a single download can use its own.
            </div>
          </div>
          <DnsPicker
            value={dns.defaultId ?? 'system'}
            label="Default DNS"
            onChange={(id) => void window.lightning.setDefaultDns(id === 'system' ? null : id)}
          />
        </div>
        <button
          type="button"
          className="px-4 py-3 text-[13px] font-medium text-primary hover:underline"
          onClick={() => {
            setOpen(false)
            onOpenLimits(null)
          }}
        >
          Speed &amp; data limits…
        </button>
      </PopoverContent>
    </Popover>
  )
}
