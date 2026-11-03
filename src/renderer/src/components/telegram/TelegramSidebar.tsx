import { cn } from 'cn'
import {
  ArrowDownToLine,
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon
} from 'lucide-react'
import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import type { TelegramJobFilter } from '../../store/useTelegramStore'
import type { TgMediaKind } from '@shared/telegram'
import { FileKindIcon } from '../downloads/FileKindIcon'
import { Item, labelClass } from '../downloads/Sidebar'
import { STATUS_STYLE } from '../../utils/status'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { MEDIA_KINDS } from './telegramRowInfo'

const JOBS: {
  value: Exclude<TelegramJobFilter, 'all'>
  label: string
  icon: LucideIcon
  color: string
}[] = [
  {
    value: 'active',
    label: 'Active',
    icon: ArrowDownToLine,
    color: STATUS_STYLE.downloading.color
  },
  { value: 'finished', label: 'Finished', icon: CircleCheck, color: STATUS_STYLE.completed.color },
  { value: 'failed', label: 'Failed', icon: CircleAlert, color: STATUS_STYLE.failed.color }
]

/** The Telegram section's own side panel: back to Downloads, then media groups and job states. */
export function TelegramSidebar({
  kind,
  onKind,
  kindCounts,
  jobFilter,
  onJobFilter,
  jobCounts
}: {
  kind: TgMediaKind | null
  onKind: (kind: TgMediaKind | null) => void
  kindCounts: Record<TgMediaKind | 'all', number>
  jobFilter: TelegramJobFilter
  onJobFilter: (filter: TelegramJobFilter) => void
  jobCounts: Record<Exclude<TelegramJobFilter, 'all'>, number>
}): React.JSX.Element {
  // Shares the Downloads panel's remembered width.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('lightning.sidebar') === 'min'
  )
  const setView = useAppStore((store) => store.setView)
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
  const buttonClass = cn(
    'flex h-8 shrink-0 items-center rounded-md text-[var(--text-secondary)] outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
    collapsed ? 'w-full justify-center' : 'w-8 justify-center'
  )
  return (
    <nav
      aria-label="Telegram categories"
      className={cn(
        'flex shrink-0 flex-col gap-0.5 overflow-y-auto overflow-x-hidden border-r-[0.5px] border-border p-2',
        collapsed ? 'w-14' : 'w-[184px]'
      )}
    >
      <div
        className={cn('flex shrink-0 items-center gap-0.5', collapsed ? 'flex-col' : 'self-end')}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={toggle}
                aria-label={collapsed ? 'Expand side panel' : 'Collapse side panel'}
                aria-expanded={!collapsed}
                className={buttonClass}
              >
                <Toggle aria-hidden className="size-4" />
              </button>
            }
          />
          <TooltipContent side="right">
            {collapsed ? 'Expand side panel' : 'Collapse side panel'}
          </TooltipContent>
        </Tooltip>
      </div>
      <Item
        label="Downloads"
        title="Back to Downloads"
        collapsed={collapsed}
        active={false}
        onClick={() => setView({ name: 'list' })}
      >
        <ArrowLeft aria-hidden className="size-4 shrink-0 text-[var(--text-secondary)]" />
        {!collapsed && <span className="min-w-0 flex-1 truncate">Downloads</span>}
      </Item>
      {section('Media')}
      <Item
        label="All"
        collapsed={collapsed}
        active={kind === null}
        count={kindCounts.all}
        onClick={() => onKind(null)}
      >
        <FileKindIcon kind="other" icon={Layers} size="sm" className="size-5 [&>svg]:size-3" />
        {!collapsed && <span className="min-w-0 flex-1 truncate">All</span>}
      </Item>
      {MEDIA_KINDS.map((entry) => (
        <Item
          key={entry.kind}
          label={entry.label}
          collapsed={collapsed}
          active={kind === entry.kind}
          count={kindCounts[entry.kind]}
          onClick={() => onKind(kind === entry.kind ? null : entry.kind)}
        >
          <FileKindIcon kind={entry.fileKind} size="sm" className="size-5 [&>svg]:size-3" />
          {!collapsed && <span className="min-w-0 flex-1 truncate">{entry.label}</span>}
        </Item>
      ))}
      {section('Jobs')}
      {JOBS.map((entry) => {
        const Icon = entry.icon
        return (
          <Item
            key={entry.value}
            label={entry.label}
            collapsed={collapsed}
            active={jobFilter === entry.value}
            count={jobCounts[entry.value]}
            onClick={() => onJobFilter(jobFilter === entry.value ? 'all' : entry.value)}
          >
            <Icon aria-hidden className="size-4 shrink-0" style={{ color: entry.color }} />
            {!collapsed && <span className="min-w-0 flex-1 truncate">{entry.label}</span>}
          </Item>
        )
      })}
    </nav>
  )
}
