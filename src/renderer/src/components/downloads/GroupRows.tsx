import type { DownloadState } from '@shared/types'
import { cn } from 'cn'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Pause,
  Pencil,
  Play,
  RotateCw,
  Trash2
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ResolveNetworkVisual } from '../../hooks/useNetworkVisuals'
import { useAppStore } from '../../store/useAppStore'
import { sortItems, sortPending, statusOfGroup, type GroupEntry } from '../../utils/downloadList'
import { describeError, formatPercent, toDisplayPath, wantedBytes } from '../../utils/format'
import { isFinished, statusStyle, type Item, type RowInfo } from '../../utils/status'
import { GroupFileRow } from '../GroupFileRow'
import { GroupPlanPanel } from '../GroupPlanPanel'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '../ui/alert-dialog'
import { Badge } from '../ui/badge'
import { Button, buttonVariants } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import {
  AddedCell,
  ClippedText,
  ConnectionsCell,
  EtaCell,
  SizeCell,
  SpeedCell,
  StatusCell,
  cellClass,
  type ConnectionChip
} from './cells'
import { useColumns } from './columns'
import { chipsOf, onControl, ROW_CLASS, stateEdge } from './rowHelpers'
import { FileKindIcon } from './FileKindIcon'

/** A group of downloads as one expandable row of the table, its files indented below it and, for
 * an Auto group, the plan as a strip between them. */
export function GroupTableRow({
  entry,
  selected,
  getVisual,
  onToggle,
  onSelect,
  onOpen
}: {
  entry: GroupEntry
  selected: Set<string>
  getVisual: ResolveNetworkVisual
  onToggle: (ids: string[], on: boolean) => void
  onSelect: (id: string, on: boolean) => void
  onOpen: (id: string) => void
}): React.JSX.Element {
  const { group, items } = entry
  const columns = useColumns()
  const sort = useAppStore((store) => store.tableLayout.sort)
  // The files follow the column the user sorted by, like the rows of the list itself.
  // Whatever is downloading right now comes first; the chosen sort orders the rest.
  const sortedItems = useMemo(() => {
    const sorted = sortItems(items, sort)
    const live = (item: Item): boolean => !isFinished(item) && item.status === 'downloading'
    return [...sorted.filter(live), ...sorted.filter((item) => !live(item))]
  }, [items, sort])
  const sortedPending = useMemo(() => sortPending(group.pending, sort), [group.pending, sort])
  const homeDir = useAppStore((store) => store.homeDir)
  const editGroup = useAppStore((store) => store.editGroup)
  // In the store, not here: the row moves around the table as its files change state, which can
  // remount it, and it must stay as the user left it.
  const open = useAppStore((store) => store.groupUi[group.id]?.open ?? false)
  const toggleUi = useAppStore((store) => store.toggleGroupUi)
  const toggleOpen = (): void => toggleUi(group.id, 'open')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!open) return
    const interval = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(interval)
  }, [open])
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const live = items.filter((item): item is DownloadState => !isFinished(item))
  const running = live.filter((item) => item.status === 'downloading')
  const pausable = live.filter((item) => item.status === 'downloading' || item.status === 'queued')
  const paused = live.filter((item) => item.status === 'paused')
  const waiting = group.pending.filter((item) => !item.error)
  // Files that failed: those that stopped, and those that couldn't even start.
  const failedCount =
    live.filter((item) => item.status === 'error').length +
    group.pending.filter((item) => item.error).length
  const done = items.filter((item) => isFinished(item) || item.status === 'completed').length
  const fileCount = items.length + group.pending.length
  const allDone = fileCount > 0 && done === fileCount
  const first = items[0]
  // Shown by one of its files (main reveals a download by its id, never a path from here).
  const revealId = first && 'destinationPath' in first ? first.id : undefined

  const wanted =
    items.reduce((sum, item) => sum + wantedBytes(item), 0) +
    group.pending.reduce((sum, item) => sum + item.request.totalBytes, 0)
  const received = items.reduce((sum, item) => sum + item.bytesDownloaded, 0)
  const speed = running.reduce((sum, item) => sum + item.speedBytesPerSec, 0)
  const status = statusOfGroup(entry)
  const percent = allDone ? 100 : formatPercent(received, wanted)
  const info: RowInfo = {
    status,
    label:
      status === 'downloading'
        ? `Downloading ${percent}%`
        : status === 'paused' && received > 0
          ? `Paused ${percent}%`
          : status === 'failed'
            ? 'Needs attention'
            : statusStyle(status).label,
    percent,
    bar: !allDone && received > 0 && status !== 'failed',
    received,
    total: wanted,
    speed,
    etaSeconds: speed > 0 && wanted > received ? (wanted - received) / speed : null,
    addedAt: group.createdAt,
    missing: false
  }
  const chips = new Map<string, ConnectionChip>()
  for (const item of live) {
    if (item.status !== 'downloading' && item.status !== 'paused') continue
    for (const chip of chipsOf(item, getVisual)) {
      const before = chips.get(chip.id)
      chips.set(chip.id, { ...chip, speed: (before?.speed ?? 0) + (chip.speed ?? 0) })
    }
  }
  const ids = items.map((item) => item.id)
  const all = ids.length > 0 && ids.every((id) => selected.has(id))
  const some = !all && ids.some((id) => selected.has(id))

  const detail = [
    `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`,
    done > 0 && done < fileCount && `${done} finished`,
    waiting.length > 0 && `${waiting.length} waiting`,
    toDisplayPath(group.destinationDir, homeDir)
  ]
    .filter(Boolean)
    .join(' · ')

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(describeError(caught))
    }
  }
  const confirmRemoval = async (): Promise<void> => {
    setRemoving(false)
    await run(async () => {
      await window.lightning.removeGroup(group.id)
      useAppStore.setState((store) => ({
        downloads: Object.fromEntries(
          Object.entries(store.downloads).filter(([, download]) => download.groupId !== group.id)
        ),
        history: store.history.filter((entry) => entry.groupId !== group.id)
      }))
    })
  }

  const iconButton = (
    label: string,
    icon: React.JSX.Element,
    onClick: () => void
  ): React.JSX.Element => (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`${label} ${group.name}`}
            onClick={onClick}
            className="text-muted-foreground hover:text-foreground"
          >
            {icon}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )

  const cells: Record<string, React.JSX.Element> = {
    name: (
      <div key="name" role="cell" className={cn(cellClass, 'gap-2 pl-0')}>
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? `Hide files in ${group.name}` : `Show files in ${group.name}`}
          onClick={toggleOpen}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? (
            <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          )}
          <FileKindIcon kind="other" icon={Folder} />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <ClippedText
                text={group.name}
                className="font-sans text-[13px] leading-none font-semibold"
              />
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                {group.mode === 'auto' ? 'Auto' : 'Manual'}
              </Badge>
            </span>
            <span className="truncate text-[11px] leading-none text-muted-foreground">
              {detail}
            </span>
          </span>
        </button>
      </div>
    ),
    size: (
      <SizeCell key="size" received={received} total={wanted} running={!allDone} done={allDone} />
    ),
    status: <StatusCell key="status" info={info} />,
    speed: <SpeedCell key="speed" speed={speed} />,
    eta: <EtaCell key="eta" seconds={info.etaSeconds} />,
    added: <AddedCell key="added" at={group.createdAt} />,
    connections: <ConnectionsCell key="connections" chips={[...chips.values()]} />
  }

  return (
    <div role="rowgroup">
      <div
        role="row"
        data-row-entry={group.id}
        data-group={group.id}
        onClick={(event) => {
          if (!onControl(event.target)) toggleOpen()
        }}
        className={cn(ROW_CLASS, 'font-medium')}
        style={stateEdge(status)}
      >
        <div role="cell" className="flex items-center justify-center">
          <Checkbox
            aria-label={`Select all files in ${group.name}`}
            checked={all}
            indeterminate={some}
            disabled={ids.length === 0}
            onCheckedChange={(on) => onToggle(ids, on)}
          />
        </div>
        {columns.map((column) => cells[column])}
        <div role="cell" className="flex items-center justify-end gap-0.5 px-1.5">
          {pausable.length > 0 &&
            iconButton(
              'Pause all in',
              <Pause />,
              () =>
                void run(() =>
                  Promise.all(pausable.map((item) => window.lightning.pauseDownload(item.id)))
                )
            )}
          {paused.length > 0 &&
            pausable.length === 0 &&
            iconButton(
              'Resume all in',
              <Play />,
              () =>
                void run(() =>
                  Promise.all(paused.map((item) => window.lightning.resumeDownload(item.id)))
                )
            )}
          {failedCount > 0 &&
            iconButton(
              'Retry failed in',
              <RotateCw />,
              () =>
                void run(async () => {
                  const { failed } = await window.lightning.retryGroup(group.id)
                  if (failed.length > 0) throw new Error(failed[0])
                })
            )}
          {iconButton('Edit', <Pencil />, () => editGroup(group.id))}
          {iconButton('Remove', <Trash2 />, () => setRemoving(true))}
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="border-b-[0.5px] border-border py-1 pl-12 text-[12px] text-destructive"
        >
          {error}
        </div>
      )}
      {open && (
        <>
          <div className="border-b-[0.5px] border-border/70 bg-card/40 py-2 pr-4 pl-12">
            {group.mode === 'auto' ? (
              <GroupPlanPanel group={group} live={live} now={now} />
            ) : (
              <div className="text-[12px] text-muted-foreground">
                Manual: each file uses the connections you chose. Use the network button on a file
                to change them.
              </div>
            )}
            {allDone && (
              <div className="mt-2 flex items-center gap-2 text-[12px] text-muted-foreground">
                <span>All {fileCount} files finished.</span>
                {revealId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void window.lightning.revealDownload(revealId)}
                  >
                    Open folder
                  </Button>
                )}
              </div>
            )}
            {fileCount === 0 && (
              <div className="py-1 text-[12px] text-muted-foreground">No files in this group.</div>
            )}
          </div>
          {sortedItems.map((item) => (
            <GroupFileRow
              key={item.id}
              group={group}
              entry={
                isFinished(item) || item.status === 'completed'
                  ? { kind: 'finished', download: item }
                  : { kind: 'download', download: item }
              }
              selected={selected.has(item.id)}
              getVisual={getVisual}
              onSelect={onSelect}
              onOpen={onOpen}
              onError={setError}
            />
          ))}
          {sortedPending.map((item) => (
            <GroupFileRow
              key={item.id}
              group={group}
              entry={{ kind: 'waiting', item }}
              selected={false}
              getVisual={getVisual}
              onSelect={onSelect}
              onOpen={onOpen}
              onError={setError}
            />
          ))}
        </>
      )}

      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {group.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops the files still downloading and deletes the parts already downloaded, then
              removes the group from the list. Files that finished stay on your computer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive', size: 'sm' })}
              onClick={() => void confirmRemoval()}
            >
              Remove group
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
