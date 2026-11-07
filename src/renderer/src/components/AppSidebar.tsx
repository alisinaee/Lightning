import { cn } from 'cn'
import {
  ArrowLineDown as ArrowDownToLine,
  Archive,
  CaretDown as ChevronDown,
  WarningCircle as CircleAlert,
  CheckCircle as CircleCheck,
  DownloadSimple as Download,
  EyeSlash as EyeOff,
  Stack as Layers,
  SidebarSimple as PanelLeftClose,
  Sidebar as PanelLeftOpen,
  type Icon
} from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { useAppStore, type DownloadFilter } from '../store/useAppStore'
import {
  isActiveJob,
  isFailedJob,
  isFinishedJob,
  useTelegramStore,
  type TelegramJobFilter
} from '../store/useTelegramStore'
import {
  isActiveYoutubeJob,
  isFailedYoutubeJob,
  isFinishedYoutubeJob,
  useYoutubeStore,
  type YoutubeJobFilter
} from '../store/useYoutubeStore'
import { TelegramIcon } from './telegram/TelegramIcon'
import { YoutubeIcon } from './youtube/YoutubeIcon'
import { STATUSES } from './downloads/statusEntries'
import { FileKindIcon } from './downloads/FileKindIcon'
import { MEDIA_KINDS } from './telegram/telegramRowInfo'
import { buildEntries, countEntries } from '../utils/downloadList'
import { FILE_KINDS, type FileKind } from '../utils/fileKind'
import { STATUS_STYLE } from '../utils/status'
import type { TgMediaKind } from '@shared/telegram'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from './ui/alert-dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

export const labelClass =
  'px-2 pt-3 pb-1 font-mono text-[10px] leading-none tracking-[0.16em] text-muted-foreground uppercase'

// Every entry icon sits in the same 20px box, so labels line up whatever the icon.
const ICON_BOX = 'flex size-5 shrink-0 items-center justify-center'

/** One entry in the side panel: an icon, a label and an optional count. Collapsed, only the icon shows.
 * `expanded` is for a section header: it says whether that section's entries are showing. */
export function Item({
  active,
  expanded,
  onClick,
  count,
  title,
  label,
  collapsed,
  children
}: {
  active: boolean
  /** Set on a section header only. Left off, the entry is a plain item. */
  expanded?: boolean
  onClick: () => void
  /** Left off, an entry shows no number. */
  count?: number
  title?: string
  label: string
  collapsed: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const hint = collapsed ? (count === undefined ? label : `${label} (${count})`) : title
  const button = (
    <button
      type="button"
      aria-current={expanded === undefined && active ? 'true' : undefined}
      aria-expanded={expanded}
      aria-label={collapsed ? (count === undefined ? label : `${label}, ${count}`) : undefined}
      onClick={onClick}
      className={cn(
        // One weight in every state: a bolder active item is wider, so its row reflowed.
        collapsed
          ? 'flex h-8 w-full items-center justify-center rounded-lg'
          : 'flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors duration-150 text-[12.5px] font-medium outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-primary/10 text-foreground hover:bg-primary/15'
          : 'text-[var(--text-secondary)]'
      )}
    >
      {children}
      {!collapsed && count !== undefined && (
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

const TELEGRAM_JOBS: {
  value: Exclude<TelegramJobFilter, 'all'>
  label: string
  icon: Icon
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

const YOUTUBE_JOBS: {
  value: YoutubeJobFilter
  label: string
  icon: Icon
  color: string
}[] = [
  { value: 'all', label: 'All', icon: Layers, color: 'var(--text-secondary)' },
  {
    value: 'active',
    label: 'Active',
    icon: ArrowDownToLine,
    color: STATUS_STYLE.downloading.color
  },
  { value: 'finished', label: 'Finished', icon: CircleCheck, color: STATUS_STYLE.completed.color },
  { value: 'failed', label: 'Failed', icon: CircleAlert, color: STATUS_STYLE.failed.color }
]

/** The Telegram entries, shown under its header while the Telegram section is open. */
function TelegramEntries({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  const view = useAppStore((store) => store.view)
  const setView = useAppStore((store) => store.setView)
  const jobs = useTelegramStore((store) => store.jobs)
  const jobFilter = useTelegramStore((store) => store.jobFilter)
  const setJobFilter = useTelegramStore((store) => store.setJobFilter)
  const kind: TgMediaKind | null = view.name === 'telegram' ? view.kind : null
  const jobList = useMemo(() => Object.values(jobs), [jobs])
  const kindCounts = useMemo(() => {
    const counts: Record<TgMediaKind | 'all', number> = {
      all: 0,
      video: 0,
      photo: 0,
      audio: 0,
      document: 0,
      other: 0
    }
    for (const job of jobList) {
      for (const item of job.items) {
        counts.all++
        counts[item.media]++
      }
    }
    return counts
  }, [jobList])
  const jobCounts = useMemo(
    () => ({
      active: jobList.filter(isActiveJob).length,
      finished: jobList.filter(isFinishedJob).length,
      failed: jobList.filter(isFailedJob).length
    }),
    [jobList]
  )
  // Media kinds and job states are one list: choosing either clears the other, so only one entry
  // is ever lit.
  const setKind = (next: TgMediaKind | null): void => {
    setView({ name: 'telegram', kind: next })
    setJobFilter('all')
    useTelegramStore.getState().setSelected(new Set())
  }
  const chooseJob = (next: Exclude<TelegramJobFilter, 'all'>): void => {
    const target = jobFilter === next ? 'all' : next
    setView({ name: 'telegram', kind: null })
    setJobFilter(target)
    useTelegramStore.getState().setSelected(new Set())
  }
  return (
    <div className="contents">
      <Item
        label="All"
        collapsed={collapsed}
        active={kind === null && jobFilter === 'all'}
        count={kindCounts.all}
        onClick={() => setKind(null)}
      >
        <FileKindIcon
          kind="other"
          icon={Layers}
          size="sm"
          className="-mx-0.5 size-6 [&>svg]:size-[14px]"
        />
        {!collapsed && <span className="min-w-0 flex-1 truncate">All</span>}
      </Item>
      {MEDIA_KINDS.map((entry) => (
        <Item
          key={entry.kind}
          label={entry.label}
          collapsed={collapsed}
          active={kind === entry.kind}
          count={kindCounts[entry.kind]}
          onClick={() => setKind(kind === entry.kind ? null : entry.kind)}
        >
          <FileKindIcon
            kind={entry.fileKind}
            size="sm"
            className="-mx-0.5 size-6 [&>svg]:size-[14px]"
          />
          {!collapsed && <span className="min-w-0 flex-1 truncate">{entry.label}</span>}
        </Item>
      ))}
      {TELEGRAM_JOBS.map((entry) => {
        const Icon = entry.icon
        return (
          <Item
            key={entry.value}
            label={entry.label}
            collapsed={collapsed}
            active={jobFilter === entry.value}
            count={jobCounts[entry.value]}
            onClick={() => chooseJob(entry.value)}
          >
            <span className={ICON_BOX}>
              <Icon aria-hidden className="size-4" style={{ color: entry.color }} />
            </span>
            {!collapsed && <span className="min-w-0 flex-1 truncate">{entry.label}</span>}
          </Item>
        )
      })}
    </div>
  )
}

/** The YouTube entries, shown under its header while the YouTube section is open. */
function YoutubeEntries({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  const jobs = useYoutubeStore((store) => store.jobs)
  const jobFilter = useYoutubeStore((store) => store.jobFilter)
  const setJobFilter = useYoutubeStore((store) => store.setJobFilter)
  const jobList = useMemo(() => Object.values(jobs), [jobs])
  const counts: Record<YoutubeJobFilter, number> = {
    all: jobList.length,
    active: jobList.filter(isActiveYoutubeJob).length,
    finished: jobList.filter(isFinishedYoutubeJob).length,
    failed: jobList.filter(isFailedYoutubeJob).length
  }
  return (
    <div className="contents">
      {YOUTUBE_JOBS.map((entry) => {
        const Icon = entry.icon
        return (
          <Item
            key={entry.value}
            label={entry.label}
            collapsed={collapsed}
            active={jobFilter === entry.value}
            count={counts[entry.value]}
            onClick={() => setJobFilter(entry.value)}
          >
            <span className={ICON_BOX}>
              <Icon aria-hidden className="size-4" style={{ color: entry.color }} />
            </span>
            {!collapsed && <span className="min-w-0 flex-1 truncate">{entry.label}</span>}
          </Item>
        )
      })}
    </div>
  )
}

/**
 * The one side panel: three sections, Downloads, Telegram and YouTube. Only one is open at a time,
 * and the open one is the section the screen on show belongs to. Opening a section goes to its
 * screen, so the panel and the screen never disagree and there is no back button to go by.
 */
export function AppSidebar(): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('lightning.sidebar') === 'min'
  )
  // The file types are a long list most people don't need, so they start shut.
  const [kindsOpen, setKindsOpen] = useState(false)
  const [hideOpen, setHideOpen] = useState(false)
  const hideSidebar = useAppStore((store) => store.hideSidebar)
  const view = useAppStore((store) => store.view)
  const setView = useAppStore((store) => store.setView)
  const filter = useAppStore((store) => store.downloadFilter)
  const setFilter = useAppStore((store) => store.setDownloadFilter)
  const kindFilter = useAppStore((store) => store.kindFilter)
  const setKindFilter = useAppStore((store) => store.setKindFilter)
  const setSelected = useAppStore((store) => store.setSelectedDownloads)
  const downloadsById = useAppStore((store) => store.downloads)
  const history = useAppStore((store) => store.history)
  const groupInfos = useAppStore((store) => store.groups)
  const telegramActive = useTelegramStore(
    (store) => Object.values(store.jobs).filter(isActiveJob).length
  )
  const youtubeActive = useYoutubeStore(
    (store) => Object.values(store.jobs).filter(isActiveYoutubeJob).length
  )
  const counts = useMemo(() => {
    const downloads = Object.values(downloadsById)
      .filter((download) => download.status !== 'cancelled')
      .sort((a, b) => a.startedAt - b.startedAt)
    return countEntries(buildEntries(downloads, history, groupInfos))
  }, [downloadsById, history, groupInfos])

  const sectionName = view.name === 'telegram' || view.name === 'youtube' ? view.name : 'downloads'
  const sectionIndex = sectionName === 'downloads' ? 0 : sectionName === 'telegram' ? 1 : 2
  const downloadsOpen = view.name !== 'telegram' && view.name !== 'youtube'
  const telegramOpen = view.name === 'telegram'
  const youtubeOpen = view.name === 'youtube'

  const toggle = (): void => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('lightning.sidebar', next ? 'min' : 'full')
  }
  const chooseFilter = (next: DownloadFilter): void => {
    setView({ name: 'list' })
    setFilter(next)
    setKindFilter(null)
    setSelected(new Set())
  }
  const chooseKind = (next: FileKind | null): void => {
    setView({ name: 'list' })
    setKindFilter(next)
    setFilter('all')
    setSelected(new Set())
  }
  const Toggle = collapsed ? PanelLeftOpen : PanelLeftClose
  const buttonClass = cn(
    'flex h-8 shrink-0 items-center rounded-md text-[var(--text-secondary)] outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
    collapsed ? 'w-full justify-center' : 'w-8 justify-center'
  )

  return (
    <>
      <nav
        aria-label="Download categories"
        className={cn(
          'flex shrink-0 flex-col gap-0.5 overflow-y-auto overflow-x-hidden border-r-[0.5px] border-border bg-[var(--bg-secondary)] p-2.5',
          'transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
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
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => setHideOpen(true)}
                  aria-label="Hide side panel"
                  className={buttonClass}
                >
                  <EyeOff aria-hidden className="size-4" />
                </button>
              }
            />
            <TooltipContent side="right">Hide side panel</TooltipContent>
          </Tooltip>
        </div>

        {/* The three sections as a fixed row of icons; only the entries below change. */}
        <div
          role="tablist"
          aria-label="Section"
          aria-orientation={collapsed ? 'vertical' : 'horizontal'}
          className={cn(
            'relative flex shrink-0 gap-0.5 border-b-[0.5px] border-border pb-1.5',
            collapsed ? 'flex-col' : 'flex-row'
          )}
        >
          {/* The highlight glides to the chosen section instead of jumping. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 h-8 rounded-lg bg-primary/10 transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{
              width: collapsed ? '100%' : 'calc((100% - 4px) / 3)',
              transform: collapsed
                ? `translateY(${sectionIndex * 34}px)`
                : `translateX(calc(${sectionIndex} * (100% + 2px)))`
            }}
          />
          {(
            [
              {
                label: 'Downloads',
                color: '#a65b04',
                open: downloadsOpen,
                count: counts.statuses.downloading ?? 0,
                icon: <Download aria-hidden className="size-4 text-[#a65b04]" />,
                go: () => view.name !== 'list' && setView({ name: 'list' })
              },
              {
                label: 'Telegram',
                color: '#229ed9',
                open: telegramOpen,
                count: telegramActive,
                icon: <TelegramIcon className="size-4" />,
                go: () => !telegramOpen && setView({ name: 'telegram', kind: null })
              },
              {
                label: 'YouTube',
                color: '#e53935',
                open: youtubeOpen,
                count: youtubeActive,
                icon: <YoutubeIcon className="size-4 text-red-500" />,
                go: () => !youtubeOpen && setView({ name: 'youtube' })
              }
            ] as const
          ).map((tab) => (
            <Tooltip key={tab.label}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab.open}
                    aria-label={tab.count > 0 ? `${tab.label}, ${tab.count} active` : tab.label}
                    onClick={() => void tab.go()}
                    className={cn(
                      'relative flex h-8 shrink-0 items-center justify-center rounded-lg',
                      collapsed ? 'w-full' : 'flex-1',
                      'outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      'transition-colors duration-200 active:scale-95',
                      tab.open
                        ? 'text-foreground'
                        : 'text-[var(--text-secondary)] hover:bg-secondary hover:text-foreground'
                    )}
                  >
                    {/* Narrow panel: the icon itself pulses. Wide: a dot beside it does. */}
                    <span
                      className={cn(
                        'flex items-center justify-center',
                        collapsed && tab.count > 0 && 'animate-pulse'
                      )}
                    >
                      {tab.icon}
                    </span>
                    {!collapsed && tab.count > 0 && (
                      <span
                        aria-hidden
                        className="ml-1 size-1.5 shrink-0 animate-pulse rounded-full"
                        style={{ backgroundColor: tab.color }}
                      />
                    )}
                  </button>
                }
              />
              <TooltipContent side="right">{tab.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        <div key={sectionName} className="lightning-entries mt-1 flex flex-col gap-0.5">
          {downloadsOpen && (
            <>
              {STATUSES.map((entry) => {
                const Icon = entry.icon
                return (
                  <Item
                    key={entry.value}
                    active={
                      view.name === 'list' &&
                      filter === entry.value &&
                      (entry.value !== 'all' || kindFilter === null)
                    }
                    count={counts.statuses[entry.value] ?? 0}
                    label={entry.label}
                    collapsed={collapsed}
                    title={entry.value === 'failed' ? 'Failed, or needing a new link' : undefined}
                    onClick={() => chooseFilter(entry.value)}
                  >
                    <span className={ICON_BOX}>
                      <Icon
                        aria-hidden
                        className="size-4"
                        style={{ color: entry.color ?? 'var(--text-secondary)' }}
                      />
                    </span>
                    {!collapsed && <span className="min-w-0 flex-1 truncate">{entry.label}</span>}
                  </Item>
                )
              })}

              {collapsed ? (
                <button
                  type="button"
                  aria-label="File type"
                  aria-expanded={kindsOpen}
                  onClick={() => setKindsOpen((open) => !open)}
                  className="mt-1 flex h-6 w-full items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronDown aria-hidden className={cn('size-3.5', !kindsOpen && '-rotate-90')} />
                </button>
              ) : (
                <button
                  type="button"
                  aria-expanded={kindsOpen}
                  onClick={() => setKindsOpen((open) => !open)}
                  className={cn(
                    labelClass,
                    'flex w-full items-center justify-between rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
                  )}
                >
                  File type
                  <ChevronDown aria-hidden className={cn('size-3', !kindsOpen && '-rotate-90')} />
                </button>
              )}
              {kindsOpen &&
                FILE_KINDS.map((entry) => (
                  <Item
                    key={entry.kind}
                    label={entry.label}
                    collapsed={collapsed}
                    active={view.name === 'list' && kindFilter === entry.kind}
                    count={counts.kinds[entry.kind] ?? 0}
                    onClick={() => chooseKind(kindFilter === entry.kind ? null : entry.kind)}
                  >
                    <FileKindIcon
                      kind={entry.kind}
                      size="sm"
                      className="-mx-0.5 size-6 [&>svg]:size-[14px]"
                    />
                    {!collapsed && <span className="min-w-0 flex-1 truncate">{entry.label}</span>}
                  </Item>
                ))}
            </>
          )}
          {telegramOpen && <TelegramEntries collapsed={collapsed} />}
          {youtubeOpen && <YoutubeEntries collapsed={collapsed} />}
        </div>

        <div className="flex-1" />
        {/* Always in place, only hidden when there is nothing to clear: the list above would
          otherwise move (or gain a scrollbar) when the first download finishes. */}
        <Tooltip disabled={history.length === 0}>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => void window.lightning.clearHistory()}
                disabled={history.length === 0}
                tabIndex={history.length > 0 ? 0 : -1}
                aria-hidden={history.length === 0}
                aria-label="Clear finished list"
                className={`mt-2 flex h-8 shrink-0 items-center ${collapsed ? 'justify-center' : 'gap-2 px-2 text-left'} rounded-md text-[12px] text-[var(--text-secondary)] outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${history.length > 0 ? '' : 'invisible'}`}
              >
                <Archive aria-hidden className="size-3.5" />
                {!collapsed && 'Clear finished list'}
              </button>
            }
          />
          <TooltipContent>Downloaded files stay on your computer</TooltipContent>
        </Tooltip>
      </nav>
      <AlertDialog open={hideOpen} onOpenChange={setHideOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hide the side panel?</AlertDialogTitle>
            <AlertDialogDescription>
              The side panel will be hidden completely. You can bring it back any time in Settings →
              Interface.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={hideSidebar}>Hide</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
