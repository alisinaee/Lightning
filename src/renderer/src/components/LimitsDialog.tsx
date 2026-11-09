import { t, tn, formatDate } from '@shared/i18n/react'
import { DATA_LIMIT_PERIODS, nextDataReset } from '@shared/dataLimits'
import {
  DEFAULT_SLOW_MODE_SPEED,
  DOWNLOADS_AT_ONCE,
  type DataLimitPeriod,
  type NetworkPreference
} from '@shared/types'
import { Minus, Plus } from '@phosphor-icons/react'
import { useCallback, useEffect, useId, useState } from 'react'
import { useNetworkUsage } from '../hooks/useNetworks'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { useAppStore } from '../store/useAppStore'
import { describeError, formatBytes, formatSpeed } from '../utils/format'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction
} from './ui/alert-dialog'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { VpnSwitch } from './VpnSwitch'
import { SpeedInput, UnitField } from './LimitFields'
import { DATA_UNITS, FieldValidityContext, GB, MB } from './limitUnits'
import { Switch } from './ui/switch'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

/** What the dialog edits: a copy taken when it opens, written back only on Save. */
type Draft = Pick<
  ReturnType<typeof useAppStore.getState>,
  'speedLimit' | 'slowMode' | 'slowModeSpeed' | 'downloadsAtOnce' | 'networkPreferences'
>

/** All downloads as a fresh install has them. */
const GENERAL_DEFAULTS = {
  speedLimit: undefined,
  slowMode: false,
  slowModeSpeed: DEFAULT_SLOW_MODE_SPEED,
  downloadsAtOnce: DOWNLOADS_AT_ONCE.default
} satisfies Partial<Draft>

const sectionClass = 'flex flex-col gap-2.5 border-t-[0.5px] border-border py-3'
const headingClass = 'font-sans text-[14px] leading-none font-semibold'
const hintClass = 'text-[12.5px] leading-snug text-[var(--text-secondary)]'
const navLabelClass =
  'px-2.5 pt-3 pb-1.5 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase rtl:tracking-normal'

const periodName = (period: DataLimitPeriod): string =>
  period === 'day' ? t('Day') : period === 'week' ? t('Week') : t('Month')
/** "today", "this week", "this month". */
const usagePeriod = (period: DataLimitPeriod): string =>
  period === 'day' ? t('today') : period === 'week' ? t('this week') : t('this month')

/** No limit, or an editable limit. Turning it off retains the last value while open. */
function LimitChoice({
  label,
  value,
  fallback,
  unit,
  onChange,
  children
}: {
  children?: React.ReactNode
  label: string
  value: number | undefined
  fallback: number
  unit: string
  onChange: (bytes: number | undefined) => void
}): React.JSX.Element {
  const name = useId()
  const [lastValue, setLastValue] = useState(value ?? fallback)
  const enabled = value !== undefined
  const changeValue = (bytes: number): void => {
    setLastValue(bytes)
    onChange(bytes)
  }
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-2">
      <label className="flex w-fit items-center gap-2.5 text-[13px]">
        <input
          type="radio"
          name={name}
          checked={!enabled}
          onChange={() => {
            if (value !== undefined) setLastValue(value)
            onChange(undefined)
          }}
          className="size-4 accent-[var(--color-accent)]"
        />
        {t('No limit')}
      </label>
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex items-center gap-2.5 text-[13px]">
          <input
            type="radio"
            name={name}
            checked={enabled}
            onChange={() => onChange(lastValue)}
            className="size-4 accent-[var(--color-accent)]"
          />
          {t('Limit to')}
        </label>
        {unit === 'MB/s' ? (
          <SpeedInput
            key={enabled ? 'on' : 'off'}
            bytes={value ?? lastValue}
            label={label}
            disabled={!enabled}
            onChange={changeValue}
          />
        ) : (
          <UnitField
            key={enabled ? 'on' : 'off'}
            bytes={value ?? lastValue}
            label={label}
            units={DATA_UNITS}
            disabled={!enabled}
            onChange={changeValue}
          />
        )}
        {children}
      </div>
    </div>
  )
}

function GeneralPage({
  running,
  draft,
  change
}: {
  running: number
  draft: Draft
  change: (patch: Partial<Draft>) => void
}): React.JSX.Element {
  const { speedLimit, slowMode, slowModeSpeed, downloadsAtOnce } = draft
  const [confirmReset, setConfirmReset] = useState(false)
  const atDefaults = Object.entries(GENERAL_DEFAULTS).every(
    ([key, value]) => draft[key as keyof typeof GENERAL_DEFAULTS] === value
  )

  return (
    <>
      <div className="flex flex-col gap-1 pb-3">
        <h3 className="font-sans text-[18px] leading-none font-semibold">{t('All downloads')}</h3>
        <div className="font-mono text-[12px] text-muted-foreground">
          {running === 0
            ? t('No active downloads')
            : tn(running, '{count} downloading right now', '{count} downloading right now')}
        </div>
      </div>

      <section className={sectionClass}>
        <h4 className={headingClass}>{t('Total speed')}</h4>
        <p className={hintClass}>{t('Limits the combined download speed across all networks.')}</p>
        <LimitChoice
          label={t('Total speed')}
          value={speedLimit}
          fallback={20 * MB}
          unit="MB/s"
          onChange={(speedLimit) => change({ speedLimit })}
        />
      </section>

      <section className={sectionClass}>
        <h4 className={headingClass}>{t('Slow mode')}</h4>
        <p className={hintClass}>
          {t(
            'Replaces the total speed limit while enabled. Useful during calls or streaming. Also editable from the status bar.'
          )}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <SpeedInput
            bytes={slowModeSpeed}
            label={t('Slow mode speed')}
            onChange={(slowModeSpeed) => change({ slowModeSpeed })}
          />
          <label className="ms-auto flex items-center gap-2 text-[13px]">
            {t('Enabled')}
            <Switch checked={slowMode} onCheckedChange={(slowMode) => change({ slowMode })} />
          </label>
        </div>
      </section>

      <VpnSection />

      <section className={sectionClass}>
        <h4 className={headingClass}>{t('Downloads at once')}</h4>
        <p className={hintClass}>
          {t('Other downloads wait in the queue and start automatically.')}
        </p>
        <div className="flex items-center gap-3 text-[13.5px]">
          <div className="flex items-center rounded-lg border border-input">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('Decrease simultaneous downloads')}
              disabled={downloadsAtOnce <= DOWNLOADS_AT_ONCE.min}
              onClick={() => change({ downloadsAtOnce: downloadsAtOnce - 1 })}
            >
              <Minus />
            </Button>
            <output
              aria-label={t('Downloads at once')}
              className="w-8 text-center font-mono tabular-nums"
            >
              {downloadsAtOnce}
            </output>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('Increase simultaneous downloads')}
              disabled={downloadsAtOnce >= DOWNLOADS_AT_ONCE.max}
              onClick={() => change({ downloadsAtOnce: downloadsAtOnce + 1 })}
            >
              <Plus />
            </Button>
          </div>
          {t('at the same time')}
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-2 border-t-[0.5px] border-border pt-3">
        <Button
          variant="secondary"
          size="sm"
          disabled={atDefaults}
          onClick={() => setConfirmReset(true)}
        >
          {t('Reset to defaults…')}
        </Button>
      </div>
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Reset all downloads to defaults?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'This resets total speed, slow mode and downloads at once. Network limits stay unchanged.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => change(GENERAL_DEFAULTS)}>
              {t('Reset to defaults')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function NetworkPage({
  id,
  name,
  used,
  onUsageReset,
  preference,
  change
}: {
  id: string
  name: string
  used: number
  onUsageReset: () => void
  preference: NetworkPreference | undefined
  change: (patch: NetworkPreference) => void
}): React.JSX.Element {
  const dataLimit = preference?.dataLimit
  const period = preference?.dataLimitPeriod ?? 'month'
  const [reset, setReset] = useState<'usage' | 'limits' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmReset = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (reset === 'usage') {
        await window.lightning.resetNetworkUsage(id)
        onUsageReset()
      } else change({ speedLimit: undefined, dataLimit: undefined })
      setReset(null)
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setBusy(false)
    }
  }
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <>
      <div className="flex flex-col gap-1 pb-3">
        <h3 className="font-sans text-[18px] leading-none font-semibold">{name}</h3>
        <div className="font-mono text-[12px] text-muted-foreground">
          {t('{size} used by Lightning {period}', {
            size: formatBytes(used),
            period: usagePeriod(period)
          })}
        </div>
      </div>

      <section className={sectionClass}>
        <h4 className={headingClass}>{t('Speed')}</h4>
        <p className={hintClass}>{t('Limits the combined download speed on {name}.', { name })}</p>
        <LimitChoice
          label={t('{name} speed', { name })}
          value={preference?.speedLimit}
          fallback={10 * MB}
          unit="MB/s"
          onChange={(speedLimit) => change({ speedLimit })}
        />
      </section>

      <section className={sectionClass}>
        <h4 className={headingClass}>{t('Data limit')}</h4>
        <p className={hintClass}>
          {t('Stops downloads on {name} at the limit. Uploads and other apps don’t count.', {
            name
          })}
        </p>
        <LimitChoice
          label={t('{name} data limit', { name })}
          value={dataLimit}
          fallback={5 * GB}
          unit="GB"
          onChange={(limit) => change({ dataLimit: limit })}
        >
          <span className="text-[12px] text-muted-foreground">{t('per')}</span>
          <ToggleGroup
            aria-label={t('{name} data limit period', { name })}
            value={[period]}
            disabled={dataLimit === undefined}
            onValueChange={(values) => {
              const next = values[0]
              if (next === 'day' || next === 'week' || next === 'month') {
                change({ dataLimitPeriod: next })
              }
            }}
            size="sm"
            spacing={0.5}
            className="bg-secondary p-0.5"
          >
            {DATA_LIMIT_PERIODS.map((entry) => (
              <ToggleGroupItem key={entry.value} value={entry.value}>
                {periodName(entry.value)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </LimitChoice>
        {dataLimit !== undefined && (
          <>
            <UsageBar used={used} limit={dataLimit} period={period} />
            <p className="text-[11.5px] text-muted-foreground">
              {period === 'day'
                ? t(
                    'Resets tomorrow at midnight. Raise the limit or reset data usage to keep using this network sooner.'
                  )
                : period === 'week'
                  ? t(
                      'Resets on {date}. Weeks start Monday. Raise the limit or reset data usage to keep using this network sooner.',
                      {
                        date: formatDate(nextDataReset(period, now), {
                          day: 'numeric',
                          month: 'long'
                        })
                      }
                    )
                  : t(
                      'Resets on {date}. Raise the limit or reset data usage to keep using this network sooner.',
                      {
                        date: formatDate(nextDataReset(period, now), {
                          day: 'numeric',
                          month: 'long'
                        })
                      }
                    )}
            </p>
          </>
        )}
      </section>
      <div className="flex flex-wrap items-center gap-2 border-t-[0.5px] border-border pt-3">
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || used === 0}
          onClick={() => setReset('usage')}
        >
          {t('Reset data usage…')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || (preference?.speedLimit === undefined && dataLimit === undefined)}
          onClick={() => setReset('limits')}
        >
          {t('Remove limits…')}
        </Button>
      </div>
      <AlertDialog open={reset !== null} onOpenChange={(open) => !open && !busy && setReset(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {reset === 'usage'
                ? t('Reset data usage for {name}?', { name })
                : t('Remove limits for {name}?', { name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {reset === 'usage'
                ? t(
                    'This resets {name}’s usage {period} to zero. Its configured limits and usage for other periods stay unchanged. Downloads can use this network again if its data limit was reached.',
                    { name, period: usagePeriod(period) }
                  )
                : t(
                    'This removes {name}’s speed and data limits. Its recorded data usage stays unchanged. The total speed limit and slow mode still apply.',
                    { name }
                  )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void confirmReset()
              }}
            >
              {reset === 'usage' ? t('Reset data usage') : t('Remove limits')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** "5.00 of 5 GB this month", with a bar that turns red once the limit is reached. */
export function UsageBar({
  used,
  limit,
  period = 'month'
}: {
  used: number
  limit: number
  period?: DataLimitPeriod
}): React.JSX.Element {
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
        {t('{used} of {limit} {period}', {
          used: formatBytes(used),
          limit: formatBytes(limit),
          period: usagePeriod(period)
        })}
      </div>
    </div>
  )
}

/** One line under a network's name: its limits, or that it has reached one. */
function describeLimits(preference: NetworkPreference | undefined, used: number): string {
  if (preference?.dataLimit !== undefined && used >= preference.dataLimit) {
    return t('Data limit reached')
  }
  const parts = [
    preference?.speedLimit !== undefined && formatSpeed(preference.speedLimit),
    preference?.dataLimit !== undefined &&
      t('{size} per {period}', {
        size: formatBytes(preference.dataLimit),
        period: periodName(preference.dataLimitPeriod ?? 'month').toLowerCase()
      })
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : t('No limit')
}

/** Speed & data limits: every download's together, and each network's. Nothing changes until
 * Save; Cancel (or Escape) leaves everything as it was. Resetting data usage is the exception:
 * it's an action, not a setting, so it happens once confirmed. */
export function LimitsDialog({
  open,
  onOpenChange,
  page,
  onPageChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The network shown, by interface id; null for General. */
  page: string | null
  onPageChange: (page: string | null) => void
}): React.JSX.Element {
  return (
    <Dialog open={open} disablePointerDismissal onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(520px,calc(100%-2rem))] max-w-[680px] flex-col gap-0 p-0 sm:max-w-[680px]">
        {/* Mounted only while open, so each opening starts a fresh draft. */}
        <LimitsEditor page={page} onPageChange={onPageChange} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function LimitsEditor({
  page,
  onPageChange,
  onClose
}: {
  page: string | null
  onPageChange: (page: string | null) => void
  onClose: () => void
}): React.JSX.Element {
  const interfaces = useAppStore((store) => store.interfaces)
  const [draft, setDraft] = useState<Draft>(() => {
    const { speedLimit, slowMode, slowModeSpeed, downloadsAtOnce, networkPreferences } =
      useAppStore.getState()
    return { speedLimit, slowMode, slowModeSpeed, downloadsAtOnce, networkPreferences }
  })
  const change = (patch: Partial<Draft>): void =>
    setDraft((previous) => ({ ...previous, ...patch }))
  // The speed and data fields holding something that isn't a number above 0 hold Save too.
  const [invalidFields, setInvalidFields] = useState<ReadonlySet<string>>(new Set())
  const reportInvalid = useCallback((key: string, invalid: boolean): void => {
    setInvalidFields((previous) => {
      if (previous.has(key) === invalid) return previous
      const next = new Set(previous)
      if (invalid) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])
  const changeNetwork = (id: string, patch: NetworkPreference): void =>
    setDraft((previous) => ({
      ...previous,
      networkPreferences: {
        ...previous.networkPreferences,
        [id]: { ...previous.networkPreferences[id], ...patch }
      }
    }))
  // Only what changed is written, so a running download isn't re-limited for nothing.
  const save = (): void => {
    const store = useAppStore.getState()
    if (draft.speedLimit !== store.speedLimit) store.setSpeedLimit(draft.speedLimit)
    if (draft.slowMode !== store.slowMode) store.setSlowMode(draft.slowMode)
    if (draft.slowModeSpeed !== store.slowModeSpeed) store.setSlowModeSpeed(draft.slowModeSpeed)
    if (draft.downloadsAtOnce !== store.downloadsAtOnce) {
      store.setDownloadsAtOnce(draft.downloadsAtOnce)
    }
    for (const [id, preference] of Object.entries(draft.networkPreferences)) {
      if (preference !== store.networkPreferences[id]) store.setNetworkPreference(id, preference)
    }
    onClose()
  }
  const { speedLimit, slowMode, networkPreferences: preferences } = draft
  const running = useAppStore(
    (store) =>
      Object.values(store.downloads).filter((download) => download.status === 'downloading').length
  )
  const networkVisual = useNetworkVisuals()
  const [usageRevision, setUsageRevision] = useState(0)
  const usage = useNetworkUsage(true, usageRevision)
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
      onClick={() => onPageChange(key)}
      className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-start outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-primary/10"
    >
      <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: dot }} />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-[13.5px] font-medium">{name}</span>
        <span
          dir="auto"
          className={`font-mono text-[11px] ${warn ? 'text-[var(--color-usb)]' : 'text-muted-foreground'}`}
        >
          {detail}
        </span>
      </span>
    </button>
  )

  return (
    <FieldValidityContext.Provider value={reportInvalid}>
      <div className="flex items-center border-b-[0.5px] border-border px-4 py-3">
        <DialogTitle className="text-[16px] font-semibold">{t('Speed & data limits')}</DialogTitle>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[190px] shrink-0 flex-col gap-0.5 overflow-y-auto border-e-[0.5px] border-border p-2">
          <div className={navLabelClass}>{t('General')}</div>
          {navItem(
            null,
            'var(--text-secondary)',
            t('All downloads'),
            slowMode ? t('Slow mode on') : speedLimit ? formatSpeed(speedLimit) : t('No limit')
          )}
          <div className={navLabelClass}>{t('Networks')}</div>
          {interfaces.map((iface) => {
            const visual = networkVisual(iface.id, iface.kind, iface.displayName)
            const detail = describeLimits(preferences[iface.id], usage[iface.id] ?? 0)
            return navItem(
              iface.id,
              visual.solid,
              visual.name,
              detail,
              detail === t('Data limit reached')
            )
          })}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {shown ? (
            <NetworkPage
              key={shown.id}
              id={shown.id}
              name={networkVisual(shown.id, shown.kind, shown.displayName).name}
              used={usage[shown.id] ?? 0}
              onUsageReset={() => setUsageRevision((value) => value + 1)}
              preference={preferences[shown.id]}
              change={(patch) => changeNetwork(shown.id, patch)}
            />
          ) : (
            <GeneralPage running={running} draft={draft} change={change} />
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t-[0.5px] border-border px-4 py-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('Cancel')}
        </Button>
        {invalidFields.size > 0 && (
          <span role="alert" className="me-auto text-[12px] text-[var(--color-danger)]">
            {t('Enter a number above 0 in the highlighted field, or choose No limit.')}
          </span>
        )}
        <Button type="button" onClick={save} disabled={invalidFields.size > 0}>
          {t('Save')}
        </Button>
      </div>
    </FieldValidityContext.Provider>
  )
}

/** Shown only while a VPN is detected. */
function VpnSection(): React.JSX.Element | null {
  const detected = useAppStore((store) => store.allInterfaces.some((iface) => iface.kind === 'vpn'))
  if (!detected) return null
  return (
    <section className={sectionClass}>
      <h4 className={headingClass}>VPN</h4>
      <div className="-mx-5">
        <VpnSwitch />
      </div>
    </section>
  )
}
