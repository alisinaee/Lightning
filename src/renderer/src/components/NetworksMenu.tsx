import { CaretDown as ChevronDown, CaretRight as ChevronRight } from '@phosphor-icons/react'
import { useState } from 'react'
import { useLatencyPolling, useNetworkUsage } from '../hooks/useNetworks'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { isNetworkOff, isVpn } from '@shared/networks'
import { useAppStore } from '../store/useAppStore'
import { formatSpeed } from '../utils/format'
import { DnsPicker } from './DnsPicker'
import { useDns } from '../hooks/useDns'
import { UsageBar } from './LimitsDialog'
import { NetworkKindIcon } from './NetworkKindIcon'
import { NetworkEditPopover } from './NetworkEditPopover'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import { formatNumber, t, tn } from '@shared/i18n/react'

const kindLabel = (kind: string): string => {
  switch (kind) {
    case 'wifi':
      return t('Wi-Fi')
    case 'usb':
      return t('USB network')
    case 'ethernet':
      return t('Ethernet')
    case 'bridge':
      return t('Bridge')
    case 'vpn':
      return t('VPN')
    default:
      return t('Network')
  }
}

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
            : tn(interfaces.length, '{on} of {count} network on', '{on} of {count} networks on', {
                on: on.length
              })
        }
        render={<Button type="button" variant="secondary" className="gap-2.5 px-3 text-[13px]" />}
      >
        <span className="flex gap-1.5" aria-hidden>
          {interfaces.slice(0, 4).map((iface) => (
            <NetworkKindIcon
              key={iface.id}
              kind={iface.kind}
              className="size-4"
              // Each icon in its network's colour, dimmed while that network is off.
              style={{
                color: networkVisual(iface.id, iface.kind, iface.displayName).solid,
                opacity: isNetworkOff(iface, preferences) ? 0.35 : 1
              }}
            />
          ))}
        </span>
        {interfaces.length === 0 ? (
          <span className="text-[var(--color-danger)]">{t('No network')}</span>
        ) : (
          <>
            <span className="font-mono text-[12px] tabular-nums">
              {formatNumber(on.length)}/{formatNumber(interfaces.length)}
            </span>
          </>
        )}
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-max max-w-[480px] min-w-[360px] gap-0 p-0">
        <div className="flex flex-col gap-0.5 px-4 pt-4 pb-2">
          <div className="text-[13px] font-semibold tracking-tight">{t('Networks')}</div>
          <div className="text-[12px] leading-snug text-[var(--text-secondary)]">
            {t('New downloads use the ones switched on. Each download can change this.')}
          </div>
        </div>
        <div className="flex flex-col gap-1 px-2 pb-2">
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
                className="group relative flex flex-col gap-2 rounded-xl px-2.5 py-2.5 hover:bg-muted"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-[10px]"
                    style={{
                      background: `color-mix(in srgb, ${visual.solid} 16%, transparent)`,
                      color: visual.solid,
                      opacity: isNetworkOff(iface, preferences) ? 0.5 : 1
                    }}
                  >
                    <NetworkKindIcon kind={iface.kind} className="size-[18px]" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
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
                      className={`truncate text-[11.5px] ${reached ? 'text-[var(--color-danger)]' : 'text-muted-foreground'}`}
                    >
                      {reached
                        ? t('Data limit reached')
                        : [
                            iface.displayName !== visual.name
                              ? iface.displayName
                              : kindLabel(iface.kind),
                            speed > 0 ? formatSpeed(speed) : null,
                            typeof latencies[iface.id] === 'number'
                              ? `${Math.round(latencies[iface.id]!)} ms`
                              : null
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                    </div>
                  </div>
                  <Switch
                    className="relative z-10"
                    aria-label={t('Use {name} for new downloads', { name: visual.name })}
                    checked={!isNetworkOff(iface, preferences)}
                    onCheckedChange={(checked) => setNetworkPreference(iface.id, { off: !checked })}
                  />
                  <button
                    type="button"
                    aria-label={t('{name} limits', { name: visual.name })}
                    className="text-muted-foreground/60 outline-none group-hover:text-foreground after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                    onClick={() => {
                      setOpen(false)
                      onOpenLimits(iface.id)
                    }}
                  >
                    <ChevronRight className="size-4 rtl:-scale-x-100" />
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
        </div>
        <div className="mx-2 flex items-center gap-3 border-t-[0.5px] border-border px-2.5 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-medium">DNS</div>
            <div className="text-[11.5px] leading-snug text-muted-foreground">
              {t('How names are looked up')}
            </div>
          </div>
          <DnsPicker
            value={dns.defaultId ?? 'system'}
            label={t('Default DNS')}
            onChange={(id) => void window.lightning.setDefaultDns(id === 'system' ? null : id)}
          />
        </div>
        <button
          type="button"
          className="mx-2 mb-2 rounded-lg px-2.5 py-2 text-start text-[12.5px] font-medium text-primary hover:bg-muted"
          onClick={() => {
            setOpen(false)
            onOpenLimits(null)
          }}
        >
          {t('Speed & data limits…')}
        </button>
      </PopoverContent>
    </Popover>
  )
}
