import type { TdlItem, TdlJob } from '@shared/telegram'
import { cn } from 'cn'
import { Copy, FolderOpen, ArrowSquareOut as SquareArrowOutUpRight } from '@phosphor-icons/react'
import { memo } from 'react'
import { Checkbox } from '../ui/checkbox'
import {
  AddedCell,
  ClippedText,
  EtaCell,
  SizeCell,
  SpeedCell,
  StatusCell,
  cellClass
} from '../downloads/cells'
import { FormatBadge } from '../downloads/FileKindIcon'
import { onControl, REVEAL_LABEL, ROW_CLASS, stateEdge } from '../downloads/rowHelpers'
import { RowActionsMenu, RowContextMenu, type RowAction } from '../downloads/rowMenu'
import { RowProgressLine } from '../downloads/RowProgressLine'
import { fileKindOfMedia, itemInfo, jobActions, useTelegramColumns } from './telegramRowInfo'

/** One file of a Telegram job. Alone in its job it is the whole row (and has the job's menu and
 * checkbox); inside a group it is indented under the header. */
export const TelegramItemRow = memo(function TelegramItemRow({
  job,
  item,
  nested,
  selected,
  onSelect
}: {
  job: TdlJob
  item: TdlItem
  nested?: boolean
  selected?: boolean
  onSelect?: (on: boolean) => void
}): React.JSX.Element {
  const columns = useTelegramColumns()
  const info = itemInfo(job, item)
  const finished = info.status === 'completed'
  const hasFile = item.status === 'done' && Boolean(item.path)

  const actions: RowAction[] = []
  if (hasFile) {
    actions.push(
      {
        id: 'open',
        label: 'Open file',
        icon: SquareArrowOutUpRight,
        run: () => void window.lightning.tdlOpenItem(job.id, item.key)
      },
      {
        id: 'reveal',
        label: REVEAL_LABEL,
        icon: FolderOpen,
        run: () => void window.lightning.tdlRevealItem(job.id, item.key)
      }
    )
  }
  if (item.link) {
    const link = item.link
    actions.push({
      id: 'copy',
      label: 'Copy link',
      icon: Copy,
      run: () => void navigator.clipboard.writeText(link).catch(() => {})
    })
  }
  // A lone file is its job: the job's controls belong to it.
  if (!nested) {
    const own = jobActions(job)
    if (own.length > 0 && actions.length > 0) own[0] = { ...own[0], divider: true }
    actions.push(...own)
  }

  const subtitle = item.error && item.status === 'failed' ? '' : (item.link ?? job.dir)
  return (
    <RowContextMenu
      actions={actions}
      row={
        <div
          role="row"
          data-row-entry={job.id}
          data-status={info.status}
          data-selected={selected || undefined}
          onClick={(event) => {
            if (!onControl(event.target) && onSelect) onSelect(!selected)
          }}
          onDoubleClick={(event) => {
            if (hasFile && !onControl(event.target)) {
              void window.lightning.tdlOpenItem(job.id, item.key)
            }
          }}
          className={cn(ROW_CLASS, selected && 'bg-primary/10 hover:bg-primary/15')}
          style={{
            ...stateEdge(info.status, selected),
            gridTemplateColumns: columns.template
          }}
        >
          <RowProgressLine info={info} />
          <div role="cell" className="flex items-center justify-center">
            {!nested && (
              <Checkbox
                aria-label={`Select ${item.fileName}`}
                checked={Boolean(selected)}
                onCheckedChange={(on) => onSelect?.(on)}
              />
            )}
          </div>
          <div role="cell" className={cn(cellClass, 'gap-2.5 pl-0', nested && 'pl-7')}>
            <FormatBadge name={item.fileName} kind={fileKindOfMedia(item.media)} />
            <div data-title className="flex min-w-0 flex-1 flex-col gap-1">
              <ClippedText
                text={item.fileName}
                className={cn(
                  'font-sans text-[13px] leading-none font-medium',
                  finished && 'text-[var(--text-secondary)]'
                )}
              />
              <span className="truncate text-[11px] leading-none text-muted-foreground">
                {subtitle || ' '}
              </span>
            </div>
          </div>
          <SizeCell
            received={info.received}
            total={info.total}
            running={!finished}
            done={finished}
          />
          <StatusCell info={info} />
          <SpeedCell speed={info.speed} />
          {columns.eta && <EtaCell seconds={info.etaSeconds} />}
          {columns.added && (
            <AddedCell at={finished ? (info.completedAt ?? info.addedAt) : info.addedAt} />
          )}
          <div role="cell" className="flex items-center justify-end gap-0.5 pl-1.5 pr-4">
            {actions.length > 0 && <RowActionsMenu label={item.fileName} actions={actions} />}
          </div>
        </div>
      }
    />
  )
})
