import type { NetworkInterfaceKind, UsageHistoryResult } from '@shared/types'
import { useEffect, useMemo, useState } from 'react'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { useAppStore } from '../store/useAppStore'
import { formatBytes } from '../utils/format'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

interface RangeChoice {
  label: string
  /** null: everything recorded. */
  rangeMs: number | null
  bucketMs: number
}

const RANGES: RangeChoice[] = [
  { label: '1h', rangeMs: HOUR, bucketMs: 2 * MINUTE },
  { label: '2h', rangeMs: 2 * HOUR, bucketMs: 5 * MINUTE },
  { label: '6h', rangeMs: 6 * HOUR, bucketMs: 15 * MINUTE },
  { label: '12h', rangeMs: 12 * HOUR, bucketMs: 30 * MINUTE },
  { label: '1 day', rangeMs: DAY, bucketMs: HOUR },
  { label: '3 days', rangeMs: 3 * DAY, bucketMs: 3 * HOUR },
  { label: '5 days', rangeMs: 5 * DAY, bucketMs: 6 * HOUR },
  { label: '7 days', rangeMs: 7 * DAY, bucketMs: 6 * HOUR },
  { label: '30 days', rangeMs: 30 * DAY, bucketMs: DAY },
  { label: 'All', rangeMs: null, bucketMs: DAY }
]

const REFRESH_MS = 5000
const WIDTH = 560
const HEIGHT = 150

function when(time: number, bucketMs: number): string {
  const date = new Date(time)
  if (bucketMs >= DAY) return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** What each network received over a time range: a chart by network, each network's total, and
 * the files that used it. */
export function UsageSettings(): React.JSX.Element {
  const [range, setRange] = useState(RANGES[4])
  const [network, setNetwork] = useState<string | null>(null)
  const [data, setData] = useState<UsageHistoryResult | null>(null)
  const interfaces = useAppStore((store) => store.allInterfaces)
  const resolveVisual = useNetworkVisuals()

  useEffect(() => {
    let disposed = false
    const load = (): void => {
      void window.lightning
        .usageHistory({
          rangeMs: range.rangeMs,
          bucketMs: range.bucketMs,
          network: network ?? undefined
        })
        .then((next) => !disposed && setData(next))
        .catch(() => {})
    }
    load()
    const interval = setInterval(load, REFRESH_MS)
    return () => {
      disposed = true
      clearInterval(interval)
    }
  }, [range, network])

  const visual = (id: string): { name: string; solid: string } => {
    const iface = interfaces.find((entry) => entry.id === id)
    const kind: NetworkInterfaceKind = iface?.kind ?? 'other'
    const { name, solid } = resolveVisual(id, kind, iface?.displayName ?? id)
    return { name, solid }
  }

  const networks = useMemo(
    () => Object.entries(data?.byNetwork ?? {}).sort((a, b) => b[1] - a[1]),
    [data]
  )
  const peak = Math.max(1, ...(data?.series.map((slice) => sum(slice.byNetwork)) ?? [0]))
  const series = data?.series ?? []
  const barWidth = series.length > 0 ? WIDTH / series.length : WIDTH

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[15px] font-semibold">Data usage</div>
        <div className="text-[12.5px] text-muted-foreground">
          What each connection received, and which files used it. Counted from the first time this
          version ran.
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {RANGES.map((choice) => (
          <button
            key={choice.label}
            type="button"
            onClick={() => setRange(choice)}
            className={`h-7 rounded-md px-2.5 text-[12px] ${
              range === choice ? 'bg-primary/15 font-medium' : 'bg-secondary hover:bg-secondary/70'
            }`}
          >
            {choice.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setNetwork(null)}
          className={`h-7 rounded-md px-2.5 text-[12px] ${
            network === null ? 'bg-primary/15 font-medium' : 'bg-secondary hover:bg-secondary/70'
          }`}
        >
          All connections
        </button>
        {networks.map(([id]) => (
          <button
            key={id}
            type="button"
            onClick={() => setNetwork(network === id ? null : id)}
            className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] ${
              network === id ? 'bg-primary/15 font-medium' : 'bg-secondary hover:bg-secondary/70'
            }`}
          >
            <span className="size-2 rounded-full" style={{ background: visual(id).solid }} />
            {visual(id).name}
          </button>
        ))}
      </div>

      <div className="rounded-lg border-[0.5px] border-border p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <div className="text-[22px] font-semibold">{formatBytes(data?.total ?? 0)}</div>
          <div className="text-[12px] text-muted-foreground">
            peak {formatBytes(peak > 1 ? peak : 0)} per {formatSlice(range.bucketMs)}
          </div>
        </div>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-[150px] w-full" role="img">
          {[0.25, 0.5, 0.75].map((line) => (
            <line
              key={line}
              x1={0}
              x2={WIDTH}
              y1={HEIGHT * line}
              y2={HEIGHT * line}
              stroke="currentColor"
              strokeOpacity={0.08}
            />
          ))}
          {series.map((slice, index) => {
            let y = HEIGHT
            return (
              <g key={slice.time}>
                <title>
                  {when(slice.time, range.bucketMs)} · {formatBytes(sum(slice.byNetwork))}
                </title>
                {Object.entries(slice.byNetwork)
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([id, bytes]) => {
                    const height = (bytes / peak) * HEIGHT
                    y -= height
                    return (
                      <rect
                        key={id}
                        x={index * barWidth + 0.5}
                        y={y}
                        width={Math.max(1, barWidth - 1)}
                        height={height}
                        fill={visual(id).solid}
                      />
                    )
                  })}
              </g>
            )
          })}
        </svg>
        {series.length > 0 && (
          <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
            <span>{when(series[0].time, range.bucketMs)}</span>
            <span>now</span>
          </div>
        )}
      </div>

      <div className="text-[12px] font-medium text-muted-foreground">By connection</div>
      <div className="flex flex-col gap-1.5">
        {networks.length === 0 && (
          <div className="text-[12.5px] text-muted-foreground">
            Nothing downloaded in this time.
          </div>
        )}
        {networks.map(([id, bytes]) => (
          <div key={id} className="flex items-center gap-2 text-[12.5px]">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: visual(id).solid }}
            />
            <span className="w-32 shrink-0 truncate">{visual(id).name}</span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(bytes / Math.max(1, data?.total ?? 1)) * 100}%`,
                  background: visual(id).solid
                }}
              />
            </div>
            <span className="w-20 shrink-0 text-right tabular-nums">{formatBytes(bytes)}</span>
          </div>
        ))}
      </div>

      <div className="mt-1 text-[12px] font-medium text-muted-foreground">
        By file{network ? ` · ${visual(network).name}` : ''}
      </div>
      <div className="flex flex-col">
        {(data?.files ?? []).slice(0, 50).map((file) => (
          <div
            key={file.id}
            className="flex items-center gap-2 border-t-[0.5px] border-border py-1.5 text-[12.5px] first:border-t-0"
          >
            <span className="min-w-0 flex-1 truncate" title={file.name}>
              {file.name}
            </span>
            <span className="flex shrink-0 gap-0.5">
              {Object.entries(file.byNetwork).map(([id, bytes]) => (
                <span
                  key={id}
                  className="h-2 rounded-sm"
                  title={`${visual(id).name}: ${formatBytes(bytes)}`}
                  style={{
                    width: Math.max(4, (bytes / Math.max(1, file.bytes)) * 48),
                    background: visual(id).solid
                  }}
                />
              ))}
            </span>
            <span className="w-20 shrink-0 text-right tabular-nums">{formatBytes(file.bytes)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function sum(values: Record<string, number>): number {
  return Object.values(values).reduce((total, value) => total + value, 0)
}

function formatSlice(bucketMs: number): string {
  if (bucketMs >= DAY) return 'day'
  if (bucketMs >= HOUR) return `${bucketMs / HOUR} h`
  return `${bucketMs / MINUTE} min`
}
