import type { RowInfo } from '../../utils/status'
import { statusStyle } from '../../utils/status'
import { useAppStore } from '../../store/useAppStore'
import { SELECT_WIDTH } from './columns'

/** A thin line along the bottom of a row that fills as the download goes, in its status colour:
 * progress down a whole list at a glance. Not drawn for a finished row, one with nothing to
 * measure, or when Settings → Interface has it off. Laid over the row's own bottom edge, so it
 * never changes the row's height. It starts where the Name column starts (after the select
 * checkbox column) and runs to the row's right edge. */
export function RowProgressLine({ info }: { info: RowInfo }): React.JSX.Element | null {
  const on = useAppStore((store) => store.progressLine)
  if (!on || !info.bar || info.status === 'completed') return null
  const color = statusStyle(info.missing ? 'attention' : info.status).color
  const running = info.status === 'downloading'
  return (
    <span
      role="progressbar"
      aria-label="Progress"
      aria-valuenow={Math.round(info.percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="pointer-events-none absolute bottom-0 right-0 z-[1] h-[2.5px] bg-[color-mix(in_srgb,var(--text-secondary)_14%,transparent)]"
      style={{ left: SELECT_WIDTH }}
    >
      <span
        className="block h-full rounded-r-full transition-[width] duration-500"
        style={{
          width: `${Math.max(1, info.percent)}%`,
          background: color,
          opacity: running ? 1 : 0.6
        }}
      />
    </span>
  )
}
