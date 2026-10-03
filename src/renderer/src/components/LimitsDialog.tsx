import { DOWNLOADS_AT_ONCE } from '@shared/types'
import { Minus, Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { useNetworkUsage } from '../hooks/useNetworks'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { useAppStore } from '../store/useAppStore'
import { formatBytes, formatSpeed } from '../utils/format'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Switch } from './ui/switch'

const MB = 1024 ** 2
const GB = 1024 ** 3

const sectionClass = 'flex flex-col gap-3 border-t-[0.5px] border-border py-5'
const headingClass = 'font-sans text-[14px] leading-none font-semibold'
const hintClass = 'text-[12.5px] leading-snug text-[var(--text-secondary)]'
const navLabelClass =
  'px-3 pt-4 pb-2 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase'

/** A number of `unit`s typed in, as bytes; anything that isn't a positive number is ignored. */
function NumberInput({
  bytes,
  unit,
  unitBytes,
  label,
  onChange
}: {
  bytes: number
  unit: string
  unitBytes: number
  label: string
  onChange: (bytes: number) => void
}): React.JSX.Element {
  // Kept as typed, so a half-typed "1." isn't rewritten under the cursor.
  const [text, setText] = useState(() => String(Number((bytes / unitBytes).toFixed(2))))
  return (
    <span className="flex items-center gap-2">
      <Input
        aria-label={label}
        inputMode="decimal"
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          const value = Number(event.target.value)
          if (value > 0) onChange(Math.round(value * unitBytes))
        }}
        className="w-20 text-right font-mono tabular-nums"
      />
      <span className="font-mono text-[12px] text-muted-foreground">{unit}</span>
    </span>
  )
}

/** No limit, or a limit of so many `unit`s: two radio buttons and the number. */
function LimitChoice({
  label,
  value,
  fallback,
  unit,
  unitBytes,
  onChange
}: {
  label: string
  value: number | undefined
  /** Offered when switching from no limit. */
  fallback: number
  unit: string
  unitBytes: number
  onChange: (bytes: number | undefined) => void
}): React.JSX.Element {
  const name = useId()
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-2.5">
      <label className="flex items-center gap-2.5 text-[13.5px]">
        <input
          type="radio"
          name={name}
          checked={value === undefined}
          onChange={() => onChange(undefined)}
          className="size-4 accent-[var(--color-accent)]"
        />
        No limit
      </label>
      <label className="flex items-center gap-2.5 text-[13.5px]">
        <input
          type="radio"
          name={name}
          checked={value !== undefined}
          onChange={() => onChange(fallback)}
          className="size-4 accent-[var(--color-accent)]"
        />
        Limit to
        <NumberInput
          // Remounted when the limit is switched on, so it shows the value it starts at.
          key={value === undefined ? 'off' : 'on'}
          bytes={value ?? fallback}
          unit={unit}
          unitBytes={unitBytes}
          label={`${label}, in ${unit}`}
          onChange={onChange}
        />
      </label>
    </div>
  )
}

function GeneralPage({ running }: { running: number }): React.JSX.Element {
  const speedLimit = useAppStore((store) => store.speedLimit)
  const setSpeedLimit = useAppStore((store) => store.setSpeedLimit)
  const slowMode = useAppStore((store) => store.slowMode)
  const setSlowMode = useAppStore((store) => store.setSlowMode)
  const slowModeSpeed = useAppStore((store) => store.slowModeSpeed)
  const setSlowModeSpeed = useAppStore((store) => store.setSlowModeSpeed)
  const downloadsAtOnce = useAppStore((store) => store.downloadsAtOnce)
  const setDownloadsAtOnce = useAppStore((store) => store.setDownloadsAtOnce)

  return (
    <>
      <div className="flex flex-col gap-1.5 pb-5">
        <h3 className="font-sans text-[20px] leading-none font-semibold">All downloads</h3>
        <div className="font-mono text-[12px] text-muted-foreground">
          {running === 0 ? 'nothing downloading right now' : `${running} downloading right now`}
        </div>
      </div>

      <section className={sectionClass}>
        <h4 className={headingClass}>Total speed</h4>
        <p className={hintClass}>
          A ceiling for everything Plexo downloads, across all networks together.
        </p>
        <LimitChoice
          label="Total speed"
          value={speedLimit}
          fallback={20 * MB}
          unit="MB/s"
          unitBytes={MB}
          onChange={setSpeedLimit}
        />
      </section>

      <section className={sectionClass}>
        <h4 className={headingClass}>Slow mode</h4>
        <p className={hintClass}>
          A one-click switch in the status bar for video calls or streaming. Turns on this lower
          limit until you switch it off.
        </p>
        <div className="flex items-center gap-3 text-[13.5px]">
          Slow mode speed
          <NumberInput
            bytes={slowModeSpeed}
            unit="MB/s"
            unitBytes={MB}
            label="Slow mode speed, in MB/s"
            onChange={setSlowModeSpeed}
          />
          <div className="flex-1" />
          <label className="flex items-center gap-2.5">
            On now
            <Switch checked={slowMode} onCheckedChange={setSlowMode} />
          </label>
        </div>
      </section>

      <section className={sectionClass}>
        <h4 className={headingClass}>Downloads at once</h4>
        <p className={hintClass}>The rest wait in line and start by themselves.</p>
        <div className="flex items-center gap-3 text-[13.5px]">
          <div className="flex items-center rounded-lg border border-input">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="One fewer"
              disabled={downloadsAtOnce <= DOWNLOADS_AT_ONCE.min}
              onClick={() => setDownloadsAtOnce(downloadsAtOnce - 1)}
            >
              <Minus />
            </Button>
            <output
              aria-label="Downloads at once"
              className="w-8 text-center font-mono tabular-nums"
            >
              {downloadsAtOnce}
            </output>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="One more"
              disabled={downloadsAtOnce >= DOWNLOADS_AT_ONCE.max}
              onClick={() => setDownloadsAtOnce(downloadsAtOnce + 1)}
            >
              <Plus />
            </Button>
          </div>
          at the same time
        </div>
      </section>
    </>
  )
}

function NetworkPage({
  id,
  name,
  used
}: {
  id: string
  name: string
  used: number
}): React.JSX.Element {
  const preference = useAppStore((store) => store.networkPreferences[id])
  const setNetworkPreference = useAppStore((store) => store.setNetworkPreference)
  const dataLimit = preference?.dataLimit

  return (
    <>
      <div className="flex flex-col gap-1.5 pb-5">
        <h3 className="font-sans text-[20px] leading-none font-semibold">{name}</h3>
        <div className="font-mono text-[12px] text-muted-foreground">
          {formatBytes(used)} used by Plexo this month
        </div>
      </div>

      <section className={sectionClass}>
        <h4 className={headingClass}>Speed</h4>
        <p className={hintClass}>
          How fast Plexo may download over {name}, every download together.
        </p>
        <LimitChoice
          label={`${name} speed`}
          value={preference?.speedLimit}
          fallback={10 * MB}
          unit="MB/s"
          unitBytes={MB}
          onChange={(speedLimit) => setNetworkPreference(id, { speedLimit })}
        />
      </section>

      <section className={sectionClass}>
        <h4 className={headingClass}>Data each month</h4>
        <p className={hintClass}>
          For a phone or a metered plan. Counts what Plexo downloads over {name}, not other apps;
          once it’s used up, downloads stop using {name} until next month.
        </p>
        <LimitChoice
          label={`${name} data each month`}
          value={dataLimit}
          fallback={5 * GB}
          unit="GB"
          unitBytes={GB}
          onChange={(limit) => setNetworkPreference(id, { dataLimit: limit })}
        />
        {dataLimit !== undefined && <UsageBar used={used} limit={dataLimit} />}
      </section>
    </>
  )
}

/** "5.00 of 5 GB this month", with a bar that turns red once the limit is reached. */
export function UsageBar({ used, limit }: { used: number; limit: number }): React.JSX.Element {
  const reached = used >= limit
  const color = reached ? 'var(--color-danger)' : 'var(--color-wifi)'
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, (used / limit) * 100)}%`, background: color }}
        />
      </div>
      <div
        className={`font-mono text-[11.5px] whitespace-nowrap ${reached ? 'text-[var(--color-danger)]' : 'text-muted-foreground'}`}
      >
        {formatBytes(used)} of {formatBytes(limit)} this month
      </div>
    </div>
  )
}

/** One line under a network's name: its limits, or that it has reached one. */
function describeLimits(
  preference: { speedLimit?: number; dataLimit?: number } | undefined,
  used: number
): string {
  if (preference?.dataLimit !== undefined && used >= preference.dataLimit) {
    return 'data limit reached'
  }
  const parts = [
    preference?.speedLimit !== undefined && formatSpeed(preference.speedLimit),
    preference?.dataLimit !== undefined && `${formatBytes(preference.dataLimit)} a month`
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'no limits'
}

/** Speed & data limits: every download's together, and each network's. Changes apply at once. */
export function LimitsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const interfaces = useAppStore((store) => store.interfaces)
  const preferences = useAppStore((store) => store.networkPreferences)
  const speedLimit = useAppStore((store) => store.speedLimit)
  const slowMode = useAppStore((store) => store.slowMode)
  const running = useAppStore(
    (store) =>
      Object.values(store.downloads).filter((download) => download.status === 'downloading').length
  )
  const networkVisual = useNetworkVisuals()
  const usage = useNetworkUsage(open)
  const [page, setPage] = useState<string | null>(null)
  const shown = interfaces.find((iface) => iface.id === page)

  const navItem = (
    key: string | null,
    dot: string,
    name: string,
    detail: string,
    warn = false
  ): React.JSX.Element => (
    <button
      key={key ?? 'general'}
      type="button"
      aria-current={page === key ? 'page' : undefined}
      onClick={() => setPage(key)}
      className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left aria-[current=page]:bg-secondary"
    >
      <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: dot }} />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-[13.5px] font-medium">{name}</span>
        <span
          className={`font-mono text-[11px] ${warn ? 'text-[var(--color-usb)]' : 'text-muted-foreground'}`}
        >
          {detail}
        </span>
      </span>
    </button>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(620px,calc(100%-2rem))] max-w-[760px] flex-col gap-0 p-0 sm:max-w-[760px]">
        <div className="flex items-center border-b-[0.5px] border-border px-5 py-4">
          <DialogTitle className="text-[16px] font-semibold">Speed &amp; data limits</DialogTitle>
        </div>
        <div className="flex min-h-0 flex-1">
          <nav className="w-[230px] shrink-0 overflow-y-auto border-r-[0.5px] border-border p-2">
            <div className={navLabelClass}>General</div>
            {navItem(
              null,
              'var(--text-secondary)',
              'All downloads',
              slowMode ? 'slow mode on' : speedLimit ? formatSpeed(speedLimit) : 'no limit'
            )}
            <div className={navLabelClass}>Networks</div>
            {interfaces.map((iface) => {
              const visual = networkVisual(iface.id, iface.kind, iface.displayName)
              const detail = describeLimits(preferences[iface.id], usage[iface.id] ?? 0)
              return navItem(
                iface.id,
                visual.solid,
                visual.name,
                detail,
                detail === 'data limit reached'
              )
            })}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {shown ? (
              <NetworkPage
                key={shown.id}
                id={shown.id}
                name={networkVisual(shown.id, shown.kind, shown.displayName).name}
                used={usage[shown.id] ?? 0}
              />
            ) : (
              <GeneralPage running={running} />
            )}
          </div>
        </div>
        <div className="flex items-center border-t-[0.5px] border-border px-5 py-3">
          <div className="font-mono text-[11.5px] text-muted-foreground">
            Changes apply right away
          </div>
          <div className="flex-1" />
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
