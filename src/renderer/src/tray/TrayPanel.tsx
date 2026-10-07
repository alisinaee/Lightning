import type { PanelAction, PanelDownload, PanelState } from '@shared/trayPanel'
import type { NetworkInterfaceKind } from '@shared/types'
import {
  ArrowDownToLine,
  ExternalLink,
  FolderDown,
  ListPlus,
  Pause,
  Play,
  Plus,
  Power,
  Settings
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SpeedGraph } from '../components/SpeedGraph'
import { assignNetworkColors, resolveNetworkVisual } from '../theme'
import { formatBytes, formatDuration, formatSpeed } from '../utils/format'

const act = (action: PanelAction): void => window.trayPanel.act(action)

function Section({
  title,
  children
}: {
  title?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2 border-t-[0.5px] border-border/70 px-4 py-3 first:border-t-0">
      {title && (
        <h2 className="text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
          {title}
        </h2>
      )}
      {children}
    </section>
  )
}

function Chip({
  label,
  count,
  tone
}: {
  label: string
  count: number
  tone: string
}): React.JSX.Element | null {
  if (count === 0) return null
  return (
    <span
      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium"
      style={{ background: `color-mix(in srgb, ${tone} 16%, transparent)`, color: tone }}
    >
      <span className="tabular-nums">{count}</span> {label}
    </span>
  )
}

function DownloadRow({ download }: { download: PanelDownload }): React.JSX.Element {
  return (
    <div className="group/row flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-secondary/70">
      <button
        type="button"
        onClick={() => act({ type: 'open-download', id: download.id })}
        className="flex min-w-0 flex-1 flex-col gap-1 text-left outline-none"
        aria-label={`Open ${download.name}`}
      >
        <span className="flex items-baseline justify-between gap-2 text-[12.5px]">
          <span className="min-w-0 truncate font-medium">{download.name}</span>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
            {formatSpeed(download.speed)}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${Math.max(2, download.percent)}%` }}
            />
          </span>
          <span className="w-8 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
            {download.percent}%
          </span>
          <span className="w-12 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
            {download.timeLeft ? formatDuration(download.timeLeft) : '–'}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={`Pause ${download.name}`}
        title="Pause"
        onClick={() => act({ type: 'pause', id: download.id })}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none group-hover/row:opacity-100 hover:bg-secondary hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Pause className="size-3.5" />
      </button>
    </div>
  )
}

function Action({
  label,
  icon: Icon,
  onClick,
  primary
}: {
  label: string
  icon: typeof Plus
  onClick: () => void
  primary?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 items-center justify-center gap-1.5 rounded-lg px-2 text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        primary
          ? 'bg-primary text-primary-foreground hover:opacity-90'
          : 'bg-secondary/80 text-foreground hover:bg-secondary'
      }`}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

/** The panel under the menu-bar icon: the same facts as the status menu, with live bars, colours
 * and buttons. It draws what main last sent (about once a second) and nothing else. */
export function TrayPanel(): React.JSX.Element {
  const [state, setState] = useState<PanelState | null>(null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => window.trayPanel.onState(setState), [])
  useEffect(() => {
    if (state) document.documentElement.dataset.accent = state.accent
  }, [state?.accent]) // eslint-disable-line react-hooks/exhaustive-deps

  // The window is as tall as what it shows.
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const report = (): void => window.trayPanel.resize(Math.ceil(element.offsetHeight))
    report()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    return () => observer.disconnect()
  }, [state !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) return <div ref={root} className="h-[160px]" />

  const kinds = new Map<string, NetworkInterfaceKind>(
    state.networks.map((network) => [network.id, network.kind as NetworkInterfaceKind])
  )
  const colors = assignNetworkColors(kinds, state.networkPreferences)
  const visual = (id: string, kind: string, name: string): { name: string; solid: string } =>
    resolveNetworkVisual(
      kind as NetworkInterfaceKind,
      name,
      state.networkPreferences[id],
      colors.get(id) ?? 'teal'
    )
  const top = Math.max(1, ...state.networks.map((network) => network.speed))
  const show = state.show
  const idle = state.running === 0

  return (
    <div
      ref={root}
      role="region"
      aria-label="Lightning status"
      className="flex w-full flex-col bg-background/70 font-sans text-foreground"
    >
      {show.trayTotals && (
        <Section>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[11px] text-muted-foreground">
                {idle ? 'Nothing is downloading' : `${state.running} downloading`}
              </span>
              <span className="flex items-baseline gap-1.5">
                <ArrowDownToLine
                  aria-hidden
                  className={`size-4 self-center ${idle ? 'text-muted-foreground' : 'text-primary'}`}
                />
                <span
                  aria-label="Total speed"
                  className="font-mono text-[24px] leading-none font-semibold tabular-nums"
                >
                  {formatSpeed(state.speed)}
                </span>
              </span>
            </div>
            {state.left > 0 && (
              <div className="flex shrink-0 flex-col items-end gap-0.5 text-[11px] text-muted-foreground">
                <span className="tabular-nums">{formatBytes(state.left)} left</span>
                {state.speed > 0 && (
                  <span className="tabular-nums">{formatDuration(state.left / state.speed)}</span>
                )}
              </div>
            )}
          </div>
          {show.trayGraph && <SpeedGraph points={state.history} />}
        </Section>
      )}

      {show.trayNetworks && state.networks.length > 0 && (
        <Section title="Networks">
          {state.networks.map((network) => {
            const look = visual(network.id, network.kind, network.label)
            return (
              <div key={network.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-[12.5px]">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: look.solid }}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{look.name}</span>
                  <span className="shrink-0 font-mono text-[11.5px] tabular-nums">
                    {formatSpeed(network.speed)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{
                      width: `${Math.max(2, (network.speed / top) * 100)}%`,
                      background: look.solid
                    }}
                  />
                </div>
                <div className="text-[10.5px] text-muted-foreground">
                  {network.open} {network.open === 1 ? 'connection' : 'connections'} ·{' '}
                  {network.moving} moving · {network.downloads}{' '}
                  {network.downloads === 1 ? 'download' : 'downloads'}
                </div>
              </div>
            )
          })}
        </Section>
      )}

      {show.trayDownloads && state.downloads.length > 0 && (
        <Section title="Running">
          <div className="-mx-1.5 flex flex-col">
            {state.downloads.map((download) => (
              <DownloadRow key={download.id} download={download} />
            ))}
          </div>
          {state.more > 0 && (
            <div className="text-[11px] text-muted-foreground">…and {state.more} more</div>
          )}
        </Section>
      )}

      {show.trayQueue && (state.queued > 0 || state.paused > 0 || state.failed > 0) && (
        <Section>
          <div className="flex flex-wrap gap-1.5">
            <Chip label="waiting" count={state.queued} tone="var(--status-queued, #6e6e73)" />
            <Chip label="paused" count={state.paused} tone="var(--status-paused, #d97706)" />
            <Chip label="failed" count={state.failed} tone="var(--status-failed, #dc2626)" />
          </div>
        </Section>
      )}

      {show.trayActions && (
        <Section>
          <div className="grid grid-cols-2 gap-1.5">
            <Action
              primary
              label="New download"
              icon={Plus}
              onClick={() => act({ type: 'new-download' })}
            />
            <Action
              label="Several links"
              icon={ListPlus}
              onClick={() => act({ type: 'several-links' })}
            />
            <Action label="Pause all" icon={Pause} onClick={() => act({ type: 'pause-all' })} />
            <Action label="Resume all" icon={Play} onClick={() => act({ type: 'resume-all' })} />
            <Action
              label="Open Lightning"
              icon={ExternalLink}
              onClick={() => act({ type: 'show' })}
            />
            <Action label="Settings" icon={Settings} onClick={() => act({ type: 'settings' })} />
          </div>
          <div className="flex items-center justify-between pt-0.5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <FolderDown aria-hidden className="size-3" />
              Lightning {state.version}
            </span>
            <button
              type="button"
              onClick={() => act({ type: 'quit' })}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Power aria-hidden className="size-3" />
              Quit
            </button>
          </div>
        </Section>
      )}
    </div>
  )
}
