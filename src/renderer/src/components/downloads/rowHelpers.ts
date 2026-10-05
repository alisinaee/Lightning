import type { DownloadState } from '@shared/types'
import type { ResolveNetworkVisual } from '../../hooks/useNetworkVisuals'
import { connectionsOf } from '../../utils/format'
import { isFinished, statusStyle, STATUS_STYLE, type Item } from '../../utils/status'
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

export const FINDER = window.lightning.platform === 'darwin' ? 'Finder' : 'folder'
export const REVEAL_LABEL = `Show in ${FINDER}`

export const ROW_CLASS =
  'group/row relative grid h-11 items-center group-data-[wrap=true]/table:h-auto group-data-[wrap=true]/table:min-h-11 group-data-[wrap=true]/table:py-1.5 bg-[var(--row-tint,transparent)] border-b-[0.5px] border-border/70 text-[13px] [content-visibility:auto] [contain-intrinsic-size:auto_44px] [grid-template-columns:var(--cols)] hover:bg-secondary focus-within:bg-secondary data-[status=downloading]:bg-primary/[0.07] data-[status=downloading]:hover:bg-primary/[0.12] data-[status=downloading]:data-[selected]:bg-primary/15'

/** A thin colour down the row's left edge says how it is doing without reading the Status cell. */
export function stateEdge(
  status: keyof typeof STATUS_STYLE,
  selected = false
): React.CSSProperties | undefined {
  if (status === 'downloading') {
    // What is moving right now stands out from the rest of the list by a tint of its colour.
    return {
      boxShadow: `inset 2px 0 0 ${statusStyle(status).color}`,
      ...(selected
        ? {}
        : ({
            '--row-tint': `color-mix(in srgb, ${statusStyle(status).color} 9%, transparent)`
          } as React.CSSProperties))
    }
  }
  return status === 'failed' || status === 'attention'
    ? { boxShadow: `inset 2px 0 0 ${statusStyle(status).color}` }
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
