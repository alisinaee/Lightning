import { cn } from 'cn'
import { Archive, Layers, type LucideIcon } from 'lucide-react'
import type { DownloadFilter } from '../../store/useAppStore'
import type { ListCounts } from '../../utils/downloadList'
import { FILE_KINDS, type FileKind } from '../../utils/fileKind'
import { statusStyle, type StatusKey } from '../../utils/status'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { FileKindIcon } from './FileKindIcon'

const STATUSES: {
  value: DownloadFilter
  label: string
  icon: LucideIcon
  color?: string
  status?: StatusKey
}[] = [
  { value: 'all', label: 'All downloads', icon: Layers },
  ...(
    [
      ['downloading', 'Downloading', 'downloading'],
      ['queued', 'Queued', 'queued'],
      ['paused', 'Paused', 'paused'],
      ['finished', 'Completed', 'completed'],
      ['failed', 'Failed', 'failed']
    ] as [DownloadFilter, string, StatusKey][]
  ).map(([value, label, status]) => ({
    value,
    label,
    icon: statusStyle(status).icon,
    color: statusStyle(status).color,
    status
  }))
]

function Item({
  active,
  onClick,
  count,
  title,
  children
}: {
  active: boolean
  onClick: () => void
  count: number
  title?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      title={title}
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[12.5px] outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring',
        active && 'bg-primary/10 font-semibold hover:bg-primary/15'
      )}
    >
      {children}
      <span
        className={cn(
          'font-mono text-[11px] tabular-nums',
          count === 0 ? 'text-muted-foreground/60' : 'text-muted-foreground'
        )}
      >
        {count}
      </span>
    </button>
  )
}

const labelClass =
  'px-2 pt-3 pb-1 font-mono text-[10px] leading-none tracking-[0.16em] text-muted-foreground uppercase'

/** Categories down the left: by status, and by kind of file. Each filters the table. */
export function DownloadsSidebar({
  counts,
  filter,
  kind,
  onFilter,
  onKind,
  canClear,
  onClear
}: {
  counts: ListCounts
  filter: DownloadFilter
  kind: FileKind | null
  onFilter: (filter: DownloadFilter) => void
  onKind: (kind: FileKind | null) => void
  canClear: boolean
  onClear: () => void
}): React.JSX.Element {
  return (
    <nav
      aria-label="Download categories"
      className="hidden w-[184px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r-[0.5px] border-border p-2 @min-[820px]:flex"
    >
      <div className={labelClass}>Status</div>
      {STATUSES.map((entry) => {
        const Icon = entry.icon
        return (
          <Item
            key={entry.value}
            active={filter === entry.value}
            count={counts.statuses[entry.value] ?? 0}
            title={entry.value === 'failed' ? 'Failed, or needing a new link' : undefined}
            onClick={() => onFilter(entry.value)}
          >
            <Icon
              aria-hidden
              className="size-4 shrink-0"
              style={{ color: entry.color ?? 'var(--text-secondary)' }}
            />
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
          </Item>
        )
      })}
      <div className={labelClass}>File type</div>
      {FILE_KINDS.map((entry) => (
        <Item
          key={entry.kind}
          active={kind === entry.kind}
          count={counts.kinds[entry.kind] ?? 0}
          onClick={() => onKind(kind === entry.kind ? null : entry.kind)}
        >
          <FileKindIcon kind={entry.kind} size="sm" className="size-5 [&>svg]:size-3" />
          <span className="min-w-0 flex-1 truncate">{entry.label}</span>
        </Item>
      ))}
      <div className="flex-1" />
      {canClear && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onClear}
                className="mt-2 flex h-8 items-center gap-2 rounded-md px-2 text-left text-[12px] text-[var(--text-secondary)] outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Archive aria-hidden className="size-3.5" />
                Clear finished list
              </button>
            }
          />
          <TooltipContent>Downloaded files stay on your computer</TooltipContent>
        </Tooltip>
      )}
    </nav>
  )
}
