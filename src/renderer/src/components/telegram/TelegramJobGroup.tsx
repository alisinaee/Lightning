import type { TdlItem, TdlJob } from '@shared/telegram'
import { cn } from 'cn'
import { ChevronDown, ChevronRight, Folder } from 'lucide-react'
import { memo } from 'react'
import { toDisplayPath } from '../../utils/format'
import { useAppStore } from '../../store/useAppStore'
import { Checkbox } from '../ui/checkbox'
import { Badge } from '../ui/badge'
import {
  AddedCell,
  ClippedText,
  EtaCell,
  SizeCell,
  SpeedCell,
  StatusCell,
  cellClass
} from '../downloads/cells'
import { FileKindIcon } from '../downloads/FileKindIcon'
import { onControl, ROW_CLASS, stateEdge } from '../downloads/rowHelpers'
import { RowActionsMenu, RowContextMenu } from '../downloads/rowMenu'
import { RowProgressLine } from '../downloads/RowProgressLine'
import { TelegramItemRow } from './TelegramItemRow'
import { jobActions, jobInfo, jobTitle, useTelegramColumns } from './telegramRowInfo'

/** A job with several files, as a collapsible folder row that sums its files' progress. `items`
 * are the ones the filters let through. */
export const TelegramJobGroup = memo(function TelegramJobGroup({
  job,
  items,
  open,
  selected,
  onToggle,
  onSelect
}: {
  job: TdlJob
  items: TdlItem[]
  open: boolean
  selected: boolean
  onToggle: () => void
  onSelect: (on: boolean) => void
}): React.JSX.Element {
  const columns = useTelegramColumns()
  const homeDir = useAppStore((store) => store.homeDir)
  const info = jobInfo(job, items)
  const title = jobTitle(job)
  const actions = jobActions(job)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <>
      <RowContextMenu
        actions={actions}
        row={
          <div
            role="row"
            data-row-entry={job.id}
            aria-expanded={open}
            data-status={info.status}
            data-selected={selected || undefined}
            onClick={(event) => {
              if (!onControl(event.target)) onToggle()
            }}
            className={cn(ROW_CLASS, selected && 'bg-primary/10 hover:bg-primary/15')}
            style={{ ...stateEdge(info.status, selected), gridTemplateColumns: columns.template }}
          >
            <RowProgressLine info={info} />
            <div role="cell" className="flex items-center justify-center">
              <Checkbox
                aria-label={`Select ${title}`}
                checked={selected}
                onCheckedChange={onSelect}
              />
            </div>
            <div role="cell" className={cn(cellClass, 'gap-2.5 pl-0')}>
              <button
                type="button"
                aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
                onClick={onToggle}
                className="flex size-6 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Chevron aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </button>
              <FileKindIcon kind="other" icon={Folder} />
              <div data-title className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex min-w-0 items-center gap-2">
                  <ClippedText
                    text={title}
                    className="font-sans text-[13px] leading-none font-medium"
                  />
                  <Badge variant="secondary" className="shrink-0">
                    {items.length === job.items.length
                      ? items.length
                      : `${items.length} of ${job.items.length}`}
                  </Badge>
                </span>
                <span className="truncate text-[11px] leading-none text-muted-foreground">
                  {toDisplayPath(job.dir, homeDir)}
                </span>
              </div>
            </div>
            <SizeCell
              received={info.received}
              total={info.total}
              running={info.status !== 'completed'}
              done={info.status === 'completed'}
            />
            <StatusCell info={info} />
            <SpeedCell speed={info.speed} />
            {columns.eta && <EtaCell seconds={info.etaSeconds} />}
            {columns.added && <AddedCell at={info.addedAt} />}
            <div role="cell" className="flex items-center justify-end gap-0.5 px-1.5">
              <RowActionsMenu label={title} actions={actions} />
            </div>
          </div>
        }
      />
      {open && items.map((item) => <TelegramItemRow key={item.key} job={job} item={item} nested />)}
    </>
  )
})
