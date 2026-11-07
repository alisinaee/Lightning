import { MagnifyingGlass, type Icon } from '@phosphor-icons/react'
import { STATUS_STYLE, type StatusKey } from '../utils/status'

/** The picture on an empty list: the glyph of what is missing, in its colour, on a soft round tint. */
export function EmptyIcon({
  icon: Glyph,
  color
}: {
  icon: Icon
  color: string
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className="mb-1 flex size-14 items-center justify-center rounded-full"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 22%, transparent)`
      }}
    >
      <Glyph className="size-6" />
    </span>
  )
}

/** The empty-list picture for a status filter ('progress' and anything unknown fall back to
 * downloading); a search or a kind filter that finds nothing gets the magnifier. */
export function EmptyStatusIcon({
  status,
  searching
}: {
  status?: StatusKey | 'progress' | 'all'
  searching?: boolean
}): React.JSX.Element {
  if (searching || status === 'all' || status === undefined) {
    return <EmptyIcon icon={MagnifyingGlass} color="var(--text-secondary)" />
  }
  const style = STATUS_STYLE[status === 'progress' ? 'downloading' : status] ?? STATUS_STYLE.queued
  return <EmptyIcon icon={style.icon} color={style.color} />
}
