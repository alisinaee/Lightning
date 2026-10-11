import { describeItem, statusKeyOf, type Item } from '../../utils/status'
import { sourceOf } from '../../utils/format'
import { useAppStore } from '../../store/useAppStore'
import { Download, FolderOpen, Link2 } from 'lucide-react'
import { cn } from 'cn'
import { memo } from 'react'
import type { ResolveNetworkVisual } from '../../hooks/useNetworkVisuals'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { useColumns } from './columns'
import {
  AddedCell,
  ClippedText,
  ConnectionsCell,
  EtaCell,
  SizeCell,
  SpeedCell,
  StatusCell,
  cellClass
} from './cells'
import { FormatBadge } from './FileKindIcon'
import {
  chipsOf,
  onControl,
  REVEAL_LABEL,
  ROW_CLASS,
  stateEdge,
  type RowHandlers
} from './rowHelpers'
import { RowActionsMenu, RowContextMenu, type RowAction } from './rowMenu'
import { buildDownloadActions, fixLinkOf, primaryActionOf } from './rowActions'

function IconAction({
  label,
  tip,
  icon: Icon,
  onClick,
  className
}: {
  label: string
  /** What the tooltip says: the label without the file's name. */
  tip: string
  icon: RowAction['icon']
  onClick: () => void
  className?: string
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={label}
            onClick={onClick}
            className={cn('text-muted-foreground hover:text-foreground', className)}
          >
            <Icon />
          </Button>
        }
      />
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

export const DownloadRow = memo(function DownloadRow({
  item,
  queuePosition,
  selected,
  hit,
  handlers,
  getVisual
}: {
  item: Item
  queuePosition?: number
  selected: boolean
  /** The search found this file. */
  hit?: boolean
  handlers: RowHandlers
  getVisual: ResolveNetworkVisual
  /** Changes when a network's name or colour does, so the row repaints. */
  visualsKey?: string
}): React.JSX.Element {
  const columns = useColumns()
  const info = describeItem(item, queuePosition)
  const finished = info.status === 'completed'
  const name = item.fileName
  const showSourceHost = useAppStore((store) => store.showSourceHost)
  // A torrent's label stays; only the website is left out when it is turned off.
  const host = item.kind === 'torrent' ? 'Torrent' : showSourceHost ? sourceOf(item.url) : ''
  const primary = primaryActionOf(item, info, handlers)
  const fixLink = fixLinkOf(item, info)
  const menu = buildDownloadActions({ item, info, handlers, primary, fixLink })

  const cells: Record<string, React.JSX.Element> = {
    name: (
      <div key="name" role="cell" className={cn(cellClass, 'gap-2.5 pl-0')}>
        <FormatBadge name={name} kind={item.kind === 'torrent' ? 'torrent' : undefined} />
        <button
          type="button"
          aria-label={`Open ${name}`}
          onClick={(event) => {
            if (event.shiftKey) handlers.click(item.id, 'range')
            else if (event.metaKey || event.ctrlKey) handlers.click(item.id, 'toggle')
            else handlers.open(item.id)
          }}
          className="flex min-w-0 flex-1 flex-col gap-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ClippedText
            text={name}
            className={cn(
              'font-sans text-[13px] leading-none font-medium',
              finished && 'text-[var(--text-secondary)]'
            )}
          />
          {/* A non-breaking space when empty, so the row keeps its height without the host. */}
          <span className="truncate text-[11px] leading-none text-muted-foreground">
            {[host, info.missing && 'The file was moved or deleted'].filter(Boolean).join(' · ') ||
              ' '}
          </span>
        </button>
      </div>
    ),
    size: (
      <SizeCell
        key="size"
        received={info.received}
        total={info.total}
        running={!finished}
        done={finished}
      />
    ),
    status: <StatusCell key="status" info={info} />,
    speed: <SpeedCell key="speed" speed={info.speed} />,
    eta: <EtaCell key="eta" seconds={info.etaSeconds} />,
    added: (
      <AddedCell key="added" at={finished ? (info.completedAt ?? info.addedAt) : info.addedAt} />
    ),
    connections: <ConnectionsCell key="connections" chips={chipsOf(item, getVisual)} />
  }

  return (
    <RowContextMenu
      actions={menu}
      row={
        <div
          role="row"
          data-row-entry={item.id}
          data-file-id={item.id}
          data-hit={hit ? 'true' : undefined}
          data-selected={selected || undefined}
          data-status={info.status}
          onClick={(event) => {
            if (onControl(event.target)) return
            handlers.click(
              item.id,
              event.shiftKey ? 'range' : event.metaKey || event.ctrlKey ? 'toggle' : 'only'
            )
          }}
          onDoubleClick={(event) => {
            if (!onControl(event.target)) handlers.open(item.id)
          }}
          className={cn(
            ROW_CLASS,
            info.missing && 'text-muted-foreground opacity-70',
            selected && 'bg-primary/10 hover:bg-primary/15'
          )}
          style={stateEdge(statusKeyOf(item), selected)}
        >
          <div role="cell" className="flex items-center justify-center">
            <Checkbox
              aria-label={`Select ${name}`}
              checked={selected}
              onCheckedChange={(on) => handlers.select(item.id, on)}
            />
          </div>
          {columns.map((id) => cells[id])}
          <div role="cell" className="flex items-center justify-end gap-0.5 px-1.5">
            {primary && (
              <IconAction
                label={primary.label}
                tip={
                  primary.label.startsWith('Download') ? primary.label : primary.label.split(' ')[0]
                }
                icon={primary.icon ?? Download}
                onClick={primary.run}
              />
            )}
            {fixLink && (
              <IconAction
                label="Fix link"
                tip="Fix link"
                icon={Link2}
                onClick={() => handlers.fix(item)}
              />
            )}
            {finished && !info.missing && (
              <IconAction
                label={`${REVEAL_LABEL} ${name}`}
                tip={REVEAL_LABEL}
                icon={FolderOpen}
                onClick={() => void window.lightning.revealDownload(item.id)}
              />
            )}
            <RowActionsMenu label={name} actions={menu} />
          </div>
        </div>
      }
    />
  )
})
