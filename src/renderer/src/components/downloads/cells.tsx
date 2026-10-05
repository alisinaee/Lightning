import { cn } from 'cn'
import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  formatBytes,
  formatDateTime,
  formatSeconds,
  formatSpeed,
  formatWhen
} from '../../utils/format'
import { statusStyle, type RowInfo } from '../../utils/status'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

// One clock for every "Added" cell: they all re-render together once a minute, rather than each
// row keeping a timer of its own.
const listeners = new Set<() => void>()
let minute = Math.floor(Date.now() / 60_000)
let timer: ReturnType<typeof setInterval> | undefined
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  timer ??= setInterval(() => {
    minute = Math.floor(Date.now() / 60_000)
    listeners.forEach((notify) => notify())
  }, 20_000)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = undefined
    }
  }
}
/** The minute the last tick fell in, as a time to measure "ago" from. */
const useClock = (): number => useSyncExternalStore(subscribe, () => minute) * 60_000

export const cellClass = 'flex min-w-0 items-center px-2'

/** A name that gives way with "…", its whole text in a tooltip. */
export function ClippedText({
  text,
  className
}: {
  text: string
  className?: string
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn('truncate', className)}>{text}</span>} />
      <TooltipContent className="max-w-[min(560px,90vw)] break-all">{text}</TooltipContent>
    </Tooltip>
  )
}

export function SizeCell({
  received,
  total,
  running,
  done
}: {
  received: number
  total: number
  running: boolean
  done: boolean
}): React.JSX.Element {
  return (
    <div role="cell" className={cn(cellClass, 'justify-end font-mono text-[11.5px] tabular-nums')}>
      <span className={cn('truncate', done && 'text-[var(--text-secondary)]')}>
        {total <= 0
          ? running || received > 0
            ? `${formatBytes(received)} / unknown`
            : 'unknown'
          : running && !done
            ? `${formatBytes(received)} / ${formatBytes(total)}`
            : formatBytes(total)}
      </span>
    </div>
  )
}

/** Whole seconds until `at`, counting down; null when there is nothing to wait for. */
function useCountdown(at: number | undefined): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (at === undefined) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [at])
  return at === undefined ? null : Math.max(0, Math.ceil((at - now) / 1000))
}

/** Icon and word, and under them a slim bar while it is under way, or why it failed. */
export function StatusCell({ info }: { info: RowInfo }): React.JSX.Element {
  // A finished file that has gone is a warning, not a success.
  const style = statusStyle(info.missing ? 'attention' : info.status)
  const Icon = style.icon
  const moving = info.status === 'downloading'
  const waitSeconds = useCountdown(info.retryAt)
  const label = waitSeconds === null ? info.label : `Retrying in ${waitSeconds} s`
  return (
    <div role="cell" className={cn(cellClass, 'flex-col items-stretch justify-center gap-1')}>
      <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] leading-none font-medium">
        <Icon
          aria-hidden
          className="size-3.5 shrink-0"
          style={{ color: style.color }}
          strokeWidth={2.2}
        />
        <span
          title={info.missing ? 'The file was moved or deleted' : undefined}
          className={cn('truncate', info.status === 'completed' && 'text-[var(--text-secondary)]')}
          style={
            info.status === 'failed' || info.status === 'attention'
              ? { color: style.color }
              : undefined
          }
        >
          {label}
        </span>
      </div>
      {info.reason ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="truncate text-[11px] leading-none text-muted-foreground">
                {info.reason}
              </span>
            }
          />
          <TooltipContent className="max-w-[min(480px,90vw)]">{info.reasonFull}</TooltipContent>
        </Tooltip>
      ) : (
        info.bar && (
          <div
            role="progressbar"
            aria-label="Progress"
            aria-valuenow={info.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-[3px] overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-500',
                !moving && 'opacity-55'
              )}
              style={{
                width: `${Math.max(2, info.percent)}%`,
                background: style.color,
                ...(moving
                  ? {
                      backgroundImage:
                        'repeating-linear-gradient(115deg, rgba(255,255,255,0.28) 0 6px, transparent 6px 12px)',
                      backgroundSize: '16px 100%',
                      animation: 'plexo-stripes 0.9s linear infinite'
                    }
                  : null)
              }}
            />
          </div>
        )
      )}
    </div>
  )
}

export function SpeedCell({ speed }: { speed: number }): React.JSX.Element {
  return (
    <div
      role="cell"
      className={cn(
        cellClass,
        'justify-end font-mono text-[11.5px] tabular-nums',
        speed <= 0 && 'text-muted-foreground'
      )}
    >
      <span className="truncate">{speed > 0 ? formatSpeed(speed) : '—'}</span>
    </div>
  )
}

export function EtaCell({ seconds }: { seconds: number | null }): React.JSX.Element {
  return (
    <div
      role="cell"
      className={cn(
        cellClass,
        'justify-end font-mono text-[11.5px] tabular-nums',
        seconds === null && 'text-muted-foreground'
      )}
    >
      {formatSeconds(seconds)}
    </div>
  )
}

export function AddedCell({ at }: { at: number }): React.JSX.Element {
  const now = useClock()
  return (
    <div role="cell" className={cn(cellClass, 'text-[12px] text-[var(--text-secondary)]')}>
      <Tooltip>
        <TooltipTrigger
          render={<span className="truncate">{formatWhen(at, Math.max(now, at))}</span>}
        />
        <TooltipContent>{formatDateTime(at)}</TooltipContent>
      </Tooltip>
    </div>
  )
}

export interface ConnectionChip {
  id: string
  name: string
  color: string
  speed?: number
}

/** The networks a download is on, as small coloured dots (never a VPN: see connectionsOf). */
export function ConnectionsCell({ chips }: { chips: ConnectionChip[] }): React.JSX.Element {
  const shown = chips.slice(0, 5)
  return (
    <div role="cell" className={cn(cellClass, 'gap-1')}>
      {chips.length === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="flex items-center gap-1">
                {shown.map((chip) => (
                  <span
                    key={chip.id}
                    className="size-2.5 rounded-full ring-1 ring-background"
                    style={{ background: chip.color }}
                  />
                ))}
                {chips.length > shown.length && (
                  <span className="text-[10.5px] text-muted-foreground">
                    +{chips.length - shown.length}
                  </span>
                )}
              </span>
            }
          />
          <TooltipContent>
            {chips
              .map((chip) => chip.name + (chip.speed ? ` ${formatSpeed(chip.speed)}` : ''))
              .join(' · ')}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
