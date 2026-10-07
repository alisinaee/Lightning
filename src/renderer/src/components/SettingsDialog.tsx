import { DEFAULT_STATUS_BAR } from '@shared/types'
import type { AccentId, AppPrefs, ResolvedPrefs, StatusBarPrefs } from '@shared/types'
import { BrowserPage } from './BrowserPage'
import { SchedulePage } from './SchedulePage'
import { isProxyAddress } from '@shared/networks'
import { useState } from 'react'
import { describeVpn, useVpnLayer } from '../hooks/useConnections'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { useAppStore } from '../store/useAppStore'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Switch } from './ui/switch'
import { HistorySettings } from './HistorySettings'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

const SCALES = [
  { value: '0.9', label: 'Small' },
  { value: '1', label: 'Medium' },
  { value: '1.15', label: 'Large' },
  { value: '1.3', label: 'Larger' }
]

const PAGES = [
  'General',
  'History',
  'Appearance',
  'Network',
  'Notifications',
  'Power',
  'Schedule',
  'Browser',
  'Interface',
  'Status bar'
] as const

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
    <label
      className={`flex items-start gap-3 py-1.5 text-[13px] leading-5 ${disabled ? 'opacity-50' : ''}`}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="mt-0.5"
      />
      <span>{label}</span>
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
    <label className="flex items-center gap-3 text-[12.5px]">
      <span className="w-16 text-muted-foreground">{label}</span>
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
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-[var(--input-bg)] px-2 font-mono text-[12px] outline-none aria-invalid:border-[var(--color-danger)]"
      />
      {invalid && <span className="text-[11.5px] text-[var(--color-danger)]">Not an address</span>}
    </label>
  )
}

/** Settings: version and updates, text size and theme, the proxy, notices, power, and how the
 * window closes. Saved as they change. */
export function SettingsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const initial = window.lightning.initialState
  const [page, setPage] = useState<(typeof PAGES)[number]>('General')
  const [prefs, setPrefs] = useState<ResolvedPrefs>(initial.prefs)
  const [schedule, setSchedule] = useState(initial.schedule)
  const theme = useAppStore((store) => store.themeSource)
  const setTheme = useAppStore((store) => store.setThemeSource)
  const downloadsAtOnce = useAppStore((store) => store.downloadsAtOnce)
  const setDownloadsAtOnce = useAppStore((store) => store.setDownloadsAtOnce)
  const checkForUpdateNow = useAppStore((store) => store.checkForUpdateNow)
  const availableUpdate = useAppStore((store) => store.availableUpdate)
  const setTitleBarButtons = useAppStore((store) => store.setTitleBarButtons)
  const setStatusBar = useAppStore((store) => store.setStatusBar)
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
    if (patch.showLogs !== undefined || patch.showDebug !== undefined) {
      setTitleBarButtons({ showLogs: next.showLogs, showDebug: next.showDebug })
    }
    if (patch.statusBar !== undefined) setStatusBar(next.statusBar)
    void window.lightning.updateSettings({ prefs: next })
  }

  const bar = prefs.statusBar
  const setBar = (patch: Partial<StatusBarPrefs>): void => save({ statusBar: patch })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[560px] w-[720px] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <div className="border-b-[0.5px] border-border px-5 py-4">
          <DialogTitle className="text-[16px] font-semibold">Settings</DialogTitle>
        </div>
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-40 shrink-0 flex-col gap-0.5 border-r-[0.5px] border-border p-2">
            {PAGES.map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setPage(entry)}
                className={`h-8 rounded-md px-2 text-left text-[13px] ${
                  page === entry ? 'bg-primary/10 font-medium' : 'hover:bg-secondary'
                }`}
              >
                {entry}
              </button>
            ))}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 text-[13px]">
            {page === 'General' && (
              <>
                <div>
                  <div className="text-[15px] font-semibold">Lightning {initial.version}</div>
                  <div className="text-[12.5px] text-muted-foreground">
                    Updates come from the Lightning releases on GitHub.
                  </div>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="self-start"
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
                <div className="min-h-5 text-[12.5px]" role="status">
                  {checkResult === 'current' && (
                    <span className="text-muted-foreground">
                      You have the latest version ({initial.version}).
                    </span>
                  )}
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
                <div className="mt-2 text-[12px] font-medium text-muted-foreground">Downloads</div>
                <label className="flex items-center gap-3">
                  Files at once
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={downloadsAtOnce}
                    onChange={(event) => {
                      const count = Math.floor(Number(event.target.value))
                      if (count >= 1 && count <= 8) setDownloadsAtOnce(count)
                    }}
                    className="h-8 w-16 rounded-md border border-input bg-[var(--input-bg)] px-2 text-center outline-none"
                  />
                </label>
              </>
            )}
            {page === 'History' && <HistorySettings />}
            {page === 'Appearance' && (
              <>
                <div className="text-[12px] font-medium text-muted-foreground">Text size</div>
                <ToggleGroup
                  value={[String(prefs.uiScale)]}
                  onValueChange={(values) => {
                    const next = Number(values[0])
                    if (Number.isFinite(next)) save({ uiScale: next })
                  }}
                >
                  {SCALES.map((scale) => (
                    <ToggleGroupItem key={scale.value} value={scale.value}>
                      {scale.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <div className="text-[12px] font-medium text-muted-foreground">Appearance</div>
                <ToggleGroup
                  value={[theme]}
                  onValueChange={(values) => {
                    const next = values[0]
                    if (next === 'light' || next === 'dark') setTheme(next)
                  }}
                >
                  <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
                  <ToggleGroupItem value="light">Light</ToggleGroupItem>
                </ToggleGroup>
                <div className="text-[12px] font-medium text-muted-foreground">Color</div>
                <div className="flex flex-wrap gap-2">
                  {ACCENTS.map((accent) => (
                    <button
                      key={accent.id}
                      type="button"
                      aria-label={accent.label}
                      aria-pressed={prefs.accent === accent.id}
                      title={accent.label}
                      onClick={() => save({ accent: accent.id })}
                      className="flex h-9 items-center gap-2 rounded-md border px-2.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      style={{
                        borderColor: prefs.accent === accent.id ? accent.color : 'var(--border)'
                      }}
                    >
                      <span
                        className="size-3.5 rounded-full"
                        style={{ background: accent.color }}
                      />
                      {accent.label}
                    </button>
                  ))}
                </div>
              </>
            )}
            {page === 'Network' && (
              <>
                <VpnSetting />
                <div className="mt-2 text-[12px] font-medium text-muted-foreground">Proxy</div>
                <div className="text-[12px] text-muted-foreground">
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
                  <label key={mode} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="proxy"
                      checked={prefs.proxyMode === mode}
                      onChange={() => save({ proxyMode: mode })}
                    />
                    {label}
                  </label>
                ))}
                {prefs.proxyMode === 'manual' && (
                  <div className="mt-1 flex flex-col gap-2">
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
              />
            )}
            {page === 'Status bar' && (
              <>
                <div className="text-[12.5px] text-muted-foreground">
                  Choose what the bar along the bottom shows, and what the menu holds when you click
                  its count and speed.
                </div>
                <div className="mt-1 text-[12px] font-medium text-muted-foreground">In the bar</div>
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
                <div className="mt-2 text-[12px] font-medium text-muted-foreground">The menu</div>
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
                  <label className="mt-2 flex items-center gap-3 text-[13px]">
                    Running downloads listed
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
                      className="h-8 w-16 rounded-md border border-input bg-[var(--input-bg)] px-2 text-center text-[13px] outline-none"
                    />
                  </label>
                </fieldset>
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
                  checked={prefs.hideDock}
                  onChange={(hideDock) => save({ hideDock })}
                  label="Hide the Dock icon"
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
                <div className="mt-2 text-[12px] font-medium text-muted-foreground">Title bar</div>
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
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function VpnSetting(): React.JSX.Element {
  const { detected, on, tunnels, setOn } = useVpnLayer()
  const visual = useNetworkVisuals()
  const names = tunnels.map((tunnel) => visual(tunnel.id, tunnel.kind, tunnel.displayName).name)
  return (
    <div className="flex items-center gap-3 rounded-lg border-[0.5px] border-border px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">VPN</div>
        <div className="text-[12.5px] leading-snug text-muted-foreground">
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
