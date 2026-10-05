import { kindOfDownload } from '../../utils/fileKind'
import { describeItem, isFinished, statusKeyOf, type Item } from '../../utils/status'
import { sourceOf } from '../../utils/format'
import {
  Copy,
  ExternalLink,
  FolderOpen,
  Info,
  Link2,
  Pause,
  Play,
  RotateCw,
  Trash2,
  X
} from 'lucide-react'
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
import { FileKindIcon } from './FileKindIcon'
import {
  chipsOf,
  onControl,
  REVEAL_LABEL,
  ROW_CLASS,
  stateEdge,
  type RowHandlers
} from './rowHelpers'
import { RowActionsMenu, RowContextMenu, type RowAction } from './rowMenu'

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
  handlers,
  getVisual
}: {
  item: Item
  queuePosition?: number
  selected: boolean
  handlers: RowHandlers
  getVisual: ResolveNetworkVisual
  /** Changes when a network's name or colour does, so the row repaints. */
  visualsKey?: string
}): React.JSX.Element {
  const columns = useColumns()
  const info = describeItem(item, queuePosition)
  const kind = kindOfDownload(item)
  const finished = info.status === 'completed'
  const name = item.fileName
  const host = item.kind === 'torrent' ? 'Torrent' : sourceOf(item.url)
  const reveal = (): void => void window.plexo.revealDownload(item.id)
  const pause = (): void => void window.plexo.pauseDownload(item.id)
  const resume = (): void => void window.plexo.resumeDownload(item.id)

  const state = isFinished(item) ? null : item
  let primary: { label: string; icon?: RowAction['icon']; run: () => void } | null = null
  if (state) {
    if (state.status === 'downloading' || state.status === 'queued') {
      primary = { label: `Pause ${name}`, icon: Pause, run: pause }
    } else if (state.status === 'paused') {
      primary = { label: `Resume ${name}`, icon: Play, run: resume }
    } else if (state.status === 'error') {
      // Retry always tries the saved link first; Fix link is for when that link is refused.
      if (state.resumable !== false) {
        primary = { label: `Retry ${name}`, icon: RotateCw, run: resume }
      } else primary = { label: 'Download again', run: () => handlers.again(item) }
    }
  }
  const fixLink = state && state.status === 'error' && info.status === 'attention'
  if (finished && info.missing) {
    primary = { label: 'Download again', run: () => handlers.again(item) }
  }

  const menu: RowAction[] = []
  if (finished) {
    menu.push({
      id: 'open-file',
      label: 'Open file',
      icon: ExternalLink,
      disabled: info.missing,
      run: () => void window.plexo.openDownloadedFile(item.id)
    })
  }
  menu.push({
    id: 'reveal',
    label: REVEAL_LABEL,
    icon: FolderOpen,
    run: reveal,
    disabled: info.missing
  })
  menu.push({ id: 'details', label: 'Details', icon: Info, run: () => handlers.open(item.id) })
  if (primary && (state || info.missing)) {
    menu.push({
      id: 'primary',
      label: primary.label.startsWith('Pause')
        ? 'Pause'
        : primary.label.startsWith('Resume')
          ? 'Resume'
          : primary.label.startsWith('Retry')
            ? 'Retry'
            : primary.label,
      icon: primary.icon ?? Link2,
      run: primary.run,
      divider: true
    })
  }
  if (fixLink) {
    menu.push({ id: 'fix', label: 'Fix link', icon: Link2, run: () => handlers.fix(item) })
  }
  menu.push({
    id: 'copy',
    label: 'Copy link',
    icon: Copy,
    run: () => void navigator.clipboard.writeText(item.url).catch(() => {}),
    divider: !primary
  })
  if (finished) {
    menu.push({
      id: 'remove',
      label: 'Remove from list',
      icon: X,
      run: () => handlers.removeFromList(item),
      divider: true
    })
    if (!info.missing) {
      menu.push({
        id: 'trash',
        label: 'Delete file…',
        icon: Trash2,
        danger: true,
        run: () => handlers.trash(item)
      })
    }
  } else {
    menu.push({
      id: 'cancel',
      label: 'Cancel and delete partial data…',
      icon: Trash2,
      danger: true,
      run: () => handlers.cancel(item),
      divider: true
    })
  }

  const cells: Record<string, React.JSX.Element> = {
    name: (
      <div key="name" role="cell" className={cn(cellClass, 'gap-2.5')}>
        <FileKindIcon kind={kind} />
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
          <span className="truncate text-[11px] leading-none text-muted-foreground">
            {info.missing ? `${host} · The file was moved or deleted` : host}
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
          style={stateEdge(statusKeyOf(item))}
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
            {primary &&
              (primary.icon ? (
                <IconAction
                  label={primary.label}
                  tip={primary.label.split(' ')[0]}
                  icon={primary.icon}
                  onClick={primary.run}
                />
              ) : (
                <Button type="button" size="xs" variant="secondary" onClick={primary.run}>
                  {primary.label}
                </Button>
              ))}
            {fixLink && (
              <Button
                type="button"
                size="xs"
                variant="secondary"
                onClick={() => handlers.fix(item)}
              >
                Fix link
              </Button>
            )}
            {finished && !info.missing && (
              <IconAction
                label={`${REVEAL_LABEL} ${name}`}
                tip={REVEAL_LABEL}
                icon={FolderOpen}
                onClick={reveal}
              />
            )}
            <RowActionsMenu label={name} actions={menu} />
          </div>
        </div>
      }
    />
  )
})
