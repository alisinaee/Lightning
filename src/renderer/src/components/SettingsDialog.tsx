import { DEFAULT_STATUS_BAR, TRAY_BUTTONS_MAX, type TrayButton } from '@shared/types'
import { toDisplayPath } from '../utils/format'
import type { AccentId, AppPrefs, ResolvedPrefs, StatusBarPrefs } from '@shared/types'
import { BrowserPage } from './BrowserPage'
import { SchedulePage } from './SchedulePage'
import type { TdlStatus } from '@shared/telegram'
import { isProxyAddress } from '@shared/networks'
import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n/react'
import type { LanguageSetting } from '@shared/i18n'
import { describeVpn, useVpnLayer } from '../hooks/useConnections'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { applyGlass } from '../utils/syncSettings'
import { useAppStore } from '../store/useAppStore'
import { YoutubeOptionsPanel } from './youtube/YoutubeOptionsSheet'
import {
  Bell,
  CalendarBlank,
  CaretRight,
  Check,
  Clipboard,
  ChartBar,
  ClockCounterClockwise,
  Gear,
  Globe,
  Lightning,
  MagnifyingGlass,
  PaintBrush,
  Rows,
  SlidersHorizontal,
  WifiHigh,
  X,
  YoutubeLogo
} from '@phosphor-icons/react'
import { TelegramIcon } from './telegram/TelegramIcon'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import { HistorySettings } from './HistorySettings'
import { UsageSettings } from './UsageSettings'
import { ClipboardSettings } from './settings/ClipboardSettings'
import { searchSettings, type SettingEntry } from './settings/searchIndex'

const SCALES = [
  { value: '0.9', label: 'Small' },
  { value: '1', label: 'Medium' },
  { value: '1.15', label: 'Large' },
  { value: '1.3', label: 'Larger' }
]

const TRAY_BUTTON_LABELS: [TrayButton, string][] = [
  ['new-download', 'New download'],
  ['several-links', 'Several links'],
  ['pause-all', 'Pause all'],
  ['resume-all', 'Resume all'],
  ['show', 'Open Lightning'],
  ['settings', 'Settings'],
  ['vpn', 'VPN on/off'],
  ['slow-mode', 'Slow mode on/off'],
  ['open-folder', 'Open the downloads folder'],
  ['telegram', 'Open Telegram'],
  ['check-update', 'Check for updates'],
  ['logs', 'Show the logs']
]

const PAGES = [
  'General',
  'History',
  'Usage',
  'Appearance',
  'Network',
  'Notifications',
  'Power',
  'Schedule',
  'Browser',
  'Telegram',
  'YouTube',
  'Clipboard',
  'Interface',
  'Status bar'
] as const

const NAV: Record<(typeof PAGES)[number], { color: string; icon: React.ReactNode }> = {
  General: { color: '#8e8e93', icon: <Gear /> },
  History: { color: '#5856d6', icon: <ClockCounterClockwise /> },
  Usage: { color: '#34c759', icon: <ChartBar /> },
  Appearance: { color: '#af52de', icon: <PaintBrush /> },
  Network: { color: '#007aff', icon: <WifiHigh /> },
  Notifications: { color: '#ff3b30', icon: <Bell /> },
  Power: { color: '#ff9500', icon: <Lightning /> },
  Schedule: { color: '#ff2d55', icon: <CalendarBlank /> },
  Browser: { color: '#32ade6', icon: <Globe /> },
  Telegram: { color: '#229ed9', icon: <TelegramIcon /> },
  YouTube: { color: '#e53935', icon: <YoutubeLogo /> },
  Clipboard: { color: '#ff9f0a', icon: <Clipboard /> },
  Interface: { color: '#636366', icon: <SlidersHorizontal /> },
  'Status bar': { color: '#30b0c7', icon: <Rows /> }
}

export type SettingsPage = (typeof PAGES)[number]

const ACCENTS: { id: AccentId; label: string; color: string }[] = [
  { id: 'amber', label: 'Amber', color: '#d97706' },
  { id: 'blue', label: 'Blue', color: '#2563eb' },
  { id: 'teal', label: 'Teal', color: '#0f766e' },
  { id: 'green', label: 'Green', color: '#15803d' },
  { id: 'violet', label: 'Violet', color: '#6d28d9' },
  { id: 'rose', label: 'Rose', color: '#be123c' }
]

function applyScale(scale: number): void {
  window.lightning.setZoom(scale)
}

function applyAccent(accent: string): void {
  document.documentElement.dataset.accent = accent
}

function Row({
  checked,
  onChange,
  label,
  disabled = false
}: {
  checked: boolean
  onChange: (on: boolean) => void
  label: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label className={`ios-row ${disabled ? 'opacity-50' : ''}`} data-setting={label}>
      <span className="ios-label">{t(label)}</span>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={t(label)}
      />
    </label>
  )
}

function ProxyField({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  // What is typed stays here until Enter or leaving the field: applying a proxy on every
  // keystroke would try half-typed addresses. Only an address that is valid (or empty) is saved.
  const [draft, setDraft] = useState(value)
  const text = draft.trim()
  const invalid = text !== '' && !isProxyAddress(text)
  const commit = (): void => {
    if (invalid) return
    if (text !== value) onChange(text)
  }
  return (
    <label className="ios-row" data-setting={label}>
      <span className="ios-label">{label}</span>
      <input
        value={draft}
        dir="ltr"
        placeholder="host:port"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
        }}
        className="ios-input w-44 font-mono aria-invalid:ring-2 aria-invalid:ring-[var(--color-danger)]"
      />
      {invalid && (
        <span className="text-[11.5px] text-[var(--color-danger)]">{t('Not an address')}</span>
      )}
    </label>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}): React.JSX.Element {
  return (
    <label className="ios-row" data-setting={label}>
      <span className="ios-label">{t(label)}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const count = Math.floor(Number(event.target.value))
          if (count >= min && count <= max) onChange(count)
        }}
        className="ios-input w-16"
      />
    </label>
  )
}

// Language names are always shown in their own language.
const LANGUAGE_OPTIONS: [LanguageSetting, string | null, string][] = [
  ['system', 'System default', ''],
  ['en', null, 'English'],
  ['fa', null, 'فارسی'],
  ['ru', null, 'Русский']
]

/** Settings: version and updates, text size and theme, the proxy, notices, power, and how the
 * window closes. Saved as they change. It fills the Settings window. */
export function SettingsView({ initialPage }: { initialPage?: SettingsPage }): React.JSX.Element {
  const initial = window.lightning.initialState
  const [page, setPage] = useState<SettingsPage>(initialPage ?? 'General')
  // The store holds the prefs, so a change made from the side panel shows here too.
  const prefs = useAppStore((store) => store.prefsSnapshot)
  const setPrefs = useAppStore((store) => store.setPrefsSnapshot)
  const [schedule, setSchedule] = useState(initial.schedule)
  const theme = useAppStore((store) => store.themeSource)
  const setTheme = useAppStore((store) => store.setThemeSource)
  const downloadsAtOnce = useAppStore((store) => store.downloadsAtOnce)
  const setDownloadsAtOnce = useAppStore((store) => store.setDownloadsAtOnce)
  const checkForUpdateNow = useAppStore((store) => store.checkForUpdateNow)
  const availableUpdate = useAppStore((store) => store.availableUpdate)
  const setTitleBarButtons = useAppStore((store) => store.setTitleBarButtons)
  const setStatusBar = useAppStore((store) => store.setStatusBar)
  const destinationDir = useAppStore((store) => store.destinationDir)
  const setDestinationDir = useAppStore((store) => store.setDestinationDir)
  const homeDir = useAppStore((store) => store.homeDir)
  const [telegramDir, setTelegramDir] = useState(
    initial.telegramDir ??
      `${initial.downloadsDir}${window.lightning.platform === 'win32' ? '\\' : '/'}Lightning Telegram`
  )
  const [tdl, setTdl] = useState<TdlStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<'available' | 'current' | 'failed' | null>(null)

  useEffect(() => {
    if (page !== 'Telegram') return
    void window.lightning.tdlStatus().then(setTdl, () => setTdl(null))
  }, [page])

  const save = (patch: Partial<AppPrefs>): void => {
    const next: ResolvedPrefs = {
      ...prefs,
      ...patch,
      statusBar: { ...prefs.statusBar, ...patch.statusBar }
    }
    setPrefs(next)
    if (patch.uiScale !== undefined) applyScale(patch.uiScale)
    if (patch.accent !== undefined) applyAccent(patch.accent)
    if (patch.glassTransparency !== undefined) applyGlass(patch.glassTransparency)
    if (patch.showLogs !== undefined || patch.showDebug !== undefined) {
      setTitleBarButtons({ showLogs: next.showLogs, showDebug: next.showDebug })
    }
    if (patch.statusBar !== undefined) setStatusBar(next.statusBar)
    void window.lightning.updateSettings({ prefs: next })
  }

  // Search: typing replaces the page list with matching settings; picking one opens its page and
  // scrolls to its row (found by data-setting, or by its text for rows without one).
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<SettingEntry | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const results = searchSettings(query)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!target || target.page !== page) return
    let tries = 0
    let timer: ReturnType<typeof setTimeout>
    const find = (): void => {
      const root = contentRef.current
      const wanted = target.label.trim().toLowerCase()
      const wantedLocal = t(target.label).trim().toLowerCase()
      const nodes = Array.from(
        root?.querySelectorAll<HTMLElement>('[data-setting], .ios-title, .ios-row') ?? []
      )
      const found =
        nodes.find((node) => node.dataset.setting === target.label) ??
        nodes.find((node) => {
          const text = node.textContent?.trim().toLowerCase() ?? ''
          return text.startsWith(wanted) || text.startsWith(wantedLocal)
        })
      if (!found) {
        // Pages with parts that load later get a few more looks.
        if (++tries < 10) timer = setTimeout(find, 100)
        else setTarget(null)
        return
      }
      found.scrollIntoView({ block: 'center', behavior: 'smooth' })
      found.animate(
        [
          { backgroundColor: 'color-mix(in srgb, var(--color-primary, #007aff) 35%, transparent)' },
          { backgroundColor: 'transparent' }
        ],
        { duration: 1600, easing: 'ease-out' }
      )
      setTarget(null)
    }
    timer = setTimeout(find, 30)
    return () => clearTimeout(timer)
  }, [target, page])

  const openResult = (entry: SettingEntry): void => {
    setPage(entry.page as SettingsPage)
    setTarget(entry)
    setQuery('')
  }

  const bar = prefs.statusBar
  const setBar = (patch: Partial<StatusBarPrefs>): void => save({ statusBar: patch })

  // Asked again for another page while open: go there.
  useEffect(
    () =>
      window.lightning.onAppCommand((command, argument) => {
        if (command === 'settings-page' && PAGES.some((entry) => entry === argument)) {
          setPage(argument as SettingsPage)
        }
      }),
    []
  )

  return (
    <div className="settings-ios flex h-screen w-screen bg-background text-foreground">
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-48 shrink-0 flex-col gap-0.5 overflow-y-auto p-3 pt-4">
          <h1 className="px-2 pb-3 text-[20px] font-semibold tracking-tight">{t('Settings')}</h1>
          <div className="relative mb-2">
            <MagnifyingGlass className="pointer-events-none absolute top-1/2 start-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              placeholder={t('Search')}
              aria-label={t('Search settings')}
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setQuery('')
                  event.currentTarget.blur()
                } else if (event.key === 'Enter' && results[0]) openResult(results[0])
              }}
              className="h-7 w-full rounded-lg bg-black/5 pe-6 ps-7 text-[13px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/40 dark:bg-white/10"
            />
            {query && (
              <button
                type="button"
                aria-label={t('Clear search')}
                onClick={() => {
                  setQuery('')
                  searchRef.current?.focus()
                }}
                className="absolute top-1/2 end-1.5 -translate-y-1/2 text-muted-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {query.trim() !== '' &&
            (results.length === 0 ? (
              <div className="px-2 py-3 text-[13px] text-muted-foreground">
                {t('No settings match')}
              </div>
            ) : (
              results.map((entry) => (
                <button
                  key={`${entry.page}/${entry.label}`}
                  type="button"
                  onClick={() => openResult(entry)}
                  className="ios-nav !h-auto min-w-0 flex-col !items-start !gap-0 py-1.5 !text-start"
                >
                  <span className="line-clamp-2 w-full text-[13px] break-words">
                    {t(entry.label)}
                  </span>
                  <span className="w-full truncate text-[11px] text-muted-foreground">
                    {t(entry.page)}
                  </span>
                </button>
              ))
            ))}
          {query.trim() === '' &&
            PAGES.map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setPage(entry)}
                aria-current={page === entry ? 'page' : undefined}
                className="ios-nav min-w-0"
                title={t(entry)}
              >
                <span className="ios-tile [&>svg]:size-[18px]" style={{ color: NAV[entry].color }}>
                  {NAV[entry].icon}
                </span>
                <span className="min-w-0 flex-1 truncate !text-start">{t(entry)}</span>
              </button>
            ))}
        </nav>
        <div
          ref={contentRef}
          className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-5 text-[14px]"
        >
          <div className="mb-1 text-[22px] font-semibold tracking-tight">{t(page)}</div>
          {page === 'General' && (
            <>
              <label className="ios-row" data-setting="Language">
                <span className="ios-label">{t('Language')}</span>
                <select
                  value={prefs.language ?? 'system'}
                  aria-label={t('Language')}
                  onChange={(event) => save({ language: event.target.value as LanguageSetting })}
                  className="ios-input w-40"
                >
                  {LANGUAGE_OPTIONS.map(([value, key, own]) => (
                    <option key={value} value={value}>
                      {key ? t(key) : own}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="ios-row text-start"
                onClick={() => setPage('Telegram')}
              >
                <span className="ios-label">{t('Telegram settings')}</span>
                <CaretRight className="size-4 text-muted-foreground rtl:-scale-x-100" />
              </button>
              <button
                type="button"
                className="ios-row text-start"
                onClick={() => setPage('YouTube')}
              >
                <span className="ios-label">{t('YouTube options')}</span>
                <CaretRight className="size-4 text-muted-foreground rtl:-scale-x-100" />
              </button>
              <div className="ios-title">{t('About')}</div>
              <div className="ios-row">
                <span className="ios-label">
                  {t('Lightning {version}', { version: initial.version })}
                  <span className="ios-hint">
                    {t('Updates come from the Lightning releases on GitHub.')}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="rounded-full"
                  disabled={checking}
                  onClick={() => {
                    setChecking(true)
                    setCheckResult(null)
                    void checkForUpdateNow()
                      .then(setCheckResult)
                      .finally(() => setChecking(false))
                  }}
                >
                  {checking ? t('Checking…') : t('Check for updates')}
                </Button>
              </div>
              {checkResult && (
                <div className="ios-note" role="status">
                  {checkResult === 'current' &&
                    t('You have the latest version ({version}).', { version: initial.version })}
                  {checkResult === 'failed' && (
                    <span className="text-destructive">
                      {t('Couldn’t reach GitHub. Check your connection and try again.')}
                    </span>
                  )}
                  {checkResult === 'available' && availableUpdate && (
                    <span>
                      {t('Lightning {version} is available.', {
                        version: availableUpdate.version
                      })}{' '}
                      <a
                        href={availableUpdate.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-primary underline underline-offset-2"
                      >
                        {t('Download it')}
                      </a>
                    </span>
                  )}
                </div>
              )}
              <div className="ios-title">{t('Downloads')}</div>
              <NumberField
                label="Files at once"
                value={downloadsAtOnce}
                min={1}
                max={8}
                onChange={setDownloadsAtOnce}
              />
              <div className="ios-row">
                <span className="ios-label">{t('Default folder')}</span>
                <input
                  readOnly
                  dir="ltr"
                  aria-label={t('Default download folder')}
                  value={toDisplayPath(destinationDir, homeDir)}
                  title={destinationDir}
                  className="ios-input w-44 font-mono"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="rounded-full"
                  onClick={() =>
                    void window.lightning.chooseDestinationFolder(destinationDir).then((picked) => {
                      if (picked) setDestinationDir(picked)
                    })
                  }
                >
                  {t('Change…')}
                </Button>
              </div>
              <Row
                checked={prefs.removeMissingFiles}
                onChange={(removeMissingFiles) => save({ removeMissingFiles })}
                label="Remove a finished download from the list when its file is deleted or moved"
              />
              <Row
                checked={prefs.warnDuplicates}
                onChange={(warnDuplicates) => save({ warnDuplicates })}
                label="Warn before downloading something I already have"
              />
            </>
          )}
          {page === 'History' && (
            <HistorySettings
              historyLimit={prefs.historyLimit}
              onHistoryLimitChange={(historyLimit) => save({ historyLimit })}
            />
          )}
          {page === 'Usage' && <UsageSettings />}
          {page === 'Appearance' && (
            <>
              <div className="ios-title">{t('Text size')}</div>
              <div className="ios-row">
                <span className="ios-seg ms-auto w-full">
                  {SCALES.map((scale) => (
                    <button
                      key={scale.value}
                      type="button"
                      aria-pressed={String(prefs.uiScale) === scale.value}
                      onClick={() => save({ uiScale: Number(scale.value) })}
                      className="flex-1"
                    >
                      {t(scale.label)}
                    </button>
                  ))}
                </span>
              </div>
              <div className="ios-title">{t('Theme')}</div>
              <div className="ios-row">
                <span className="ios-seg w-full">
                  {(['dark', 'light'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={theme === mode}
                      onClick={() => setTheme(mode)}
                      className="flex-1"
                    >
                      {mode === 'dark' ? t('Dark') : t('Light')}
                    </button>
                  ))}
                </span>
              </div>
              {window.lightning.platform === 'darwin' && (
                <>
                  <div className="ios-title">{t('Window glass')}</div>
                  <div className="ios-row">
                    <span className="ios-label">{t('Transparency')}</span>
                    <input
                      type="range"
                      min={0}
                      max={90}
                      step={2}
                      aria-label={t('Transparency')}
                      value={prefs.glassTransparency}
                      onChange={(event) => save({ glassTransparency: Number(event.target.value) })}
                      className="w-40 accent-[var(--color-accent)]"
                    />
                    <span
                      dir="ltr"
                      className="w-9 text-end text-[12px] text-muted-foreground tabular-nums"
                    >
                      {prefs.glassTransparency}%
                    </span>
                  </div>
                  <div className="ios-row">
                    <span className="ios-label">{t('Blur')}</span>
                    <span className="ios-seg">
                      {(
                        [
                          ['off', 'Off'],
                          ['standard', 'Standard'],
                          ['strong', 'Strong']
                        ] as const
                      ).map(([level, text]) => (
                        <button
                          key={level}
                          type="button"
                          aria-pressed={prefs.glassBlur === level}
                          onClick={() => save({ glassBlur: level })}
                        >
                          {t(text)}
                        </button>
                      ))}
                    </span>
                  </div>
                </>
              )}
              <div className="ios-title">{t('Color')}</div>
              <div
                className="ios-row gap-2 !py-3"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}
              >
                {ACCENTS.map((accent) => {
                  const chosen = prefs.accent === accent.id
                  return (
                    <button
                      key={accent.id}
                      type="button"
                      aria-label={t(accent.label)}
                      aria-pressed={chosen}
                      onClick={() => save({ accent: accent.id })}
                      // The look of the app's own buttons, filled with the colour it would take.
                      className="flex h-9 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium text-white outline-none transition-transform active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
                      style={{
                        background: accent.color,
                        boxShadow: chosen
                          ? `0 0 0 2px var(--ios-card), 0 0 0 4px ${accent.color}`
                          : 'none'
                      }}
                    >
                      {chosen && <Check weight="bold" className="size-3.5" />}
                      {t(accent.label)}
                    </button>
                  )
                })}
              </div>
            </>
          )}
          {page === 'Network' && (
            <>
              <VpnSetting />
              <button
                type="button"
                className="ios-row text-start"
                onClick={() => {
                  void window.lightning.runMainCommand('limits')
                }}
              >
                <span className="ios-label">{t('Speed and data limits')}</span>
                <CaretRight className="size-4 text-muted-foreground rtl:-scale-x-100" />
              </button>
              <div className="ios-title">{t('Proxy')}</div>
              <div className="ios-note">
                {t(
                  'For the app’s own requests, such as checking for updates. Downloads connect through the networks you chose and don’t use it.'
                )}
              </div>
              {(
                [
                  ['system', 'System proxy'],
                  ['direct', 'No proxy'],
                  ['manual', 'Configure manually']
                ] as const
              ).map(([mode, label]) => (
                <label key={mode} className="ios-row cursor-pointer">
                  <input
                    type="radio"
                    name="proxy"
                    className="sr-only"
                    checked={prefs.proxyMode === mode}
                    onChange={() => save({ proxyMode: mode })}
                  />
                  <span className="ios-label">{t(label)}</span>
                  {prefs.proxyMode === mode && (
                    <Check weight="bold" className="size-4 text-primary" />
                  )}
                </label>
              ))}
              {prefs.proxyMode === 'manual' && (
                <div className="flex flex-col gap-3">
                  <ProxyField
                    label="HTTP"
                    value={prefs.proxyHttp}
                    onChange={(proxyHttp) => save({ proxyHttp })}
                  />
                  <ProxyField
                    label="HTTPS"
                    value={prefs.proxyHttps}
                    onChange={(proxyHttps) => save({ proxyHttps })}
                  />
                  <ProxyField
                    label="FTP"
                    value={prefs.proxyFtp}
                    onChange={(proxyFtp) => save({ proxyFtp })}
                  />
                  <ProxyField
                    label="SOCKS5"
                    value={prefs.proxySocks}
                    onChange={(proxySocks) => save({ proxySocks })}
                  />
                </div>
              )}
              <div className="ios-title">{t('Advanced')}</div>
              <label className="ios-row" data-setting="Stall timeout (seconds)">
                <span className="ios-label">{t('Stall timeout (seconds)')}</span>
                <input
                  type="number"
                  min={5}
                  max={120}
                  step={1}
                  value={prefs.stallTimeoutSec}
                  onChange={(event) => {
                    const seconds = Math.floor(Number(event.target.value))
                    if (seconds >= 5 && seconds <= 120) save({ stallTimeoutSec: seconds })
                  }}
                  className="ios-input w-16"
                />
              </label>
              <div className="ios-note">
                {t('How long a connection may go without data before it is retried.')}
              </div>
            </>
          )}
          {page === 'Notifications' && (
            <>
              <Row
                checked={prefs.notifyAdded}
                onChange={(notifyAdded) => save({ notifyAdded })}
                label="Notify me when a download is added"
              />
              <Row
                checked={prefs.notifyCompleted}
                onChange={(notifyCompleted) => save({ notifyCompleted })}
                label="Notify me when a download finishes"
              />
              <Row
                checked={prefs.notifyFailed}
                onChange={(notifyFailed) => save({ notifyFailed })}
                label="Notify me when a download fails"
              />
              <Row
                checked={prefs.notifyWhenInactive}
                onChange={(notifyWhenInactive) => save({ notifyWhenInactive })}
                label="Only when Lightning is in the background"
              />
            </>
          )}
          {page === 'Power' && (
            <>
              <Row
                checked={prefs.preventSleep}
                onChange={(preventSleep) => save({ preventSleep })}
                label="Keep the computer awake while a download is running"
              />
              <Row
                checked={prefs.askWhenFinished}
                onChange={(askWhenFinished) => save({ askWhenFinished })}
                label="When all downloads finish, ask what to do (quit, sleep or shut down)"
              />
            </>
          )}
          {page === 'Schedule' && (
            <SchedulePage
              value={schedule}
              onChange={(next) => {
                setSchedule(next)
                void window.lightning.updateSettings({ schedule: next })
              }}
            />
          )}
          {page === 'Browser' && (
            <BrowserPage
              enabled={prefs.browserIntegration}
              onEnabledChange={(browserIntegration) => save({ browserIntegration })}
              features={{
                capture: prefs.browserCapture,
                menuDownload: prefs.browserMenuDownload,
                menuScan: prefs.browserMenuScan
              }}
              onFeatureChange={(patch) => save(patch)}
            />
          )}
          {page === 'YouTube' && (
            <>
              <div className="ios-note !mx-0 !mt-0">{t('Used by every new YouTube download.')}</div>
              <YoutubeOptionsPanel settings />
            </>
          )}
          {page === 'Telegram' && (
            <>
              <div>
                <div className="text-[15px] font-semibold">Telegram</div>
                <div className="ios-note">
                  {tdl === null
                    ? t('Checking the account…')
                    : !tdl.binary
                      ? t('The Telegram downloader (tdl) is missing from this build.')
                      : tdl.loggedIn
                        ? tdl.account
                          ? t('Signed in as {account}.', { account: tdl.account })
                          : t('Signed in.')
                        : t('Not signed in. Sign in from the Telegram section.')}
                </div>
                {tdl?.loggedIn && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      if (
                        window.confirm(
                          t(
                            'Sign out of Telegram? The saved session is deleted from this computer.'
                          )
                        )
                      ) {
                        void window.lightning.tdlLogout().then(() => {
                          setTdl({ ...tdl, loggedIn: false, account: undefined })
                        })
                      }
                    }}
                  >
                    {t('Sign out')}
                  </Button>
                )}
              </div>
              <button
                type="button"
                className="ios-row text-start"
                data-setting="Telegram links in the clipboard"
                onClick={() => setPage('Clipboard')}
              >
                <span className="ios-label">
                  {t('Telegram links in the clipboard')}
                  <span className="ios-hint">
                    {prefs.clipboardTrack && prefs.telegramWatchClipboard
                      ? t('On: offered when copied.')
                      : t('Off. Change it in Clipboard settings.')}
                  </span>
                </span>
                <CaretRight className="size-4 text-muted-foreground rtl:-scale-x-100" />
              </button>
              <div className="ios-row">
                <span className="ios-label">{t('Telegram folder')}</span>
                <input
                  readOnly
                  dir="ltr"
                  aria-label={t('Telegram folder')}
                  value={toDisplayPath(telegramDir, homeDir)}
                  title={telegramDir}
                  className="ios-input w-44 font-mono"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="rounded-full"
                  onClick={() =>
                    void window.lightning.chooseDestinationFolder(telegramDir).then((picked) => {
                      if (!picked) return
                      setTelegramDir(picked)
                      void window.lightning.updateSettings({ telegramDir: picked })
                    })
                  }
                >
                  {t('Change…')}
                </Button>
              </div>
              <NumberField
                label="Connections per file"
                value={prefs.telegramThreads}
                min={1}
                max={16}
                onChange={(telegramThreads) => save({ telegramThreads })}
              />
              <NumberField
                label="Files at once"
                value={prefs.telegramParallel}
                min={1}
                max={8}
                onChange={(telegramParallel) => save({ telegramParallel })}
              />
              <div className="ios-note">
                {t('High numbers can make Telegram slow the account down (FLOOD_WAIT).')}
              </div>
              <Row
                checked={prefs.telegramSkipSame}
                onChange={(telegramSkipSame) => save({ telegramSkipSame })}
                label="Skip files already in the folder with the same name and size"
              />
              <Row
                checked={prefs.telegramSortByKind}
                onChange={(telegramSortByKind) => save({ telegramSortByKind })}
                label="Sort finished files into Videos, Photos, Audio, Documents and Other folders"
              />
              <Row
                checked={prefs.telegramGroupAlbums}
                onChange={(telegramGroupAlbums) => save({ telegramGroupAlbums })}
                label="Download an album's files together"
              />
              <Row
                checked={prefs.telegramTakeout}
                onChange={(telegramTakeout) => save({ telegramTakeout })}
                label="Use a takeout session (gentler limits for large exports)"
              />
              <Row
                checked={prefs.telegramUseProxy}
                onChange={(telegramUseProxy) => save({ telegramUseProxy })}
                label="Use the manual proxy from Network settings"
              />
              <label className="ios-row" data-setting="File name template">
                <span className="ios-label">{t('File name template')}</span>
                <input
                  defaultValue={prefs.telegramTemplate}
                  spellCheck={false}
                  onBlur={(event) => {
                    const telegramTemplate = event.target.value.trim()
                    if (telegramTemplate !== prefs.telegramTemplate) save({ telegramTemplate })
                  }}
                  className="ios-input w-44 text-start font-mono"
                  dir="ltr"
                  placeholder={t('tdl default')}
                />
              </label>
              <div className="ios-note">
                {t(
                  'Telegram downloads use the default connection, not Lightning’s networks, DNS or speed limits. Only the proxy is passed on.'
                )}
              </div>
            </>
          )}
          {page === 'Status bar' && (
            <>
              <div className="ios-note">
                {t(
                  'Choose what the bar along the bottom shows, and what the menu holds when you click its count and speed.'
                )}
              </div>
              <div className="ios-title">{t('In the bar')}</div>
              <Row
                checked={bar.showCount}
                onChange={(showCount) => setBar({ showCount })}
                label="How many downloads there are"
              />
              <Row
                checked={bar.showSpeed}
                onChange={(showSpeed) => setBar({ showSpeed })}
                label="The total speed"
              />
              <Row
                checked={bar.showLimit}
                onChange={(showLimit) => setBar({ showLimit })}
                label="The speed limit, when one is set"
              />
              <Row
                checked={bar.showWaiting}
                onChange={(showWaiting) => setBar({ showWaiting })}
                label="How many are waiting"
              />
              <Row
                checked={bar.showNetworks}
                onChange={(showNetworks) => setBar({ showNetworks })}
                label="The speed of each network"
              />
              <Row
                checked={bar.showSlowMode}
                onChange={(showSlowMode) => setBar({ showSlowMode })}
                label="Slow mode"
              />
              <Row
                checked={bar.showFree}
                onChange={(showFree) => setBar({ showFree })}
                label="Free disk space"
              />
              <div className="ios-title">{t('The menu')}</div>
              <Row
                checked={bar.menu}
                onChange={(menu) => setBar({ menu })}
                label="Open a menu of live details when the count and speed are clicked"
              />
              <fieldset disabled={!bar.menu} className={bar.menu ? '' : 'opacity-50'}>
                <Row
                  checked={bar.menuGraph}
                  onChange={(menuGraph) => setBar({ menuGraph })}
                  label="A graph of the speed over the last minute"
                  disabled={!bar.menu}
                />
                <Row
                  checked={bar.menuTotals}
                  onChange={(menuTotals) => setBar({ menuTotals })}
                  label="Totals: speed, received, left and time left"
                  disabled={!bar.menu}
                />
                <Row
                  checked={bar.menuNetworks}
                  onChange={(menuNetworks) => setBar({ menuNetworks })}
                  label="The speed of each network"
                  disabled={!bar.menu}
                />
                <Row
                  checked={bar.menuConnections}
                  onChange={(menuConnections) => setBar({ menuConnections })}
                  label="Connections on each network"
                  disabled={!bar.menu || !bar.menuNetworks}
                />
                <Row
                  checked={bar.menuDownloads}
                  onChange={(menuDownloads) => setBar({ menuDownloads })}
                  label="The downloads running now"
                  disabled={!bar.menu}
                />
                <Row
                  checked={bar.menuQueue}
                  onChange={(menuQueue) => setBar({ menuQueue })}
                  label="Waiting, paused and failed counts"
                  disabled={!bar.menu}
                />
                <Row
                  checked={bar.menuDisk}
                  onChange={(menuDisk) => setBar({ menuDisk })}
                  label="Free disk space and the folder"
                  disabled={!bar.menu}
                />
                <label className="ios-row">
                  <span className="ios-label">{t('Running downloads listed')}</span>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    aria-label={t('Running downloads listed')}
                    value={bar.menuRows}
                    disabled={!bar.menu || !bar.menuDownloads}
                    onChange={(event) => {
                      const rows = Math.round(Number(event.target.value))
                      if (rows >= 1 && rows <= 12) setBar({ menuRows: rows })
                    }}
                    className="ios-input w-16"
                  />
                </label>
              </fieldset>
              <div className="ios-title">{t('Menu bar icon')}</div>
              <div className="ios-note">
                {t('The menu you get from the Lightning icon at the top of the screen.')}
              </div>
              <Row
                checked={bar.trayPanel}
                onChange={(trayPanel) => setBar({ trayPanel })}
                label="Clicking the icon opens a panel with bars and colours, instead of a menu (right-click always gives the menu)"
              />
              <Row
                checked={bar.trayGraph}
                onChange={(trayGraph) => setBar({ trayGraph })}
                label="A speed graph in the panel"
                disabled={!bar.trayPanel}
              />
              <Row
                checked={bar.trayActions}
                onChange={(trayActions) => setBar({ trayActions })}
                label="Quick buttons in the panel: new download, pause all and the rest"
                disabled={!bar.trayPanel}
              />
              <Row
                checked={bar.trayTotals}
                onChange={(trayTotals) => setBar({ trayTotals })}
                label="How many are downloading and the total speed"
              />
              <Row
                checked={bar.trayNetworks}
                onChange={(trayNetworks) => setBar({ trayNetworks })}
                label="The speed and connections of each network"
              />
              <Row
                checked={bar.trayDownloads}
                onChange={(trayDownloads) => setBar({ trayDownloads })}
                label="The downloads running now (click one to open it)"
              />
              <Row
                checked={bar.trayQueue}
                onChange={(trayQueue) => setBar({ trayQueue })}
                label="Waiting, paused and failed counts"
              />
              <div className="ios-title">{t('Panel buttons')}</div>
              <div className="ios-note">
                {t('Up to {max}. You can also drag them into order from the panel (Edit).', {
                  max: TRAY_BUTTONS_MAX
                })}
              </div>
              {TRAY_BUTTON_LABELS.map(([id, label]) => {
                const chosen = bar.trayButtons.includes(id)
                return (
                  <Row
                    key={id}
                    checked={chosen}
                    onChange={(on) =>
                      setBar({
                        trayButtons: on
                          ? [...bar.trayButtons, id]
                          : bar.trayButtons.filter((entry) => entry !== id)
                      })
                    }
                    label={label}
                    disabled={
                      !bar.trayPanel ||
                      !bar.trayActions ||
                      (!chosen && bar.trayButtons.length >= TRAY_BUTTONS_MAX)
                    }
                  />
                )
              })}
              <Row
                checked={bar.trayText}
                onChange={(trayText) => setBar({ trayText })}
                label="The total speed as text beside the icon"
              />
              <div className="ios-row">
                <span className="ios-label">{t('Speed unit')}</span>
                <span className="ios-seg">
                  {(
                    [
                      ['auto', 'Auto'],
                      ['kb', 'KB/s'],
                      ['mb', 'MB/s']
                    ] as const
                  ).map(([unit, text]) => (
                    <button
                      key={unit}
                      type="button"
                      aria-pressed={bar.trayUnit === unit}
                      onClick={() => setBar({ trayUnit: unit })}
                    >
                      {t(text)}
                    </button>
                  ))}
                </span>
              </div>
              <label className="ios-row">
                <span className="ios-label">{t('Running downloads listed')}</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  aria-label={t('Menu bar downloads listed')}
                  value={bar.trayRows}
                  disabled={!bar.trayDownloads}
                  onChange={(event) => {
                    const rows = Math.round(Number(event.target.value))
                    if (rows >= 1 && rows <= 10) setBar({ trayRows: rows })
                  }}
                  className="ios-input w-16"
                />
              </label>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2 self-start"
                onClick={() => setBar(DEFAULT_STATUS_BAR)}
              >
                {t('Reset to the defaults')}
              </Button>
            </>
          )}
          {page === 'Clipboard' && <ClipboardSettings prefs={prefs} save={save} />}
          {page === 'Interface' && (
            <>
              <Row
                checked={prefs.closeToBackground}
                onChange={(closeToBackground) => save({ closeToBackground })}
                label="Closing the window keeps Lightning running in the background"
              />
              <Row
                checked={prefs.openAtLogin}
                onChange={(openAtLogin) => save({ openAtLogin })}
                label="Start Lightning when I sign in (hidden in the tray)"
              />
              <div className="ios-title">{t('Title bar')}</div>
              <Row
                checked={prefs.showLogs}
                onChange={(showLogs) => save({ showLogs })}
                label="Show the Logs button"
              />
              <Row
                checked={prefs.showDebug && initial.labEnabled}
                onChange={(showDebug) => save({ showDebug })}
                disabled={!initial.labEnabled}
                label={
                  initial.labEnabled
                    ? 'Show the Debug button (the Test lab)'
                    : 'Show the Debug button (only in development builds)'
                }
              />
              <div className="ios-title">{t('Downloads')}</div>
              <Row
                checked={!prefs.sidebarHidden}
                onChange={(show) => save({ sidebarHidden: !show })}
                label="Show the side panel"
              />
              <Row
                checked={prefs.progressLine}
                onChange={(progressLine) => save({ progressLine })}
                label="Show a progress line along the bottom of each row"
              />
              <Row
                checked={prefs.showSourceHost}
                onChange={(showSourceHost) => save({ showSourceHost })}
                label="Show the website under file names"
              />
              <div className="ios-title">{t('Help')}</div>
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void window.lightning.runMainCommand('tour')
                  }}
                >
                  {t('Show the quick tour again')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="ms-2"
                  onClick={() => {
                    void window.lightning.runMainCommand('intro')
                  }}
                >
                  {t('Play the intro again')}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function VpnSetting(): React.JSX.Element {
  const { detected, on, tunnels, setOn } = useVpnLayer()
  const visual = useNetworkVisuals()
  const names = tunnels.map((tunnel) => visual(tunnel.id, tunnel.kind, tunnel.displayName).name)
  return (
    <div className="ios-row">
      <div className="ios-label">
        <div>VPN</div>
        <div className="ios-hint">
          {detected ? describeVpn(on, names) : t('No VPN detected on this computer.')}
        </div>
      </div>
      <Switch
        aria-label={t('Use VPN for downloads')}
        checked={on}
        disabled={!detected}
        onCheckedChange={setOn}
      />
    </div>
  )
}
