import type { DownloadState, FinishedDownload, GroupInfo } from '@shared/types'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  ListPlus,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Trash2,
  X,
  type LucideIcon
} from 'lucide-react'
import { cn } from 'cn'
import { memo, useCallback, useEffect, useState } from 'react'
import { DownloadFilterMenu } from '../components/DownloadFilterMenu'
import { CombineDiagram } from '../components/CombineDiagram'
import { FixLinkDialog } from '../components/FixLinkDialog'
import { LimitsDialog } from '../components/LimitsDialog'
import { NetworksMenu } from '../components/NetworksMenu'
import { TorrentBadge } from '../components/TorrentBadge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '../components/ui/alert-dialog'
import { Badge } from '../components/ui/badge'
import { Button, buttonVariants } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { useNetworkVisuals, type ResolveNetworkVisual } from '../hooks/useNetworkVisuals'
import { useAppStore, type DownloadFilter } from '../store/useAppStore'
import {
  describeError,
  fileExtensionBadge,
  formatBytes,
  formatEta,
  formatPercent,
  formatSpeed,
  formatWhen,
  isFolder,
  linkExpired,
  sourceOf,
  toDisplayPath,
  wantedBytes
} from '../utils/format'

type Item = DownloadState | FinishedDownload

/** A download group's row, with its files (finished ones too) to show when it is opened. */
interface GroupEntry {
  group: GroupInfo
  items: Item[]
}

/** A heading in the list and what is listed under it: downloads on their own, and groups. */
interface Section {
  label: string
  filter: Exclude<DownloadFilter, 'all'>
  items: Item[]
  groups: GroupEntry[]
}

const isFinished = (item: Item): item is FinishedDownload => 'unitsWritten' in item

const SECTION_ORDER = ['downloading', 'queued', 'paused', 'error', 'completed'] as const
type SectionStatus = (typeof SECTION_ORDER)[number]

const SECTIONS: Record<SectionStatus, { label: string; filter: Exclude<DownloadFilter, 'all'> }> = {
  downloading: { label: 'Downloading', filter: 'progress' },
  queued: { label: 'Queued', filter: 'progress' },
  paused: { label: 'Paused', filter: 'progress' },
  error: { label: 'Needs attention', filter: 'failed' },
  completed: { label: 'Finished', filter: 'finished' }
}

/** The most active state a group's files are in: it is listed under that heading. A file still
 * waiting for a network counts as paused, or as needing attention if it couldn't start. */
function statusOfGroup({ group, items }: GroupEntry): SectionStatus {
  const found = new Set<SectionStatus>(
    items.map((item) =>
      isFinished(item) || item.status === 'completed'
        ? 'completed'
        : item.status === 'cancelled'
          ? 'paused'
          : item.status
    )
  )
  for (const waiting of group.pending) found.add(waiting.error ? 'error' : 'paused')
  return SECTION_ORDER.find((status) => found.has(status)) ?? 'completed'
}

function groupsOf(
  downloads: DownloadState[],
  history: FinishedDownload[],
  groups: GroupInfo[]
): Section[] {
  // A group with nothing in it any more isn't listed.
  const entries: GroupEntry[] = groups
    .map((group) => ({
      group,
      items: [
        ...downloads.filter((download) => download.groupId === group.id),
        ...history.filter((entry) => entry.groupId === group.id)
      ]
    }))
    .filter((entry) => entry.items.length > 0 || entry.group.pending.length > 0)
  const grouped = new Set(entries.flatMap((entry) => entry.items.map((item) => item.id)))
  const single = downloads.filter((download) => !grouped.has(download.id))
  const byStatus = (status: DownloadState['status']): DownloadState[] =>
    single.filter((download) => download.status === status)
  const loose: Record<SectionStatus, Item[]> = {
    downloading: byStatus('downloading'),
    queued: byStatus('queued').sort((a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0)),
    paused: byStatus('paused'),
    error: byStatus('error'),
    // Completed but not in history yet: on its way there, so listed with it.
    completed: [...byStatus('completed'), ...history.filter((entry) => !grouped.has(entry.id))]
  }
  return SECTION_ORDER.map((status) => ({
    ...SECTIONS[status],
    items: loose[status],
    groups: entries
      .filter((entry) => statusOfGroup(entry) === status)
      .sort((a, b) => a.group.createdAt - b.group.createdAt)
  })).filter((section) => section.items.length + section.groups.length > 0)
}

const itemsOfSection = (section: Section): Item[] => [
  ...section.items,
  ...section.groups.flatMap((entry) => entry.items)
]

/** "2 downloading · 1 queued", or "all done". */
function summaryOf(downloads: DownloadState[]): string {
  const count = (status: DownloadState['status']): number =>
    downloads.filter((download) => download.status === status).length
  const parts = [
    [count('downloading'), 'downloading'],
    [count('queued'), 'queued'],
    [count('paused'), 'paused'],
    [count('error'), 'need attention']
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, label]) => `${n} ${label}`)
  return parts.length > 0 ? parts.join(' · ') : 'all done'
}

const groupLabelClass =
  'font-mono text-[10.5px] leading-none font-medium tracking-[0.18em] text-muted-foreground uppercase'

export function DownloadsScreen(): React.JSX.Element {
  const downloadsById = useAppStore((store) => store.downloads)
  const history = useAppStore((store) => store.history)
  const groupInfos = useAppStore((store) => store.groups)
  const setView = useAppStore((store) => store.setView)
  const openNewDownload = useAppStore((store) => store.openNewDownload)
  const openMultiLinks = useAppStore((store) => store.openMultiLinks)
  const removeDownload = useAppStore((store) => store.removeDownload)
  const filter = useAppStore((store) => store.downloadFilter)
  const setFilter = useAppStore((store) => store.setDownloadFilter)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [fixing, setFixing] = useState<DownloadState | null>(null)
  const [confirmation, setConfirmation] = useState<{
    kind: 'cancel' | 'trash'
    ids: string[]
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [limitsOpen, setLimitsOpen] = useState(false)
  const [limitsPage, setLimitsPage] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(interval)
  }, [])

  const downloads = Object.values(downloadsById)
    .filter((download) => download.status !== 'cancelled')
    .sort((a, b) => a.startedAt - b.startedAt)
  const allGroups = groupsOf(downloads, history, groupInfos)
  // A group counts as one, under the heading it is listed in.
  const counts: Record<DownloadFilter, number> = {
    all: 0,
    progress: 0,
    finished: 0,
    failed: 0
  }
  for (const section of allGroups) {
    const listed = section.items.length + section.groups.length
    counts.all += listed
    counts[section.filter] += listed
  }
  const groups = allGroups.filter((group) => filter === 'all' || group.filter === filter)
  const items = groups.flatMap(itemsOfSection)
  // Only what's still listed counts: one that finished or went is no longer selected.
  const chosen = items.filter((item) => selected.has(item.id))

  const toggle = useCallback(
    (ids: string[], on: boolean): void =>
      setSelected((previous) => {
        const next = new Set(previous)
        for (const id of ids) {
          if (on) next.add(id)
          else next.delete(id)
        }
        return next
      }),
    []
  )
  // Stable, with the colors resolved once here, so a finished row skips every progress push.
  const networkVisual = useNetworkVisuals()
  const selectRow = useCallback((id: string, on: boolean) => toggle([id], on), [toggle])
  const openRow = useCallback((id: string) => setView({ name: 'download', id }), [setView])
  const fixRow = useCallback((item: Item) => {
    if (!isFinished(item)) setFixing(item)
  }, [])
  const againRow = useCallback(
    (item: Item) => {
      removeDownload(item.id)
      openNewDownload(item.url)
    },
    [removeDownload, openNewDownload]
  )

  const renderItem = (item: Item): React.JSX.Element => (
    <DownloadRow
      key={item.id}
      item={item}
      now={now}
      selected={selected.has(item.id)}
      selecting={chosen.length > 0}
      networkVisual={isFinished(item) || item.status === 'completed' ? undefined : networkVisual}
      onSelect={selectRow}
      onOpen={openRow}
      onFix={fixRow}
      onAgain={againRow}
    />
  )

  const pausable = chosen.filter(
    (item): item is DownloadState =>
      !isFinished(item) && (item.status === 'downloading' || item.status === 'queued')
  )
  const resumable = chosen.filter(
    (item): item is DownloadState => !isFinished(item) && item.status === 'paused'
  )
  const retryable = chosen.filter(
    (item): item is DownloadState =>
      !isFinished(item) && item.status === 'error' && item.resumable !== false && !linkExpired(item)
  )
  const unfinished = chosen.filter((item) => !isFinished(item) && item.status !== 'completed')
  const finished = chosen.filter((item) => isFinished(item) || item.status === 'completed')
  const trashable = finished.filter(
    (item) =>
      !(isFinished(item) && item.missing) &&
      (item.kind !== 'torrent' ||
        !item.folder ||
        !isFinished(item) ||
        !!item.downloadedFiles?.length)
  )
  const confirmationItems = confirmation
    ? chosen.filter(
        (item) =>
          confirmation.ids.includes(item.id) &&
          (confirmation.kind === 'cancel' ? unfinished.includes(item) : trashable.includes(item))
      )
    : []

  const runAction = async (
    targets: Item[],
    action: 'pause' | 'resume' | 'remove' | 'trash'
  ): Promise<void> => {
    if (busy) return
    setBusy(true)
    setActionError(null)
    try {
      for (const item of targets) {
        if (action === 'pause') await window.plexo.pauseDownload(item.id)
        else if (action === 'resume') await window.plexo.resumeDownload(item.id)
        else {
          await window.plexo.removeDownload(item.id, { trashFile: action === 'trash' })
          useAppStore.setState((store) => {
            const { [item.id]: removed, ...downloads } = store.downloads
            void removed
            return { downloads, history: store.history.filter((entry) => entry.id !== item.id) }
          })
          setSelected((previous) => {
            const next = new Set(previous)
            next.delete(item.id)
            return next
          })
        }
      }
    } catch (error) {
      setActionError(describeError(error))
    } finally {
      setBusy(false)
      setConfirmation(null)
    }
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {chosen.length === 0 ? (
        <div className="flex h-12 shrink-0 items-center gap-3 border-b-[0.5px] border-border px-5">
          <DownloadFilterMenu
            value={filter}
            counts={counts}
            onChange={(next) => {
              setFilter(next)
              setSelected(new Set())
            }}
          />
          {/* One group already says it in its header. */}
          {allGroups.length > 1 && (
            <div className="font-mono text-[11.5px] leading-none text-muted-foreground">
              {summaryOf(downloads)}
            </div>
          )}
          <div className="flex-1" />
          <NetworksMenu
            onOpenLimits={(page) => {
              setLimitsPage(page)
              setLimitsOpen(true)
            }}
          />
          <Button type="button" variant="secondary" onClick={() => openMultiLinks()}>
            <ListPlus data-icon="inline-start" />
            Add several links
          </Button>
          <Button type="button" onClick={() => openNewDownload()}>
            <Plus data-icon="inline-start" />
            New download
          </Button>
        </div>
      ) : (
        <div
          role="toolbar"
          aria-label="Selected downloads"
          aria-busy={busy}
          className="flex h-12 shrink-0 items-center gap-3 border-b-[0.5px] border-border px-5"
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Deselect all"
                  disabled={busy}
                  onClick={() => setSelected(new Set())}
                >
                  <X />
                </Button>
              }
            />
            <TooltipContent>Deselect all</TooltipContent>
          </Tooltip>
          <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold">
            {chosen.length} selected
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy || chosen.length === items.length}
            onClick={() => setSelected(new Set(items.map((item) => item.id)))}
          >
            Select all
          </Button>
          <div className="flex-1" />
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {pausable.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void runAction(pausable, 'pause')}
              >
                Pause ({pausable.length})
              </Button>
            )}
            {resumable.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void runAction(resumable, 'resume')}
              >
                Resume ({resumable.length})
              </Button>
            )}
            {retryable.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void runAction(retryable, 'resume')}
              >
                Retry ({retryable.length})
              </Button>
            )}
            {finished.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void runAction(finished, 'remove')}
              >
                Remove from list ({finished.length})
              </Button>
            )}
            {unfinished.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  setConfirmation({ kind: 'cancel', ids: unfinished.map((item) => item.id) })
                }
              >
                Cancel downloads… ({unfinished.length})
              </Button>
            )}
            {trashable.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  setConfirmation({ kind: 'trash', ids: trashable.map((item) => item.id) })
                }
              >
                Move files to {window.plexo.platform === 'win32' ? 'Recycle Bin' : 'Trash'}… (
                {trashable.length})
              </Button>
            )}
          </div>
        </div>
      )}
      {actionError && (
        <div role="alert" className="border-b border-border px-5 py-2 text-[12px] text-destructive">
          {actionError}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {groups.length === 0 &&
          (filter === 'all' ? (
            <EmptyState />
          ) : (
            <div role="status" className="flex flex-col items-center gap-2 px-5 py-16 text-center">
              <p className="text-[16px] font-semibold">
                {filter === 'progress'
                  ? 'No downloads in progress'
                  : filter === 'finished'
                    ? 'No finished downloads'
                    : 'No downloads need attention'}
              </p>
              <Button type="button" variant="secondary" onClick={() => setFilter('all')}>
                Show all downloads
              </Button>
            </div>
          ))}
        {groups.map((group) => {
          const ids = itemsOfSection(group).map((item) => item.id)
          const all = ids.every((id) => selected.has(id))
          const some = !all && ids.some((id) => selected.has(id))
          return (
            <section key={group.label} aria-label={group.label}>
              <div className="group/group-header flex items-center gap-3 border-b-[0.5px] border-border pt-5 pb-3">
                <Checkbox
                  className={cn(
                    chosen.length === 0 &&
                      'opacity-0 group-focus-within/group-header:opacity-100 group-hover/group-header:opacity-100'
                  )}
                  aria-label={
                    group.label === 'Needs attention'
                      ? 'Select all downloads needing attention'
                      : `Select all ${group.label.toLowerCase()} downloads`
                  }
                  checked={all}
                  indeterminate={some}
                  onCheckedChange={(on) => toggle(ids, on)}
                />
                <h2 className={groupLabelClass}>
                  {group.label}
                  <span className="ml-2.5 tracking-normal">
                    {group.items.length + group.groups.length}
                  </span>
                </h2>
                <div className="flex-1" />
                {group.label === 'Finished' && history.length > 0 && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          className="text-[12.5px] text-[var(--text-secondary)] hover:text-foreground"
                          onClick={() => void window.plexo.clearHistory()}
                        >
                          Clear finished list
                        </button>
                      }
                    />
                    <TooltipContent>Downloaded files stay on your computer</TooltipContent>
                  </Tooltip>
                )}
              </div>
              {group.items.map((item) => renderItem(item))}
              {group.groups.map((entry) => (
                <GroupRow
                  key={entry.group.id}
                  entry={entry}
                  selected={selected}
                  selecting={chosen.length > 0}
                  networkVisual={networkVisual}
                  onToggle={toggle}
                  renderItem={renderItem}
                />
              ))}
            </section>
          )
        })}
      </div>

      <FixLinkDialog download={fixing} onClose={() => setFixing(null)} />
      <LimitsDialog
        open={limitsOpen}
        onOpenChange={setLimitsOpen}
        page={limitsPage}
        onPageChange={setLimitsPage}
      />

      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => !open && setConfirmation(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation?.kind === 'cancel'
                ? 'Cancel'
                : `Move files to ${window.plexo.platform === 'win32' ? 'Recycle Bin' : 'Trash'} for`}{' '}
              {confirmationItems.length} {confirmationItems.length === 1 ? 'download' : 'downloads'}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.kind === 'cancel'
                ? 'This stops the selected unfinished downloads and deletes their downloaded data. Finished downloads stay unchanged.'
                : `This moves the selected finished downloads’ files to the ${window.plexo.platform === 'win32' ? 'Recycle Bin' : 'Trash'} and removes them from the list. Unrelated files stay in place.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || confirmationItems.length === 0}
              className={buttonVariants({ variant: 'destructive', size: 'sm' })}
              onClick={() =>
                void runAction(
                  confirmationItems,
                  confirmation?.kind === 'cancel' ? 'remove' : 'trash'
                )
              }
            >
              {confirmation?.kind === 'cancel'
                ? 'Cancel downloads'
                : `Move files to ${window.plexo.platform === 'win32' ? 'Recycle Bin' : 'Trash'}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// Colors are irrelevant here — the diagram is rendered `muted`, which overrides them all to
// var(--icon-muted) — these are just three placeholder rows to draw the illustration with.
const PLACEHOLDER_NETWORKS = [
  { solid: 'var(--icon-muted)', label: 'Wi-Fi' },
  { solid: 'var(--icon-muted)', label: 'USB' },
  { solid: 'var(--icon-muted)', label: 'Ethernet' }
]
const PASTE_SHORTCUT = window.plexo.platform === 'darwin' ? '⌘V' : 'Ctrl+V'
const NEW_SHORTCUT = window.plexo.platform === 'darwin' ? '⌘N' : 'Ctrl+N'

/** Nothing listed yet: how to start one — or, with no network connected, how to get one. */
function EmptyState(): React.JSX.Element {
  const noNetworks = useAppStore(
    (store) => store.interfacesStatus === 'ready' && store.interfaces.length === 0
  )
  const loadInterfaces = useAppStore((store) => store.loadInterfaces)
  const openNewDownload = useAppStore((store) => store.openNewDownload)
  const openMultiLinks = useAppStore((store) => store.openMultiLinks)

  return (
    <div className="flex flex-col items-center gap-4 px-5 pt-16 pb-10 text-center">
      <CombineDiagram networks={PLACEHOLDER_NETWORKS} muted />
      {noNetworks ? (
        <>
          <div className="font-sans text-[16px] leading-[1.2] font-bold">No networks connected</div>
          <div className="max-w-[380px] text-[12.5px] leading-[1.6] text-[var(--text-secondary)]">
            Plexo needs at least one active network. Join a Wi-Fi network, plug in Ethernet, or
            connect your phone using USB tethering.
          </div>
          <div className="mt-1 flex gap-2">
            <Button type="button" variant="secondary" onClick={() => loadInterfaces()}>
              Scan again
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => window.plexo.openNetworkSettings()}
            >
              Network settings…
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="font-sans text-[16px] leading-[1.2] font-bold">No downloads yet</div>
          <div className="max-w-[380px] text-[12.5px] leading-[1.6] text-[var(--text-secondary)]">
            Paste a link ({PASTE_SHORTCUT}) or drop a .torrent anywhere in this window.
          </div>
          <Button type="button" variant="secondary" onClick={() => openMultiLinks()}>
            <ListPlus data-icon="inline-start" />
            Add several links
          </Button>
          <Button type="button" className="mt-1" onClick={() => openNewDownload()}>
            <Plus data-icon="inline-start" />
            New download
            <span className="ml-1 font-mono text-[11px] opacity-70">{NEW_SHORTCUT}</span>
          </Button>
        </>
      )}
    </div>
  )
}

/** A group of downloads as one row: its name, how far along it is, and, opened, its files. */
function GroupRow({
  entry,
  selected,
  selecting,
  networkVisual,
  onToggle,
  renderItem
}: {
  entry: GroupEntry
  selected: Set<string>
  selecting: boolean
  networkVisual: ResolveNetworkVisual
  onToggle: (ids: string[], on: boolean) => void
  renderItem: (item: Item) => React.JSX.Element
}): React.JSX.Element {
  const { group, items } = entry
  const homeDir = useAppStore((store) => store.homeDir)
  const editGroup = useAppStore((store) => store.editGroup)
  const [open, setOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const live = items.filter((item): item is DownloadState => !isFinished(item))
  const running = live.filter((item) => item.status === 'downloading')
  const pausable = live.filter((item) => item.status === 'downloading' || item.status === 'queued')
  const paused = live.filter((item) => item.status === 'paused')
  const waiting = group.pending.filter((item) => !item.error)
  const done = items.filter((item) => isFinished(item) || item.status === 'completed').length
  const fileCount = items.length + group.pending.length

  const wanted =
    items.reduce((sum, item) => sum + wantedBytes(item), 0) +
    group.pending.reduce((sum, item) => sum + item.request.totalBytes, 0)
  const received = items.reduce((sum, item) => sum + item.bytesDownloaded, 0)
  const speed = running.reduce((sum, item) => sum + item.speedBytesPerSec, 0)
  const segments = new Map<string, { share: number; color: string }>()
  for (const item of items) {
    for (const network of item.networks) {
      if (network.bytesDownloaded <= 0) continue
      const before = segments.get(network.id)?.share ?? 0
      segments.set(network.id, {
        share: before + network.bytesDownloaded / (wanted || 1),
        color: networkVisual(network.id, network.kind, network.label).solid
      })
    }
  }
  const ids = items.map((item) => item.id)
  const all = ids.length > 0 && ids.every((id) => selected.has(id))
  const some = !all && ids.some((id) => selected.has(id))

  const detail = [
    `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`,
    done > 0 && done < fileCount && `${done} finished`,
    waiting.length > 0 && `${waiting.length} waiting`,
    wanted > 0 && done < fileCount && `${formatPercent(received, wanted)}%`,
    speed > 0 && formatSpeed(speed),
    speed > 0 && wanted > 0 && formatEta(wanted - received, speed),
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
      await window.plexo.removeGroup(group.id)
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
            className="text-muted-foreground group-hover/group-row:text-foreground"
          >
            {icon}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )

  return (
    <div>
      <div
        className={cn(
          'group/group-row my-0.5 -mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors',
          'hover:bg-secondary focus-within:bg-secondary'
        )}
      >
        <Checkbox
          className={cn(
            !selecting &&
              !all &&
              'opacity-0 group-focus-within/group-row:opacity-100 group-hover/group-row:opacity-100'
          )}
          aria-label={`Select all files in ${group.name}`}
          checked={all}
          indeterminate={some}
          disabled={ids.length === 0}
          onCheckedChange={(on) => onToggle(ids, on)}
        />
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-border bg-card text-muted-foreground">
            <Folder className="size-5" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="truncate font-sans text-[14px] leading-tight font-medium">
                      {group.name}
                    </span>
                  }
                />
                <TooltipContent className="max-w-[min(560px,90vw)] break-all">
                  {group.name}
                </TooltipContent>
              </Tooltip>
              <Badge variant="secondary">{group.mode === 'auto' ? 'Auto' : 'Manual'}</Badge>
            </div>
            {segments.size > 0 && (
              <div
                className={cn(
                  'flex h-1 overflow-hidden rounded-full bg-muted',
                  running.length === 0 && done < fileCount && 'opacity-40'
                )}
              >
                {[...segments].map(([id, segment]) => (
                  <div
                    key={id}
                    style={{
                      width: `${Math.min(100, segment.share * 100)}%`,
                      background: segment.color
                    }}
                  />
                ))}
              </div>
            )}
            <div className="truncate font-mono text-[11.5px] leading-none text-muted-foreground">
              {detail}
            </div>
          </div>
        </button>
        {pausable.length > 0 &&
          iconButton(
            'Pause all in',
            <Pause />,
            () =>
              void run(() =>
                Promise.all(pausable.map((item) => window.plexo.pauseDownload(item.id)))
              )
          )}
        {paused.length > 0 &&
          pausable.length === 0 &&
          iconButton(
            'Resume all in',
            <Play />,
            () =>
              void run(() =>
                Promise.all(paused.map((item) => window.plexo.resumeDownload(item.id)))
              )
          )}
        {iconButton('Edit', <Pencil />, () => editGroup(group.id))}
        {iconButton('Remove', <Trash2 />, () => setRemoving(true))}
        <button
          type="button"
          aria-label={open ? `Hide files in ${group.name}` : `Show files in ${group.name}`}
          onClick={() => setOpen((value) => !value)}
          className="rounded-md p-1 text-muted-foreground transition-colors group-hover/group-row:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
      </div>
      {error && (
        <div role="alert" className="pb-1 pl-9 text-[12px] text-destructive">
          {error}
        </div>
      )}
      {open && (
        <div className="ml-5 border-l-[0.5px] border-border pl-3">
          {items.map((item) => renderItem(item))}
          {group.pending.map((item) => (
            <div key={item.id} className="flex items-center gap-3 py-2.5 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate font-medium">
                {item.request.suggestedFileName}
              </span>
              <span
                className={cn(
                  'shrink-0 font-mono text-[11.5px]',
                  item.error ? 'text-[var(--color-danger)]' : 'text-muted-foreground'
                )}
              >
                {item.error ? describeError(item.error) : 'Waiting for a network'}
              </span>
            </div>
          ))}
        </div>
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

const DownloadRow = memo(function DownloadRow({
  item,
  now,
  selected,
  selecting,
  networkVisual,
  onSelect,
  onOpen,
  onFix,
  onAgain
}: {
  item: Item
  now: number
  selected: boolean
  /** Something is selected: every checkbox shows, not just the hovered row's. */
  selecting: boolean
  /** Colors its progress bar; a finished row has none. */
  networkVisual?: ResolveNetworkVisual
  onSelect: (id: string, on: boolean) => void
  onOpen: (id: string) => void
  onFix: (item: Item) => void
  onAgain: (item: Item) => void
}): React.JSX.Element {
  const finished = isFinished(item) || item.status === 'completed'
  const badge = isFolder(item) ? 'DIR' : fileExtensionBadge(item.fileName)
  const wanted = wantedBytes(item)
  const percent = formatPercent(item.bytesDownloaded, wanted)

  let detail: string
  let tone = 'text-muted-foreground'
  let action: { label: string; run: () => void; icon?: LucideIcon } | null = null
  if (isFinished(item) || item.status === 'completed') {
    detail = [
      formatBytes(wanted || item.bytesDownloaded),
      // A torrent's badge already says where it came from.
      item.kind === 'http' && sourceOf(item.url),
      isFinished(item) && item.missing
        ? 'moved or deleted'
        : formatWhen(item.completedAt ?? now, now)
    ]
      .filter(Boolean)
      .join(' · ')
  } else {
    const download = item
    const sizes =
      wanted > 0
        ? `${formatBytes(download.bytesDownloaded)} of ${formatBytes(wanted)}`
        : formatBytes(download.bytesDownloaded)
    switch (download.status) {
      case 'downloading':
        detail = [
          wanted > 0 && `${percent}%`,
          sizes,
          formatSpeed(download.speedBytesPerSec),
          wanted > 0 &&
            download.speedBytesPerSec > 0 &&
            formatEta(wanted - download.bytesDownloaded, download.speedBytesPerSec)
        ]
          .filter(Boolean)
          .join(' · ')
        action = {
          label: 'Pause',
          icon: Pause,
          run: () => void window.plexo.pauseDownload(download.id)
        }
        break
      case 'queued':
        detail = `Waiting for a turn · ${sizes}`
        action = {
          label: 'Pause',
          icon: Pause,
          run: () => void window.plexo.pauseDownload(download.id)
        }
        break
      case 'paused':
        detail = wanted > 0 ? `Paused at ${percent}% · ${sizes}` : `Paused · ${sizes}`
        action = {
          label: 'Resume',
          icon: Play,
          run: () => void window.plexo.resumeDownload(download.id)
        }
        break
      default:
        detail = describeError(download.error ?? 'Something went wrong')
        tone = 'text-[var(--color-danger)]'
        if (linkExpired(download)) action = { label: 'Fix link', run: () => onFix(item) }
        else if (download.resumable !== false) {
          action = {
            label: 'Retry',
            icon: RotateCw,
            run: () => void window.plexo.resumeDownload(download.id)
          }
        } else action = { label: 'Download again', run: () => onAgain(item) }
    }
  }

  // The bar shows each network's share of the file in its color; a failed one shows in red.
  const segments =
    finished || isFinished(item) || !networkVisual
      ? []
      : item.status === 'error'
        ? [
            {
              id: 'error',
              share: item.bytesDownloaded / (wanted || 1),
              color: 'var(--color-danger)'
            }
          ]
        : item.networks
            .filter((network) => network.bytesDownloaded > 0)
            .map((network) => ({
              id: network.id,
              share: network.bytesDownloaded / (wanted || 1),
              color: networkVisual(network.id, network.kind, network.label).solid
            }))

  return (
    <div
      data-selected={selected || undefined}
      className={cn(
        'group/download-row my-0.5 -mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors',
        selected
          ? 'bg-primary/10 hover:bg-primary/15 focus-within:bg-primary/15'
          : 'hover:bg-secondary focus-within:bg-secondary'
      )}
    >
      <Checkbox
        className={cn(
          !selecting &&
            !selected &&
            'opacity-0 group-focus-within/download-row:opacity-100 group-hover/download-row:opacity-100'
        )}
        aria-label={`Select ${item.fileName}`}
        checked={selected}
        onCheckedChange={(on) => onSelect(item.id, on)}
      />
      <button
        type="button"
        onClick={() => onOpen(item.id)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-border bg-card font-mono text-[10px] font-semibold text-muted-foreground">
          {badge}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-sans text-[14px] leading-tight font-medium">
              {item.fileName}
            </span>
            {item.kind === 'torrent' && <TorrentBadge />}
          </div>
          {segments.length > 0 && (
            <div
              className={cn(
                'flex h-1 overflow-hidden rounded-full bg-muted',
                // Not moving: the colors stay, faded, so it doesn't read as running.
                !isFinished(item) &&
                  (item.status === 'paused' || item.status === 'queued') &&
                  'opacity-40'
              )}
            >
              {segments.map((segment) => (
                <div
                  key={segment.id}
                  style={{
                    width: `${Math.min(100, segment.share * 100)}%`,
                    background: segment.color
                  }}
                />
              ))}
            </div>
          )}
          <div className={`truncate font-mono text-[11.5px] leading-none ${tone}`}>{detail}</div>
        </div>
      </button>
      {action?.icon ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`${action.label} ${item.fileName}`}
                onClick={action.run}
                className="text-muted-foreground group-hover/download-row:text-foreground"
              >
                <action.icon />
              </Button>
            }
          />
          <TooltipContent>{action.label}</TooltipContent>
        </Tooltip>
      ) : (
        action && (
          <Button type="button" size="sm" variant="secondary" onClick={action.run}>
            {action.label}
          </Button>
        )
      )}
      <button
        type="button"
        aria-label={`Open ${item.fileName}`}
        onClick={() => onOpen(item.id)}
        className="rounded-md p-1 text-muted-foreground transition-colors group-hover/download-row:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  )
})
