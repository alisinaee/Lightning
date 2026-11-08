import { DEFAULT_STATUS_BAR, TRAY_BUTTONS_MAX, type TrayButton } from '@shared/types'
import { toDisplayPath } from '../utils/format'
import type { AccentId, AppPrefs, ResolvedPrefs, StatusBarPrefs } from '@shared/types'
import { BrowserPage } from './BrowserPage'
import { SchedulePage } from './SchedulePage'
import type { TdlStatus } from '@shared/telegram'
import { isProxyAddress } from '@shared/networks'
import { useEffect, useState } from 'react'
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
  ChartBar,
  ClockCounterClockwise,
  Gear,
  Globe,
  Lightning,
  PaintBrush,
  Rows,
  SlidersHorizontal,
  WifiHigh,
  YoutubeLogo
} from '@phosphor-icons/react'
import { TelegramIcon } from './telegram/TelegramIcon'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import { HistorySettings } from './HistorySettings'
import { UsageSettings } from './UsageSettings'

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
    <label className={`ios-row ${disabled ? 'opacity-50' : ''}`}>
      <span className="ios-label">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
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
    <label className="ios-row">
      <span className="ios-label">{label}</span>
      <input
        value={draft}
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
      {invalid && <span className="text-[11.5px] text-[var(--color-danger)]">Not an address</span>}
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
    <label className="ios-row">
      <span className="ios-label">{label}</span>
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
          <h1 className="px-2 pb-3 text-[20px] font-semibold tracking-tight">Settings</h1>
          {PAGES.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setPage(entry)}
              aria-current={page === entry ? 'page' : undefined}
              className="ios-nav"
            >
              <span className="ios-tile [&>svg]:size-[18px]" style={{ color: NAV[entry].color }}>
                {NAV[entry].icon}
              </span>
              {entry}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-5 text-[14px]">
          <div className="mb-1 text-[22px] font-semibold tracking-tight">{page}</div>
          {page === 'General' && (
            <>
              <button
                type="button"
                className="ios-row text-left"
                onClick={() => setPage('Telegram')}
              >
                <span className="ios-label">Telegram settings</span>
                <CaretRight className="size-4 text-muted-foreground" />
              </button>
              <button
                type="button"
                className="ios-row text-left"
                onClick={() => setPage('YouTube')}
              >
                <span className="ios-label">YouTube options</span>
                <CaretRight className="size-4 text-muted-foreground" />
              </button>
              <div className="ios-title">About</div>
              <div className="ios-row">
                <span className="ios-label">
                  Lightning {initial.version}
                  <span className="ios-hint">
                    Updates come from the Lightning releases on GitHub.
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
                  {checking ? 'Checking…' : 'Check for updates'}
                </Button>
              </div>
              {checkResult && (
                <div className="ios-note" role="status">
                  {checkResult === 'current' && `You have the latest version (${initial.version}).`}
                  {checkResult === 'failed' && (
                    <span className="text-destructive">
                      Couldn’t reach GitHub. Check your connection and try again.
                    </span>
                  )}
                  {checkResult === 'available' && availableUpdate && (
                    <span>
                      Lightning {availableUpdate.version} is available.{' '}
                      <a
                        href={availableUpdate.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-primary underline underline-offset-2"
                      >
                        Download it
                      </a>
                    </span>
                  )}
                </div>
              )}
              <div className="ios-title">Downloads</div>
              <NumberField
                label="Files at once"
                value={downloadsAtOnce}
                min={1}
                max={8}
                onChange={setDownloadsAtOnce}
              />
              <div className="ios-row">
                <span className="ios-label">Default folder</span>
                <input
                  readOnly
                  aria-label="Default download folder"
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
                  Change…
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
              <div className="ios-title">Text size</div>
              <div className="ios-row">
                <span className="ios-seg ml-auto w-full">
                  {SCALES.map((scale) => (
                    <button
                      key={scale.value}
                      type="button"
                      aria-pressed={String(prefs.uiScale) === scale.value}
                      onClick={() => save({ uiScale: Number(scale.value) })}
                      className="flex-1"
                    >
                      {scale.label}
                    </button>
                  ))}
                </span>
              </div>
              <div className="ios-title">Theme</div>
              <div className="ios-row">
                <span className="ios-seg w-full">
                  {(['dark', 'light'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={theme === mode}
                      onClick={() => setTheme(mode)}
                      className="flex-1 capitalize"
                    >
                      {mode}
                    </button>
                  ))}
                </span>
              </div>
              {window.lightning.platform === 'darwin' && (
                <>
                  <div className="ios-title">Window glass</div>
                  <div className="ios-row">
                    <span className="ios-label">Transparency</span>
                    <input
                      type="range"
                      min={0}
                      max={90}
                      step={2}
                      aria-label="Transparency"
                      value={prefs.glassTransparency}
                      onChange={(event) => save({ glassTransparency: Number(event.target.value) })}
                      className="w-40 accent-[var(--color-accent)]"
                    />
                    <span className="w-9 text-right text-[12px] text-muted-foreground tabular-nums">
                      {prefs.glassTransparency}%
                    </span>
                  </div>
                  <div className="ios-row">
                    <span className="ios-label">Blur</span>
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
                          {text}
                        </button>
                      ))}
                    </span>
                  </div>
                </>
              )}
              <div className="ios-title">Color</div>
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
                      aria-label={accent.label}
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
                      {accent.label}
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
                className="ios-row text-left"
                onClick={() => {
                  void window.lightning.runMainCommand('limits')
                }}
              >
                <span className="ios-label">Speed and data limits</span>
                <CaretRight className="size-4 text-muted-foreground" />
              </button>
              <div className="ios-title">Proxy</div>
              <div className="ios-note">
                For the app&rsquo;s own requests, such as checking for updates. Downloads connect
                through the networks you chose and don&rsquo;t use it.
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
                  <span className="ios-label">{label}</span>
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
              <div className="ios-title">Advanced</div>
              <label className="ios-row">
                <span className="ios-label">Stall timeout (seconds)</span>
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
                How long a connection may go without data before it is retried.
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
              <div>
                <div className="text-[15px] font-semibold">YouTube</div>
                <div className="ios-note">Used by every new YouTube download.</div>
              </div>
              <YoutubeOptionsPanel />
            </>
          )}
          {page === 'Telegram' && (
            <>
              <div>
                <div className="text-[15px] font-semibold">Telegram</div>
                <div className="ios-note">
                  {tdl === null
                    ? 'Checking the account…'
                    : !tdl.binary
                      ? 'The Telegram downloader (tdl) is missing from this build.'
                      : tdl.loggedIn
                        ? `Signed in${tdl.account ? ` as ${tdl.account}` : ''}.`
                        : 'Not signed in. Sign in from the Telegram section.'}
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
                          'Sign out of Telegram? The saved session is deleted from this computer.'
                        )
                      ) {
                        void window.lightning.tdlLogout().then(() => {
                          setTdl({ ...tdl, loggedIn: false, account: undefined })
                        })
                      }
                    }}
                  >
                    Sign out
                  </Button>
                )}
              </div>
              <Row
                checked={prefs.telegramWatchClipboard}
                onChange={(telegramWatchClipboard) => save({ telegramWatchClipboard })}
                label="Offer to download a Telegram message when its link is copied"
              />
              <div className="ios-row">
                <span className="ios-label">Telegram folder</span>
                <input
                  readOnly
                  aria-label="Telegram folder"
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
                  Change…
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
                High numbers can make Telegram slow the account down (FLOOD_WAIT).
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
              <label className="ios-row">
                <span className="ios-label">File name template</span>
                <input
                  defaultValue={prefs.telegramTemplate}
                  spellCheck={false}
                  onBlur={(event) => {
                    const telegramTemplate = event.target.value.trim()
                    if (telegramTemplate !== prefs.telegramTemplate) save({ telegramTemplate })
                  }}
                  className="ios-input w-44 text-left font-mono"
                  placeholder="tdl default"
                />
              </label>
              <div className="ios-note">
                Telegram downloads use the default connection, not Lightning&apos;s networks, DNS or
                speed limits. Only the proxy is passed on.
              </div>
            </>
          )}
          {page === 'Status bar' && (
            <>
              <div className="ios-note">
                Choose what the bar along the bottom shows, and what the menu holds when you click
                its count and speed.
              </div>
              <div className="ios-title">In the bar</div>
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
              <div className="ios-title">The menu</div>
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
                  <span className="ios-label">Running downloads listed</span>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    aria-label="Running downloads listed"
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
              <div className="ios-title">Menu bar icon</div>
              <div className="ios-note">
                The menu you get from the Lightning icon at the top of the screen.
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
              <div className="ios-title">Panel buttons</div>
              <div className="ios-note">
                Up to {TRAY_BUTTONS_MAX}. You can also drag them into order from the panel (Edit).
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
                <span className="ios-label">Speed unit</span>
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
                      {text}
                    </button>
                  ))}
                </span>
              </div>
              <label className="ios-row">
                <span className="ios-label">Running downloads listed</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  aria-label="Menu bar downloads listed"
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
                Reset to the defaults
              </Button>
            </>
          )}
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
              <Row
                checked={prefs.watchClipboard}
                onChange={(watchClipboard) => save({ watchClipboard })}
                label="Offer to download links I copy (while Lightning is in the background)"
              />
              <div className="ios-title">Title bar</div>
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
              <div className="ios-title">Downloads</div>
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
              <div className="ios-title">Help</div>
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void window.lightning.runMainCommand('tour')
                  }}
                >
                  Show the quick tour again
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="ml-2"
                  onClick={() => {
                    void window.lightning.runMainCommand('intro')
                  }}
                >
                  Play the intro again
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
          {detected ? describeVpn(on, names) : 'No VPN detected on this computer.'}
        </div>
      </div>
      <Switch
        aria-label="Use VPN for downloads"
        checked={on}
        disabled={!detected}
        onCheckedChange={setOn}
      />
    </div>
  )
}
