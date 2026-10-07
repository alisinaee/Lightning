import { formatSpeed } from '../utils/format'

/** How many seconds of speed the graph holds. */
export const HISTORY_POINTS = 60

/** The speed over the last minute as a small filled line. */
export function SpeedGraph({ points }: { points: number[] }): React.JSX.Element {
  const peak = Math.max(1, ...points)
  const width = 280
  const height = 44
  const step = width / (HISTORY_POINTS - 1)
  const offset = (HISTORY_POINTS - points.length) * step
  const coords = points.map(
    (value, index) =>
      `${(offset + index * step).toFixed(1)},${(height - 2 - (value / peak) * (height - 6)).toFixed(1)}`
  )
  return (
    <div>
      <svg
        role="img"
        aria-label="Total speed over the last minute"
        viewBox={`0 0 ${width} ${height}`}
        className="h-11 w-full text-primary"
        preserveAspectRatio="none"
      >
        {points.length > 1 && (
          <>
            <polygon
              points={`${offset},${height} ${coords.join(' ')} ${offset + (points.length - 1) * step},${height}`}
              fill="currentColor"
              opacity={0.15}
            />
            <polyline
              points={coords.join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>
      <div className="flex justify-between text-[10.5px] text-muted-foreground">
        <span>1 min ago</span>
        <span>peak {formatSpeed(peak === 1 ? 0 : peak)}</span>
        <span>now</span>
      </div>
    </div>
  )
}
