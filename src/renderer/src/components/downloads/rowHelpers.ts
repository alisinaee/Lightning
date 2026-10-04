import type { DownloadState } from '@shared/types'
import type { ResolveNetworkVisual } from '../../hooks/useNetworkVisuals'
import { connectionsOf } from '../../utils/format'
import { isFinished, STATUS_STYLE, type Item } from '../../utils/status'
import type { ConnectionChip } from './cells'

/** What a row can ask of the screen around it. One stable object, so rows stay memoized. */
export interface RowHandlers {
  /** A click on the row: replace the selection, toggle (Ctrl/⌘) or extend it (Shift). */
  click: (id: string, mode: 'only' | 'toggle' | 'range') => void
  select: (id: string, on: boolean) => void
  open: (id: string) => void
  fix: (item: Item) => void
  again: (item: Item) => void
  /** Cancel an unfinished download (confirmed first) */
  cancel: (item: Item) => void
  removeFromList: (item: Item) => void
  trash: (item: Item) => void
}

export const FINDER = window.plexo.platform === 'darwin' ? 'Finder' : 'folder'
export const REVEAL_LABEL = `Show in ${FINDER}`

export const ROW_CLASS =
  'group/row relative grid h-11 items-center border-b-[0.5px] border-border/70 text-[13px] [content-visibility:auto] [contain-intrinsic-size:auto_44px] [grid-template-columns:var(--cols)] hover:bg-secondary focus-within:bg-secondary'

/** A thin colour down the row's left edge says how it is doing without reading the Status cell. */
export function stateEdge(status: keyof typeof STATUS_STYLE): React.CSSProperties | undefined {
  return status === 'downloading' || status === 'failed' || status === 'attention'
    ? { boxShadow: `inset 2px 0 0 ${STATUS_STYLE[status].color}` }
    : undefined
}

/** Ignore a click that started on a control inside the row. */
export function onControl(target: EventTarget): boolean {
  return target instanceof Element && target.closest('button, a, input, [role=checkbox]') !== null
}

export function chipsOf(
  item: DownloadState | Item,
  getVisual: ResolveNetworkVisual
): ConnectionChip[] {
  const running = !isFinished(item) && item.status === 'downloading'
  return connectionsOf(item.networks)
    .filter((network) =>
      isFinished(item) || item.status === 'completed'
        ? network.bytesDownloaded > 0
        : network.enabled
    )
    .map((network) => {
      const visual = getVisual(network.id, network.kind, network.label)
      return {
        id: network.id,
        name: visual.name,
        color: visual.solid,
        speed: running ? network.speedBytesPerSec : 0
      }
    })
}
