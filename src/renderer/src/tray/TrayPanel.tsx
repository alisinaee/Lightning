import type { PanelAction, PanelDownload, PanelState } from '@shared/trayPanel'
import {
  TRAY_BUTTONS,
  TRAY_BUTTONS_MAX,
  type NetworkInterfaceKind,
  type TrayButton
} from '@shared/types'
import { formatSpeedIn } from '@shared/trayModel'
import {
  ArrowLineDown as ArrowDownToLine,
  ArrowSquareOut as ExternalLink,
  FolderSimple as FolderDown,
  ArrowsClockwise,
  Article,
  Gauge,
  PaperPlaneTilt,
  ListPlus,
  Check,
  Minus,
  Pause,
  PencilSimple,
  Play,
  Plus,
  Power,
  PushPin,
  ShieldCheck,
  Gear as Settings
} from '@phosphor-icons/react'
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
    <section className="flex flex-col gap-2 border-t-[0.5px] border-foreground/10 px-4 py-2.5 first:border-t-0">
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

const BUTTONS: Record<
  TrayButton,
  { label: string; icon: typeof Plus; action: PanelAction; toggle?: 'vpn' | 'slowMode' }
> = {
  'new-download': { label: 'New', icon: Plus, action: { type: 'new-download' } },
  'several-links': { label: 'Links', icon: ListPlus, action: { type: 'several-links' } },
  'pause-all': { label: 'Pause all', icon: Pause, action: { type: 'pause-all' } },
  'resume-all': { label: 'Resume all', icon: Play, action: { type: 'resume-all' } },
  show: { label: 'Open', icon: ExternalLink, action: { type: 'show' } },
  settings: { label: 'Settings', icon: Settings, action: { type: 'settings' } },
  vpn: { label: 'VPN', icon: ShieldCheck, action: { type: 'toggle-vpn' }, toggle: 'vpn' },
  'slow-mode': {
    label: 'Slow mode',
    icon: Gauge,
    action: { type: 'toggle-slow-mode' },
    toggle: 'slowMode'
  },
  'open-folder': { label: 'Folder', icon: FolderDown, action: { type: 'open-folder' } },
  telegram: { label: 'Telegram', icon: PaperPlaneTilt, action: { type: 'open-telegram' } },
  'check-update': { label: 'Update', icon: ArrowsClockwise, action: { type: 'check-update' } },
  logs: { label: 'Logs', icon: Article, action: { type: 'logs' } }
}

function Action({
  label,
  icon: Icon,
  onClick,
  primary,
  on,
  tall,
  dashed
}: {
  label: string
  icon: typeof Plus
  onClick: () => void
  primary?: boolean
  /** Fewer buttons: each is bigger. */
  tall?: boolean
  dashed?: boolean
  /** A switch button: whether it is on. Undefined for a plain button. */
  on?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={label}
      className={`flex w-full ${tall ? 'h-[58px]' : 'h-[46px]'} flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10.5px] leading-none font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        primary
          ? 'bg-primary text-primary-foreground hover:opacity-90'
          : on
            ? 'bg-primary/20 text-primary hover:bg-primary/25'
            : dashed
              ? 'border border-dashed border-foreground/25 text-muted-foreground hover:bg-foreground/[0.06]'
              : 'bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.11]'
      }`}
    >
      <Icon className={`${tall ? 'size-5' : 'size-[17px]'} shrink-0`} />
      <span className="max-w-full truncate">{label}</span>
    </button>
  )
}

/** The buttons and the foot of the panel. "Edit" lets the person drag the buttons into order, take
 * some away and add others (at most six, and each is as big as the room allows). While editing, or
 * pinned, the panel stays open instead of closing when a click lands elsewhere. */
function Dock({ state }: { state: PanelState }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [draft, setDraft] = useState<TrayButton[]>(state.buttons)
  const [dragging, setDragging] = useState<{ id: TrayButton; from: 'grid' | 'pool' } | null>(null)
  const list = editing ? draft : state.buttons
  const keepOpen = pinned || editing

  useEffect(() => window.trayPanel.setPinned(keepOpen), [keepOpen])

  const commit = (next: TrayButton[]): void => {
    setDraft(next)
    window.trayPanel.setButtons(next)
  }
  const room = list.length < TRAY_BUTTONS_MAX
  const spare = TRAY_BUTTONS.filter((id) => !list.includes(id))
  const tiles = list.length
  const columns = tiles <= 4 ? Math.max(1, tiles) : 3
  const tall = tiles <= 3

  return (
    <>
      {tiles > 0 && (
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
          {list.map((id) => {
            const button = BUTTONS[id]
            const tile = (
              <Action
                primary={id === 'new-download'}
                tall={tall}
                label={button.label}
                icon={button.icon}
                on={button.toggle ? state.toggles[button.toggle] : undefined}
                onClick={() => {
                  if (!editing) act(button.action)
                }}
              />
            )
            if (!editing) return <div key={id}>{tile}</div>
            return (
              <div
                key={id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', id)
                  setDragging({ id, from: 'grid' })
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  if (!dragging || dragging.from !== 'grid' || dragging.id === id) return
                  const next = draft.filter((entry) => entry !== dragging.id)
                  next.splice(draft.indexOf(id), 0, dragging.id)
                  setDraft(next)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  // From the shelf: put it here, or in place of this one when all six are taken.
                  if (dragging?.from !== 'pool') return
                  const next = [...draft]
                  next.splice(draft.indexOf(id), room ? 0 : 1, dragging.id)
                  commit(next)
                  // The shelf button is gone from the shelf, so it never reports the drag's end.
                  setDragging(null)
                }}
                onDragEnd={() => {
                  if (dragging?.from === 'grid') commit(draft)
                  setDragging(null)
                }}
                className={`relative animate-[lightning-wiggle_0.5s_ease-in-out_infinite_alternate] cursor-grab ${
                  dragging?.id === id ? 'opacity-40' : ''
                }`}
              >
                {tile}
                <button
                  type="button"
                  aria-label={`Remove ${button.label}`}
                  onClick={() => commit(list.filter((entry) => entry !== id))}
                  className="absolute -top-1 -left-1 flex size-4 items-center justify-center rounded-full bg-foreground/70 text-background outline-none hover:bg-foreground"
                >
                  <Minus weight="bold" className="size-2.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}
      {editing && (
        <div
          className="flex flex-col gap-1.5 rounded-xl bg-foreground/[0.04] p-2"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            // A button dropped on the shelf goes back to it.
            if (dragging?.from === 'grid') commit(list.filter((entry) => entry !== dragging.id))
            setDragging(null)
          }}
        >
          <div className="text-[10.5px] text-muted-foreground">
            {room
              ? 'More buttons: drag one up, or tap it.'
              : `${TRAY_BUTTONS_MAX} is the most: drop one on a button to swap it.`}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {spare.map((id) => (
              <div
                key={id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', id)
                  setDragging({ id, from: 'pool' })
                }}
                onDragEnd={() => setDragging(null)}
                className="cursor-grab"
              >
                <Action
                  label={BUTTONS[id].label}
                  icon={BUTTONS[id].icon}
                  onClick={() => {
                    if (room) commit([...list, id])
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between pt-0.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <FolderDown aria-hidden className="size-3" />
          Lightning {state.version}
        </span>
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            aria-pressed={pinned}
            title={
              pinned
                ? 'Pinned: stays open until you unpin it'
                : 'Pin: keep this panel open while you click elsewhere'
            }
            onClick={() => setPinned((on) => !on)}
            className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${
              pinned ? 'text-primary' : ''
            }`}
          >
            <PushPin weight={pinned ? 'fill' : 'regular'} aria-hidden className="size-3" />
            {pinned ? 'Pinned' : 'Pin'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!editing) setDraft(state.buttons)
              setEditing((on) => !on)
            }}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {editing ? (
              <Check aria-hidden className="size-3" />
            ) : (
              <PencilSimple aria-hidden className="size-3" />
            )}
            {editing ? 'Done' : 'Edit'}
          </button>
          <button
            type="button"
            onClick={() => act({ type: 'quit' })}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Power aria-hidden className="size-3" />
            Quit
          </button>
        </span>
      </div>
    </>
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
      className="flex w-full flex-col bg-background/25 font-sans text-foreground"
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
                  {formatSpeedIn(state.speed, state.unit)}
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
          <Dock state={state} />
        </Section>
      )}
    </div>
  )
}
