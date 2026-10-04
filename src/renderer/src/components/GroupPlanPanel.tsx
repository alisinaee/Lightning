import type { DownloadState, GroupInfo } from '@shared/types'
import { cn } from 'cn'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { useNetworkOptions } from '../hooks/useNetworkOptions'
import { formatSpeed } from '../utils/format'

const ago = (at: number, now: number): string => {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`
}

/** "How Plexo is downloading this group": what the plan is, each network's part in it, and the
 * recent decisions. */
export function GroupPlanPanel({
  group,
  live,
  now
}: {
  group: GroupInfo
  live: DownloadState[]
  now: number
}): React.JSX.Element {
  const options = useNetworkOptions()
  const showLog = useAppStore((store) => store.groupUi[group.id]?.decisions ?? false)
  const toggle = useAppStore((store) => store.toggleGroupUi)
  const tunnels = useAppStore((store) => store.vpnInterfaces)
  // The VPN is a layer over the connections, not one of them: the plan lists connections only.
  const plan = {
    ...group.plan,
    networks: group.plan.networks.filter((n) => !tunnels.some((tunnel) => tunnel.id === n.id))
  }
  const nameOf = (id: string, fallback?: string): string =>
    options.find((option) => option.id === id)?.name ?? fallback ?? id

  const running = live.filter((file) => file.status === 'downloading')
  const speedOn = (id: string): number =>
    running.reduce(
      (sum, file) =>
        sum + (file.networks.find((n) => n.id === id && n.enabled)?.speedBytesPerSec ?? 0),
      0
    )
  const peak = Math.max(1, ...plan.networks.map((n) => Math.max(speedOn(n.id), n.baselineBps)))
  // The network a file leans on most is its main one; the others on that file help it.
  const helpers = new Set<string>()
  const mains = new Set<string>()
  for (const file of running) {
    const on = file.networks.filter((n) => n.enabled && n.kind !== 'vpn')
    const rank = [...on].sort(
      (a, b) =>
        (plan.networks.find((n) => n.id === b.id)?.baselineBps ?? 0) -
        (plan.networks.find((n) => n.id === a.id)?.baselineBps ?? 0)
    )
    rank.forEach((network, index) => (index === 0 ? mains : helpers).add(network.id))
  }

  return (
    <div
      className="mb-2 flex flex-col gap-2 rounded-lg border-[0.5px] border-border bg-card px-3 py-2.5 text-[12px]"
      aria-label="How Plexo is downloading this group"
    >
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        How Plexo is downloading this group
      </div>
      <div className="leading-snug">{plan.summary || 'Nothing to plan yet.'}</div>
      {plan.networks.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {plan.networks.map((network) => {
            const option = options.find((o) => o.id === network.id)
            const speed = running.length > 0 ? speedOn(network.id) : network.speedBps
            const role =
              network.state === 'lost'
                ? 'lost'
                : network.state === 'slow'
                  ? 'slow'
                  : helpers.has(network.id) && !mains.has(network.id)
                    ? 'helper'
                    : mains.has(network.id)
                      ? 'main'
                      : 'idle'
            return (
              <div key={network.id} className="flex items-center gap-2">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: option?.solid ?? 'var(--muted-foreground)' }}
                />
                <span className="w-24 shrink-0 truncate">{nameOf(network.id, network.name)}</span>
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-[width]"
                    style={{
                      width: `${Math.min(100, (speed / peak) * 100)}%`,
                      background: option?.solid ?? 'var(--muted-foreground)'
                    }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                  {speed > 0 ? formatSpeed(speed) : '—'}
                </span>
                <span
                  className={cn(
                    'w-12 shrink-0 text-right text-[11px]',
                    role === 'slow' || role === 'lost'
                      ? 'text-[var(--color-danger)]'
                      : 'text-muted-foreground'
                  )}
                >
                  {role}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {plan.log.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={showLog}
            onClick={() => toggle(group.id, 'decisions')}
            className="flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground"
          >
            {showLog ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            Recent decisions ({plan.log.length})
          </button>
          {showLog && (
            <ul className="mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto">
              {[...plan.log].reverse().map((event, index) => (
                <li key={`${event.at}-${index}`} className="flex gap-2 text-[11.5px]">
                  <span className="w-14 shrink-0 text-muted-foreground">{ago(event.at, now)}</span>
                  <span className="min-w-0">{event.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
