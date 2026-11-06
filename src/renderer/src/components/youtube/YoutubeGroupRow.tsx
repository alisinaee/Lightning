import { memo, type CSSProperties } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react'
import type { YoutubeJob } from '@shared/youtube'
import { ROW_CLASS, stateEdge } from '../downloads/rowHelpers'
import { RowProgressLine } from '../downloads/RowProgressLine'
import {
  AddedCell,
  ClippedText,
  EtaCell,
  SizeCell,
  SpeedCell,
  StatusCell,
  cellClass
} from '../downloads/cells'
import { Button } from '../ui/button'
import { useYoutubeStore } from '../../store/useYoutubeStore'
import { describeYoutubeGroup, YOUTUBE_COLUMNS } from './youtubeRowModel'
import { cn } from 'cn'

/** A playlist's header row, like a Downloads group: its title, its counts and overall progress,
 * with a chevron to show or hide its videos. */
export const YoutubeGroupRow = memo(function YoutubeGroupRow({
  title,
  jobs,
  expanded,
  onToggle
}: {
  title: string
  jobs: YoutubeJob[]
  expanded: boolean
  onToggle: () => void
}): React.JSX.Element {
  const revealJob = useYoutubeStore((store) => store.revealJob)
  const info = describeYoutubeGroup(jobs)
  const finished = info.status === 'completed'
  const first = jobs.find((job) => job.status === 'completed') ?? jobs[0]
  const Chevron = expanded ? ChevronDown : ChevronRight
  const FolderIcon = finished ? FolderOpen : Folder

  return (
    <div
      role="row"
      aria-expanded={expanded}
      data-status={info.status}
      className={cn(ROW_CLASS, 'bg-muted/30 font-medium')}
      style={{ '--cols': YOUTUBE_COLUMNS, ...stateEdge(info.status) } as CSSProperties}
    >
      <RowProgressLine info={info} />
      <div role="cell" className="flex items-center justify-center" />
      <div role="cell" className={cn(cellClass, 'gap-2 pl-0')}>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={expanded ? `Hide videos of ${title}` : `Show videos of ${title}`}
          onClick={onToggle}
        >
          <Chevron />
        </Button>
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <ClippedText text={title} className="text-[13px] leading-none font-semibold" />
          <span className="truncate text-[11px] leading-none text-muted-foreground">
            {jobs.length} {jobs.length === 1 ? 'video' : 'videos'} · Playlist
          </span>
        </div>
      </div>
      <SizeCell received={info.received} total={info.total} running={!finished} done={finished} />
      <StatusCell info={info} />
      <SpeedCell speed={info.speed} />
      <EtaCell seconds={info.etaSeconds} />
      <AddedCell at={info.addedAt} />
      <div role="cell" className="flex items-center justify-end gap-0.5 px-1.5">
        {first && (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Show ${title} in its folder`}
            onClick={() => revealJob(first.id)}
          >
            <FolderOpen />
          </Button>
        )}
      </div>
    </div>
  )
})
