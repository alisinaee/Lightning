import type { DownloadState } from '@shared/types'
import {
  LinkSimple as Link2,
  Funnel as ListFilter,
  ListPlus,
  Pause,
  ArrowClockwise as RotateCw,
  Play,
  Plus,
  X
} from '@phosphor-icons/react'
import { t, tn } from '@shared/i18n/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CombineDiagram } from '../components/CombineDiagram'
import { filterLabel } from '../components/downloadFilterLabels'
import { DownloadRow } from '../components/downloads/DownloadRow'
import type { RowHandlers } from '../components/downloads/rowHelpers'
import { TableBoundary } from '../components/downloads/TableBoundary'
import { DownloadsTable } from '../components/downloads/DownloadsTable'
import { GroupTableRow } from '../components/downloads/GroupRows'
import { STATUSES } from '../components/downloads/statusEntries'
import { FixLinkDialog } from '../components/FixLinkDialog'
import { NetworksMenu } from '../components/NetworksMenu'
import { NewMenu, SearchField, SettingsButton } from '../components/ListTopBar'
import { useLimitsDialog } from '../hooks/useLimitsDialog'
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
import { Button, buttonVariants } from '../components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { VpnControl } from '../components/VpnControl'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { useAppStore, type DownloadFilter } from '../store/useAppStore'
import {
  buildEntries,
  countEntries,
  entryItems,
  filterEntries,
  queuePositions,
  sortEntries,
  type ListEntry
} from '../utils/downloadList'
import { FILE_KINDS, type FileKind } from '../utils/fileKind'
import { describeError, linkExpired } from '../utils/format'
import { useKeptOrder } from '../utils/keepOrder'
import { isFinished, type Item } from '../utils/status'
import { EmptyStatusIcon } from '../components/EmptyIcon'

const emptyMessages = (): Partial<Record<DownloadFilter, string>> => ({
  progress: t('No downloads in progress'),
  finished: t('No finished downloads'),
  failed: t('No downloads need attention'),
  downloading: t('Nothing is downloading right now'),
  queued: t('Nothing is waiting in the queue'),
  paused: t('Nothing is paused')
})

/** The files of an entry that are listed: a group the filters narrowed lists only its matching ones. */
const listedItems = (entry: ListEntry, only: Map<string, Set<string>> | null): Item[] => {
  const items = entryItems(entry)
  if (!only || entry.type === 'item') return items
  const matching = only.get(entry.id)
  return matching ? items.filter((item) => matching.has(item.id)) : []
}

const platformTrash = (): string =>
  window.lightning.platform === 'win32' ? t('Recycle Bin') : t('Trash')

const isUnfinished = (item: Item): boolean => !isFinished(item) && item.status !== 'completed'
const isTrashable = (item: Item): boolean =>
  !isUnfinished(item) &&
  !(isFinished(item) && item.missing) &&
  (item.kind !== 'torrent' || !item.folder || !isFinished(item) || !!item.downloadedFiles?.length)

export function DownloadsScreen({
  onOpenSettings
}: {
  onOpenSettings: () => void
}): React.JSX.Element {
  const downloadsById = useAppStore((store) => store.downloads)
  const history = useAppStore((store) => store.history)
  const groupInfos = useAppStore((store) => store.groups)
  const setView = useAppStore((store) => store.setView)
  const openNewDownload = useAppStore((store) => store.openNewDownload)
  const openMultiLinks = useAppStore((store) => store.openMultiLinks)
  const removeDownload = useAppStore((store) => store.removeDownload)
  const filter = useAppStore((store) => store.downloadFilter)
  const setFilter = useAppStore((store) => store.setDownloadFilter)
  const kindFilter = useAppStore((store) => store.kindFilter)
  const setKindFilter = useAppStore((store) => store.setKindFilter)
  const sidebarHidden = useAppStore((store) => store.sidebarHidden)
  const search = useAppStore((store) => store.search)
  const setSearch = useAppStore((store) => store.setSearch)
  const sort = useAppStore((store) => store.tableLayout.sort)
  const selected = useAppStore((store) => store.selectedDownloads)
  const setSelected = useAppStore((store) => store.setSelectedDownloads)
  const preferences = useAppStore((store) => store.networkPreferences)
  const allInterfaces = useAppStore((store) => store.allInterfaces)
  const groupUi = useAppStore((store) => store.groupUi)
  const [fixing, setFixing] = useState<DownloadState | null>(null)
  const [confirmation, setConfirmation] = useState<{
    kind: 'cancel' | 'trash' | 'remove' | 'again'
    ids: string[]
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const { openLimits, limitsDialog } = useLimitsDialog()
  const searchInput = useRef<HTMLInputElement>(null)
  const downloads = useMemo(
    () =>
      Object.values(downloadsById)
        .filter((download) => download.status !== 'cancelled')
        .sort((a, b) => a.startedAt - b.startedAt),
    [downloadsById]
  )
  const entries = useMemo(
    () => buildEntries(downloads, history, groupInfos),
    [downloads, history, groupInfos]
  )
  const counts = useMemo(() => countEntries(entries), [entries])
  const positions = useMemo(() => queuePositions(downloads), [downloads])
  const filtered = useMemo(
    () => filterEntries(entries, filter, kindFilter, search),
    [entries, filter, kindFilter, search]
  )
  const listScrolled = useAppStore((store) => store.listScrolled)
  const sortedEntries = useMemo(() => sortEntries(filtered.entries, sort), [filtered, sort])
  // Scrolled down, the list keeps its order: rows do not move as downloads change state.
  const shown = useKeptOrder('list', sortedEntries, (entry) => entry.id, listScrolled)
  const [matchIndex, setMatchIndex] = useState(0)
  const matchCount = search.trim() === '' ? 0 : filtered.hits.size
  const stepMatch = (dir: 1 | -1): void => {
    if (matchCount === 0) return
    setMatchIndex((index) => (index + dir + matchCount) % matchCount)
  }
  useEffect(() => setMatchIndex(0), [search])
  // Only a move through the results or a new search scrolls: a progress push does not.
  useEffect(() => {
    const hit = document.querySelectorAll<HTMLElement>('[data-hit="true"]')[matchIndex]
    hit?.scrollIntoView({ block: 'nearest' })
  }, [matchIndex, search])
  // The match being looked at is marked (and the others found lightly), also when the list is
  // drawn again: marked on the page, not in the rows, so a progress update cannot clear it.
  useEffect(() => {
    const hits = document.querySelectorAll<HTMLElement>('[data-hit="true"]')
    hits.forEach((row, index) => {
      if (index === matchIndex) row.setAttribute('data-current', 'true')
      else row.removeAttribute('data-current')
    })
    return () => hits.forEach((row) => row.removeAttribute('data-current'))
  })

  // Every file of what is listed, a group's included, open or not; a group narrowed by the
  // filters lists only the files that match, so those are the ones it can select.
  const items = useMemo(
    () => shown.flatMap((entry) => listedItems(entry, filtered.only)),
    [shown, filtered.only]
  )
  // What is on screen top to bottom, for a Shift-click range.
  const orderedIds = useMemo(
    () =>
      shown.flatMap((entry) =>
        entry.type === 'item'
          ? [entry.item.id]
          : filtered.only || groupUi[entry.id]?.open
            ? listedItems(entry, filtered.only).map((item) => item.id)
            : []
      ),
    [shown, groupUi, filtered.only]
  )
  const allItems = useMemo(() => entries.flatMap(entryItems), [entries])
  // Only what's still listed counts: one that finished or went is no longer selected.
  const chosen = items.filter((item) => selected.has(item.id))

  const orderedRef = useRef(orderedIds)
  const anchor = useRef<string | null>(null)
  useEffect(() => {
    orderedRef.current = orderedIds
  }, [orderedIds])

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
    [setSelected]
  )
  const selectRow = useCallback(
    (id: string, on: boolean) => {
      anchor.current = id
      toggle([id], on)
    },
    [toggle]
  )
  const openRow = useCallback((id: string) => setView({ name: 'download', id }), [setView])

  const runAction = async (
    targets: Item[],
    action: 'pause' | 'resume' | 'remove' | 'trash'
  ): Promise<void> => {
    if (busy) return
    setBusy(true)
    setActionError(null)
    try {
      for (const item of targets) {
        if (action === 'pause') await window.lightning.pauseDownload(item.id)
        else if (action === 'resume') await window.lightning.resumeDownload(item.id)
        else {
          await window.lightning.removeDownload(item.id, { trashFile: action === 'trash' })
          useAppStore.setState((store) => {
            const { [item.id]: removed, ...rest } = store.downloads
            void removed
            return {
              downloads: rest,
              history: store.history.filter((entry) => entry.id !== item.id)
            }
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
  // Rows get these as one object that never changes, so a progress push re-renders only its row.
  const actionRef = useRef(runAction)
  // A right-click on a row that is part of a selection acts on the whole selection.
  const targetsRef = useRef<(item: Item, applies: (item: Item) => boolean) => string[]>(() => [])
  useEffect(() => {
    actionRef.current = runAction
    targetsRef.current = (item, applies) =>
      selected.has(item.id) && chosen.length > 1
        ? chosen.filter(applies).map((one) => one.id)
        : [item.id]
  })
  const handlers = useMemo<RowHandlers>(
    () => ({
      click: (id, mode) => {
        if (mode === 'range' && anchor.current) {
          const order = orderedRef.current
          const from = order.indexOf(anchor.current)
          const to = order.indexOf(id)
          if (from >= 0 && to >= 0) {
            const [low, high] = from < to ? [from, to] : [to, from]
            toggle(order.slice(low, high + 1), true)
            return
          }
        }
        anchor.current = id
        if (mode === 'toggle') {
          setSelected((previous) => {
            const next = new Set(previous)
            if (!next.delete(id)) next.add(id)
            return next
          })
        } else {
          // A plain click picks this row alone; clicking the only one picked lets it go.
          setSelected((previous) =>
            previous.size === 1 && previous.has(id) ? new Set() : new Set([id])
          )
        }
      },
      select: selectRow,
      open: openRow,
      fix: (item) => {
        if (!isFinished(item)) setFixing(item)
      },
      again: (item) => setConfirmation({ kind: 'again', ids: [item.id] }),
      cancel: (item) =>
        setConfirmation({ kind: 'cancel', ids: targetsRef.current(item, isUnfinished) }),
      removeFromList: (item) =>
        setConfirmation({ kind: 'remove', ids: targetsRef.current(item, (i) => !isUnfinished(i)) }),
      trash: (item) =>
        setConfirmation({ kind: 'trash', ids: targetsRef.current(item, isTrashable) })
    }),
    [toggle, setSelected, selectRow, openRow]
  )

  // Colors are assigned across every network at once, so a row repaints only when that changes.
  const networkVisual = useNetworkVisuals()
  const visualsKey = useMemo(
    () =>
      JSON.stringify([
        preferences,
        allInterfaces.map((iface) => [iface.id, iface.kind]),
        [...new Set([...downloads, ...history].flatMap((d) => d.networks.map((n) => n.id)))].sort()
      ]),
    [preferences, allInterfaces, downloads, history]
  )
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only when the key says a color moved
  const getVisual = useMemo(() => networkVisual, [visualsKey])

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
  // What the destructive buttons of the selection bar apply to: each only to the selected
  // downloads it fits, and each asks first (the same confirmations as a row's menu).
  const removable = chosen.filter((item) => !isUnfinished(item))
  const trashable = chosen.filter(isTrashable)
  const cancelable = chosen.filter(isUnfinished)
  const confirmationItems = confirmation
    ? allItems.filter(
        (item) =>
          confirmation.ids.includes(item.id) &&
          (confirmation.kind === 'cancel'
            ? isUnfinished(item)
            : confirmation.kind === 'trash'
              ? isTrashable(item)
              : confirmation.kind === 'remove'
                ? !isUnfinished(item)
                : true)
      )
    : []
  const pausableAll = downloads.filter(
    (download) => download.status === 'downloading' || download.status === 'queued'
  )
  const resumableAll = downloads.filter((download) => download.status === 'paused')
  // Failed downloads the button can try again: single ones that can continue, and the groups with
  // a file that failed (a group knows how to start over a file that can't continue).
  const failedSingles = downloads.filter(
    (download) =>
      download.status === 'error' &&
      download.resumable !== false &&
      !download.groupId &&
      !linkExpired(download)
  )
  const failedGroups = groupInfos.filter(
    (group) =>
      group.pending.some((item) => item.error) ||
      downloads.some((download) => download.groupId === group.id && download.status === 'error')
  )
  const retryAll = failedSingles.length > 0 || failedGroups.length > 0
  // One button for all of it: it pauses while anything is running; otherwise it resumes what is
  // paused (and tries what failed again); with only failures left, it retries them.
  const pausing = pausableAll.length > 0 || (resumableAll.length === 0 && !retryAll)
  const resumeAll = async (): Promise<void> => {
    await runAction([...resumableAll, ...failedSingles], 'resume')
    for (const group of failedGroups) {
      try {
        const { failed } = await window.lightning.retryGroup(group.id)
        if (failed.length > 0) setActionError(failed[0])
      } catch (error) {
        setActionError(describeError(error))
      }
    }
  }
  const resumeLabel = resumableAll.length > 0 ? t('Resume all') : t('Retry all failed')

  // Keyboard, as a file manager has it: Esc lets go of the selection, ⌘/Ctrl+A takes everything
  // listed, ⌘/Ctrl+F goes to the search box.
  useEffect(() => {
    const mod = window.lightning.platform === 'darwin' ? 'metaKey' : 'ctrlKey'
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName))
      if (event[mod] && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchInput.current?.focus()
      } else if (typing) return
      else if (event.key === 'Escape') setSelected(new Set())
      else if (event[mod] && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSelected(new Set(items.map((item) => item.id)))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [items, setSelected])

  const chooseFilter = (next: DownloadFilter): void => {
    setFilter(next)
    setSelected(new Set())
  }
  const showAll = (): void => {
    setFilter('all')
    setKindFilter(null)
    setSearch('')
    setSelected(new Set())
  }

  const noDownloadsAtAll = entries.length === 0

  const count = confirmationItems.length
  const confirmTitle =
    confirmation?.kind === 'cancel'
      ? tn(count, 'Cancel {count} download?', 'Cancel {count} downloads?')
      : confirmation?.kind === 'trash'
        ? count === 1
          ? t('Move this file to {trash}?', { trash: platformTrash() })
          : t('Move {count} files to {trash}?', { count, trash: platformTrash() })
        : confirmation?.kind === 'remove'
          ? tn(
              count,
              'Remove {count} download from the list?',
              'Remove {count} downloads from the list?'
            )
          : t('Download this again?')
  const confirmText =
    confirmation?.kind === 'cancel'
      ? t(
          'This stops the selected unfinished downloads and deletes their downloaded data. Finished downloads stay unchanged.'
        )
      : confirmation?.kind === 'trash'
        ? t(
            'This moves the files to the {trash} and removes them from the list. Unrelated files stay in place.',
            { trash: platformTrash() }
          )
        : confirmation?.kind === 'remove'
          ? t('Only the list entry goes. The downloaded files stay on your computer.')
          : t(
              'It is taken off the list, any partly downloaded data is deleted, and the link opens in New download to start over.'
            )
  const confirmButton =
    confirmation?.kind === 'cancel'
      ? t('Cancel downloads')
      : confirmation?.kind === 'trash'
        ? t('Move to {trash}', { trash: platformTrash() })
        : confirmation?.kind === 'remove'
          ? t('Remove from list')
          : t('Start again')

  return (
    <div className="@container flex h-full flex-col bg-background">
      {chosen.length === 0 ? (
        <div className="flex h-12 shrink-0 items-center gap-2 overflow-hidden border-b-[0.5px] border-border px-3">
          <h1 className="sr-only">{filterLabel(filter)}</h1>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  aria-label={pausing ? t('Pause all') : resumeLabel}
                  disabled={noDownloadsAtAll || (pausing && pausableAll.length === 0)}
                  onClick={() => void (pausing ? runAction(pausableAll, 'pause') : resumeAll())}
                >
                  {pausing ? (
                    <Pause className="fill-current" />
                  ) : resumableAll.length > 0 ? (
                    <Play className="fill-current" />
                  ) : (
                    <RotateCw />
                  )}
                </Button>
              }
            />
            <TooltipContent>{pausing ? t('Pause all') : resumeLabel}</TooltipContent>
          </Tooltip>
          <NetworksMenu onOpenLimits={openLimits} />
          <NewMenu
            label={t('New download')}
            items={[
              { label: t('One link'), icon: Link2, run: () => openNewDownload() },
              { label: t('Several links'), icon: ListPlus, run: () => openMultiLinks() }
            ]}
          />
          {/* After the + button, so a VPN turning up doesn't move it. */}
          <VpnControl />
          <div className="flex-1" />
          {/* Stands in for the side panel's filters while the panel is hidden. */}
          {sidebarHidden && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={t('Filter')}
                          className={
                            filter !== 'all' || kindFilter !== null ? 'text-primary' : undefined
                          }
                        />
                      }
                    >
                      <ListFilter />
                    </DropdownMenuTrigger>
                  }
                />
                <TooltipContent>{t('Filter')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>{t('Status')}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={filter}
                  onValueChange={(value) => chooseFilter(value as DownloadFilter)}
                >
                  {STATUSES.map((entry) => (
                    <DropdownMenuRadioItem key={entry.value} value={entry.value}>
                      {entry.label}
                      <span className="ms-auto ps-3 font-mono text-[11px] text-muted-foreground tabular-nums">
                        {counts.statuses[entry.value] ?? 0}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t('File type')}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={kindFilter ?? 'all'}
                  onValueChange={(value) => {
                    setKindFilter(value === 'all' ? null : (value as FileKind))
                    setSelected(new Set())
                  }}
                >
                  <DropdownMenuRadioItem value="all">{t('All types')}</DropdownMenuRadioItem>
                  {FILE_KINDS.map((entry) => (
                    <DropdownMenuRadioItem key={entry.kind} value={entry.kind}>
                      {entry.label}
                      <span className="ms-auto ps-3 font-mono text-[11px] text-muted-foreground tabular-nums">
                        {counts.kinds[entry.kind] ?? 0}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <SearchField
            inputRef={searchInput}
            label={t('Search downloads')}
            value={search}
            onChange={setSearch}
            disabled={noDownloadsAtAll}
            matches={matchCount}
            matchIndex={matchIndex}
            onStep={stepMatch}
          />
          <SettingsButton onClick={() => onOpenSettings()} />
        </div>
      ) : (
        <div
          role="toolbar"
          aria-label={t('Selected downloads')}
          aria-busy={busy}
          className="flex h-12 shrink-0 items-center gap-2 overflow-hidden border-b-[0.5px] border-border px-3"
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('Deselect all')}
                  disabled={busy}
                  onClick={() => setSelected(new Set())}
                >
                  <X />
                </Button>
              }
            />
            <TooltipContent>{t('Deselect all')}</TooltipContent>
          </Tooltip>
          <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold">
            {t('{count} selected', { count: chosen.length })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy || chosen.length === items.length}
            onClick={() => setSelected(new Set(items.map((item) => item.id)))}
          >
            {t('Select all')}
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
                {t('Pause ({count})', { count: pausable.length })}
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
                {t('Resume ({count})', { count: resumable.length })}
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
                {t('Retry ({count})', { count: retryable.length })}
              </Button>
            )}
            {removable.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                title={t('Takes them off the list; the files stay on your computer')}
                onClick={() =>
                  setConfirmation({ kind: 'remove', ids: removable.map((item) => item.id) })
                }
              >
                {t('Remove from list ({count})', { count: removable.length })}
              </Button>
            )}
            {trashable.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy}
                title={t('Moves the files to the {trash}', { trash: platformTrash() })}
                onClick={() =>
                  setConfirmation({ kind: 'trash', ids: trashable.map((item) => item.id) })
                }
              >
                {t('Delete files ({count})', { count: trashable.length })}
              </Button>
            )}
            {cancelable.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy}
                title={t('Stops them and deletes what was downloaded so far')}
                onClick={() =>
                  setConfirmation({ kind: 'cancel', ids: cancelable.map((item) => item.id) })
                }
              >
                {t('Cancel ({count})', { count: cancelable.length })}
              </Button>
            )}
          </div>
          <SettingsButton onClick={() => onOpenSettings()} />
        </div>
      )}
      {/* Laid over the table, not above it, so it doesn't push the table down. */}
      <div className="relative z-20 h-0">
        {actionError && (
          <div
            role="alert"
            className="absolute inset-x-0 top-0 border-b border-border bg-background px-5 py-2 text-[12px] text-destructive shadow-sm"
          >
            {actionError}
          </div>
        )}
      </div>

      <div className="@container flex min-h-0 flex-1">
        {noDownloadsAtAll ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <EmptyState />
          </div>
        ) : (
          <TableBoundary>
            <DownloadsTable
              allSelected={items.length > 0 && chosen.length === items.length}
              someSelected={chosen.length > 0 && chosen.length < items.length}
              selectable={items.length > 0}
              onSelectAll={(on) =>
                setSelected(on ? new Set(items.map((item) => item.id)) : new Set())
              }
            >
              {shown.length === 0 && (
                <div
                  role="status"
                  className="flex flex-col items-center gap-2 px-5 py-16 text-center"
                >
                  <EmptyStatusIcon
                    searching={kindFilter !== null || search.trim() !== ''}
                    status={
                      filter === 'finished' ? 'completed' : filter === 'failed' ? 'failed' : filter
                    }
                  />
                  <p className="text-[16px] font-semibold">
                    {kindFilter !== null || search.trim() !== ''
                      ? t('No matching downloads')
                      : (emptyMessages()[filter] ?? t('No downloads'))}
                  </p>
                  <Button type="button" variant="secondary" onClick={showAll}>
                    {t('Show all downloads')}
                  </Button>
                </div>
              )}
              {shown.map((entry) =>
                entry.type === 'item' ? (
                  <DownloadRow
                    key={entry.id}
                    item={entry.item}
                    queuePosition={positions.get(entry.id)}
                    selected={selected.has(entry.id)}
                    hit={filtered.hits.has(entry.id)}
                    handlers={handlers}
                    getVisual={getVisual}
                    visualsKey={visualsKey}
                  />
                ) : (
                  <GroupTableRow
                    key={entry.id}
                    entry={entry.entry}
                    selected={selected}
                    only={filtered.only?.get(entry.id)}
                    forceOpen={filtered.only !== null}
                    hits={filtered.hits}
                    getVisual={getVisual}
                    onToggle={toggle}
                    onSelect={selectRow}
                    onOpen={openRow}
                    handlers={handlers}
                  />
                )
              )}
            </DownloadsTable>
          </TableBoundary>
        )}
      </div>
      <FixLinkDialog download={fixing} onClose={() => setFixing(null)} />
      {limitsDialog}

      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => !open && setConfirmation(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || confirmationItems.length === 0}
              className={buttonVariants({
                variant: confirmation?.kind === 'remove' ? 'default' : 'destructive',
                size: 'sm'
              })}
              onClick={() => {
                if (confirmation?.kind === 'again') {
                  const [item] = confirmationItems
                  setConfirmation(null)
                  if (item) {
                    removeDownload(item.id)
                    openNewDownload(item.url)
                  }
                  return
                }
                void runAction(
                  confirmationItems,
                  confirmation?.kind === 'trash' ? 'trash' : 'remove'
                )
              }}
            >
              {confirmButton}
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
const PASTE_SHORTCUT = window.lightning.platform === 'darwin' ? '⌘V' : 'Ctrl+V'
const NEW_SHORTCUT = window.lightning.platform === 'darwin' ? '⌘N' : 'Ctrl+N'

/** Nothing listed yet: how to start one — or, with no network connected, how to get one. */
function EmptyState(): React.JSX.Element {
  const noNetworks = useAppStore(
    (store) =>
      store.interfacesStatus === 'ready' &&
      store.interfaces.length === 0 &&
      store.vpnInterfaces.length === 0
  )
  const loadInterfaces = useAppStore((store) => store.loadInterfaces)
  const openNewDownload = useAppStore((store) => store.openNewDownload)
  const openMultiLinks = useAppStore((store) => store.openMultiLinks)

  return (
    <div className="flex flex-col items-center gap-4 px-5 pt-16 pb-10 text-center">
      <CombineDiagram networks={PLACEHOLDER_NETWORKS} muted />
      {noNetworks ? (
        <>
          <div className="font-sans text-[16px] leading-[1.2] font-bold">
            {t('No networks connected')}
          </div>
          <div className="max-w-[380px] text-[12.5px] leading-[1.6] text-[var(--text-secondary)]">
            {t(
              'Lightning needs at least one active network. Join a Wi-Fi network, plug in Ethernet, or connect your phone using USB tethering.'
            )}
          </div>
          <div className="mt-1 flex gap-2">
            <Button type="button" variant="secondary" onClick={() => loadInterfaces()}>
              {t('Scan again')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => window.lightning.openNetworkSettings()}
            >
              {t('Network settings…')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="font-sans text-[16px] leading-[1.2] font-bold">
            {t('No downloads yet')}
          </div>
          <div className="max-w-[380px] text-[12.5px] leading-[1.6] text-[var(--text-secondary)]">
            {t('Paste a link ({shortcut}) or drop a .torrent anywhere in this window.', {
              shortcut: PASTE_SHORTCUT
            })}
          </div>
          <Button type="button" variant="secondary" onClick={() => openMultiLinks()}>
            <ListPlus data-icon="inline-start" />
            {t('Add several links')}
          </Button>
          <Button type="button" className="mt-1" onClick={() => openNewDownload()}>
            <Plus data-icon="inline-start" />
            {t('New download')}
            <span
              dir="ltr"
              className="ms-1.5 rounded-[5px] bg-white/20 px-[7px] py-[3px] font-mono text-[12px] leading-none font-medium text-primary-foreground"
            >
              {NEW_SHORTCUT}
            </span>
          </Button>
        </>
      )}
    </div>
  )
}
