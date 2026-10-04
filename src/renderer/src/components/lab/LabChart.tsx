import type { LabSample } from '@shared/lab'
import { NETWORK_COLOR_SWATCHES } from '../../theme'
import { formatSpeed } from '../../utils/format'
import { ThroughputChart } from '../ThroughputChart'

const WINDOW = 120

/** What the lab's server sent to each network, a second at a time. */
export function LabChart({
  samples,
  networks
}: {
  samples: LabSample[]
  networks: string[]
}): React.JSX.Element {
  // The server names an untagged request (a probe) by its address: not a network of the lab.
  const shown = networks.filter((id) => !/^\d+\.\d+\.\d+\.\d+$/.test(id))
  const recent = samples.slice(-WINDOW)
  const history = Object.fromEntries(
    shown.map((id) => [id, recent.map((sample) => sample.perNetwork[id] ?? 0)])
  )
  const order = shown.map((interfaceId, index) => ({
    interfaceId,
    solid: NETWORK_COLOR_SWATCHES[index % NETWORK_COLOR_SWATCHES.length].solid
  }))
  const latest = recent[recent.length - 1]
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">Speed from the lab server, per network</span>
        <span>last {Math.min(recent.length, WINDOW)} s</span>
      </div>
      <ThroughputChart order={order} historyByInterface={history} />
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {order.map((entry) => (
          <span key={entry.interfaceId} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: entry.solid }} />
            {entry.interfaceId}
            <span className="text-muted-foreground tabular-nums">
              {formatSpeed(latest?.perNetwork[entry.interfaceId] ?? 0)}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
