import { cn } from 'cn'
import { Archive, Layers, PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
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
  label,
  collapsed,
  children
}: {
  active: boolean
  onClick: () => void
  count: number
  title?: string
  label: string
  collapsed: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const hint = collapsed ? `${label} (${count})` : title
  const button = (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      aria-label={collapsed ? `${label}, ${count}` : undefined}
      onClick={onClick}
      className={cn(
        // One weight in every state: a bolder active item is wider, so its row reflowed.
        collapsed
          ? 'flex h-8 w-full items-center justify-center rounded-md'
          : 'flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[12.5px] font-medium outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-primary/10 text-foreground hover:bg-primary/15'
          : 'text-[var(--text-secondary)]'
      )}
    >
      {children}
      {!collapsed && (
        <span
          className={cn(
            'font-mono text-[11px] tabular-nums',
            count === 0 ? 'text-muted-foreground/60' : 'text-muted-foreground'
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
  if (!hint) return button
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="right">{hint}</TooltipContent>
    </Tooltip>
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
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('lightning.sidebar') === 'min'
  )
  const toggle = (): void => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('lightning.sidebar', next ? 'min' : 'full')
  }
  const Toggle = collapsed ? PanelLeftOpen : PanelLeftClose
  const section = (text: string): React.JSX.Element =>
    collapsed ? (
      <div aria-hidden className="mx-2 mt-2 mb-1 h-px bg-border" />
    ) : (
      <div className={labelClass}>{text}</div>
    )
  return (
    <nav
      aria-label="Download categories"
      className={cn(
        'flex shrink-0 flex-col gap-0.5 overflow-y-auto overflow-x-hidden border-r-[0.5px] border-border p-2',
        collapsed ? 'w-14' : 'w-[184px]'
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={toggle}
              aria-label={collapsed ? 'Expand side panel' : 'Collapse side panel'}
              aria-expanded={!collapsed}
              className={cn(
                'flex h-8 shrink-0 items-center rounded-md text-[var(--text-secondary)] outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                collapsed ? 'w-full justify-center' : 'w-8 justify-center self-end'
              )}
            >
              <Toggle aria-hidden className="size-4" />
            </button>
          }
        />
        <TooltipContent side="right">
          {collapsed ? 'Expand side panel' : 'Collapse side panel'}
        </TooltipContent>
      </Tooltip>
      {section('Status')}
      {STATUSES.map((entry) => {
        const Icon = entry.icon
        return (
          <Item
            key={entry.value}
            active={filter === entry.value}
            count={counts.statuses[entry.value] ?? 0}
            label={entry.label}
            collapsed={collapsed}
            title={entry.value === 'failed' ? 'Failed, or needing a new link' : undefined}
            onClick={() => onFilter(entry.value)}
          >
            <Icon
              aria-hidden
              className="size-4 shrink-0"
              style={{ color: entry.color ?? 'var(--text-secondary)' }}
            />
            {!collapsed && <span className="min-w-0 flex-1 truncate">{entry.label}</span>}
          </Item>
        )
      })}
      {section('File type')}
      {FILE_KINDS.map((entry) => (
        <Item
          key={entry.kind}
          label={entry.label}
          collapsed={collapsed}
          active={kind === entry.kind}
          count={counts.kinds[entry.kind] ?? 0}
          onClick={() => onKind(kind === entry.kind ? null : entry.kind)}
        >
          <FileKindIcon kind={entry.kind} size="sm" className="size-5 [&>svg]:size-3" />
          {!collapsed && <span className="min-w-0 flex-1 truncate">{entry.label}</span>}
        </Item>
      ))}
      <div className="flex-1" />
      {/* Always in place, only hidden when there is nothing to clear: the list above would
          otherwise move (or gain a scrollbar) when the first download finishes. */}
      {
        <Tooltip disabled={!canClear}>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onClear}
                disabled={!canClear}
                tabIndex={canClear ? 0 : -1}
                aria-hidden={!canClear}
                aria-label="Clear finished list"
                className={`mt-2 flex h-8 shrink-0 items-center ${collapsed ? 'justify-center' : 'gap-2 px-2 text-left'} rounded-md text-[12px] text-[var(--text-secondary)] outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${canClear ? '' : 'invisible'}`}
              >
                <Archive aria-hidden className="size-3.5" />
                {!collapsed && 'Clear finished list'}
              </button>
            }
          />
          <TooltipContent>Downloaded files stay on your computer</TooltipContent>
        </Tooltip>
      }
    </nav>
  )
}
