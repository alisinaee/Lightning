import { memo, useState, type CSSProperties } from 'react'
import {
  Copy,
  ArrowSquareOut as ExternalLink,
  FolderOpen,
  Pause,
  Play,
  ArrowClockwise as RotateCw,
  Trash as Trash2,
  X
} from '@phosphor-icons/react'
import type { YoutubeJob } from '@shared/youtube'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { RowActionsMenu, RowContextMenu, type RowAction } from '../downloads/rowMenu'
import { onControl, ROW_CLASS, stateEdge } from '../downloads/rowHelpers'
import { RowProgressLine } from '../downloads/RowProgressLine'
import { FormatBadge } from '../downloads/FileKindIcon'
import {
  AddedCell,
  ClippedText,
  EtaCell,
  SizeCell,
  SpeedCell,
  StatusCell,
  cellClass
} from '../downloads/cells'
import { useYoutubeStore } from '../../store/useYoutubeStore'
import { describeYoutubeJob, useYoutubeColumns } from './youtubeRowModel'
import { YoutubeJobDetails } from './YoutubeJobDetails'
import { explainYoutubeError } from './youtubeErrors'
import { cn } from 'cn'
import type { Icon } from '@phosphor-icons/react'

/** A row's main action as an icon, the same look as the Downloads rows. */
function IconAction({
  label,
  icon: Icon,
  onClick
}: {
  label: string
  icon: Icon
  onClick: () => void
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
            className="text-muted-foreground hover:text-foreground"
          >
            <Icon />
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export const YoutubeJobRow = memo(function YoutubeJobRow({
  job,
  nested = false,
  selected = false,
  onSelect
}: {
  job: YoutubeJob
  /** Shown under its playlist's group row, so the name is indented. */
  nested?: boolean
  selected?: boolean
  onSelect?: (on: boolean) => void
}): React.JSX.Element {
  const pauseJob = useYoutubeStore((store) => store.pauseJob)
  const resumeJob = useYoutubeStore((store) => store.resumeJob)
  const cancelJob = useYoutubeStore((store) => store.cancelJob)
  const retryJob = useYoutubeStore((store) => store.retryJob)
  const removeJob = useYoutubeStore((store) => store.removeJob)
  const revealJob = useYoutubeStore((store) => store.revealJob)
  const openJob = useYoutubeStore((store) => store.openJob)

  const columns = useYoutubeColumns()
  const [expanded, setExpanded] = useState(false)
  const info = describeYoutubeJob(job)
  const active = job.status === 'queued' || job.status === 'downloading'
  const finished = job.status === 'completed'
  const fileName = `${job.title}.${job.resolution === 'Audio' ? 'm4a' : 'mp4'}`

  // The main action, as on a Downloads row: open when done, retry when failed, pause or resume otherwise.
  const primary: { label: string; icon: Icon; run: () => void } | null = finished
    ? { label: 'Open', icon: ExternalLink, run: () => openJob(job.id) }
    : job.status === 'downloading' || job.status === 'queued'
      ? { label: 'Pause', icon: Pause, run: () => void pauseJob(job.id) }
      : job.status === 'paused'
        ? { label: 'Resume', icon: Play, run: () => void resumeJob(job.id) }
        : job.status === 'error' || job.status === 'cancelled'
          ? { label: 'Try again', icon: RotateCw, run: () => void retryJob(job.id) }
          : null

  const actions: RowAction[] = [
    ...(finished
      ? [{ id: 'open', label: 'Open', icon: ExternalLink, run: () => openJob(job.id) }]
      : []),
    { id: 'reveal', label: 'Show in Folder', icon: FolderOpen, run: () => revealJob(job.id) },
    ...(active
      ? [{ id: 'pause', label: 'Pause', icon: Pause, run: () => void pauseJob(job.id) }]
      : []),
    ...(job.status === 'paused'
      ? [{ id: 'resume', label: 'Resume', icon: Play, run: () => void resumeJob(job.id) }]
      : []),
    ...(job.status === 'error' || job.status === 'cancelled'
      ? [{ id: 'retry', label: 'Try again', icon: RotateCw, run: () => void retryJob(job.id) }]
      : []),
    {
      id: 'copy',
      label: 'Copy link',
      icon: Copy,
      run: () => void navigator.clipboard.writeText(job.url)
    },
    ...(active
      ? [
          {
            id: 'cancel',
            label: 'Cancel',
            icon: X,
            danger: true,
            divider: true,
            run: () => void cancelJob(job.id)
          }
        ]
      : []),
    {
      id: 'remove',
      label: 'Remove from list',
      icon: Trash2,
      danger: true,
      divider: !active,
      run: () => void removeJob(job.id, false)
    }
  ]

  const row = (
    <div
      role="row"
      data-row-entry={job.id}
      aria-expanded={expanded}
      onClick={(event) => {
        if (!onControl(event.target)) setExpanded((open) => !open)
      }}
      data-status={info.status}
      className={cn(ROW_CLASS, selected && 'bg-primary/10 hover:bg-primary/15')}
      style={{ '--cols': columns.template, ...stateEdge(info.status) } as CSSProperties}
    >
      <RowProgressLine info={info} />
      <div role="cell" className="flex items-center justify-center">
        <Checkbox
          aria-label={`Select ${job.title}`}
          checked={selected}
          onCheckedChange={(on) => onSelect?.(on)}
        />
      </div>
      <div role="cell" className={cn(cellClass, 'gap-2.5', nested ? 'pl-8' : 'pl-0')}>
        <FormatBadge name={fileName} />
        <button
          type="button"
          data-title
          aria-label={finished ? `Open ${job.title}` : job.title}
          disabled={!finished}
          onClick={() => finished && openJob(job.id)}
          className="flex min-w-0 flex-1 flex-col gap-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
        >
          <ClippedText
            text={job.title}
            className={cn(
              'font-sans text-[13px] leading-none font-medium',
              finished && 'text-[var(--text-secondary)]'
            )}
          />
          {/* A non-breaking space when empty, so the row keeps its height, as on Downloads rows. */}
          <span className="truncate text-[11px] leading-none text-muted-foreground">
            {[
              'YouTube',
              job.resolution,
              job.error && job.status === 'error' ? explainYoutubeError(job.error).summary : ''
            ]
              .filter(Boolean)
              .join(' · ') || ' '}
          </span>
        </button>
      </div>
      <SizeCell received={info.received} total={info.total} running={active} done={finished} />
      <StatusCell info={info} />
      <SpeedCell speed={info.speed} />
      {columns.eta && <EtaCell seconds={info.etaSeconds} />}
      {columns.added && (
        <AddedCell at={finished ? (job.finishedAt ?? job.createdAt) : job.createdAt} />
      )}
      <div role="cell" className="flex items-center justify-end gap-0.5 pl-1.5 pr-4">
        {primary && <IconAction label={primary.label} icon={primary.icon} onClick={primary.run} />}
        {finished && (
          <IconAction label="Show in Folder" icon={FolderOpen} onClick={() => revealJob(job.id)} />
        )}
        <RowActionsMenu label={job.title} actions={actions} />
      </div>
    </div>
  )

  return (
    <>
      <RowContextMenu actions={actions} row={row} />
      {expanded && <YoutubeJobDetails job={job} />}
    </>
  )
})
