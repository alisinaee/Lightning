import { toDisplayPath } from '../utils/format'
import type { AppPrefs, ResolvedPrefs, StatusBarPrefs } from '@shared/types'
import { BrowserPage } from './BrowserPage'
import { SchedulePage } from './SchedulePage'
import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n/react'
import type { LanguageSetting } from '@shared/i18n'
import { applyGlass } from '../utils/syncSettings'
import { useAppStore } from '../store/useAppStore'
import { YoutubeOptionsPanel } from './youtube/YoutubeOptionsSheet'
import {
  Bell,
  CalendarBlank,
  CaretRight,
  Clipboard,
  ChartBar,
  ClockCounterClockwise,
  Gear,
  Globe,
  Lightning,
  MagnifyingGlass,
  PaintBrush,
  Rows,
  ShieldCheck,
  SlidersHorizontal,
  WifiHigh,
  X,
  YoutubeLogo
} from '@phosphor-icons/react'
import { TelegramIcon } from './telegram/TelegramIcon'
import { Button } from './ui/button'
import { HistorySettings } from './HistorySettings'
import { UsageSettings } from './UsageSettings'
import { AppearanceSettings } from './settings/AppearanceSettings'
import { ClipboardSettings } from './settings/ClipboardSettings'
import { NetworkSettings } from './settings/NetworkSettings'
import { NumberField, Row } from './settings/SettingsControls'
import { StatusBarSettings } from './settings/StatusBarSettings'
import { TelegramSettings } from './settings/TelegramSettings'
import { PermissionsSettings } from './settings/PermissionsSettings'
import { searchSettings, type SettingEntry } from './settings/searchIndex'

const PAGES = [
  'General',
  'History',
  'Usage',
  'Appearance',
  'Network',
  'Notifications',
  'Permissions',
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
  Permissions: { color: '#0a84ff', icon: <ShieldCheck /> },
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

function applyScale(scale: number): void {
  window.lightning.setZoom(scale)
}

function applyAccent(accent: string): void {
  document.documentElement.dataset.accent = accent
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
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<'available' | 'current' | 'failed' | null>(null)

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
  const results = useMemo(() => searchSettings(query), [query])

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
      <div className="flex min-h-0 min-w-0 flex-1">
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
            PAGES.filter(
              (entry) => entry !== 'Permissions' || window.lightning.platform === 'darwin'
            ).map((entry) => (
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
                  className="shrink-0 rounded-full whitespace-nowrap"
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
                checked={prefs.autoSyncFiles}
                onChange={(autoSyncFiles) => save({ autoSyncFiles })}
                label="Auto sync"
                hint="Removes a finished download from the list when its file is moved or deleted."
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
            <AppearanceSettings prefs={prefs} save={save} theme={theme} setTheme={setTheme} />
          )}
          {page === 'Network' && <NetworkSettings prefs={prefs} save={save} />}
          {page === 'Permissions' && <PermissionsSettings />}
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
            <TelegramSettings
              prefs={prefs}
              save={save}
              telegramDir={telegramDir}
              homeDir={homeDir}
              onTelegramDirChange={setTelegramDir}
              onOpenClipboard={() => setPage('Clipboard')}
            />
          )}
          {page === 'Status bar' && <StatusBarSettings bar={bar} setBar={setBar} />}
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
