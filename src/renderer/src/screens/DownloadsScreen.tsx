import type { DownloadState } from '@shared/types'
import {
  ChevronDown,
  ChevronUp,
  Link2,
  ListPlus,
  Pause,
  Play,
  Plus,
  Search,
  Settings,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CombineDiagram } from '../components/CombineDiagram'
import { filterLabel } from '../components/downloadFilterLabels'
import { DownloadRow } from '../components/downloads/DownloadRow'
import type { RowHandlers } from '../components/downloads/rowHelpers'
import { TableBoundary } from '../components/downloads/TableBoundary'
import { DownloadsTable } from '../components/downloads/DownloadsTable'
import { GroupTableRow } from '../components/downloads/GroupRows'
import { DownloadsSidebar } from '../components/downloads/Sidebar'
import { FixLinkDialog } from '../components/FixLinkDialog'
import { LimitsDialog } from '../components/LimitsDialog'
import { NetworksMenu } from '../components/NetworksMenu'
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
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../components/ui/dropdown-menu'
import { Input } from '../components/ui/input'
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
  sortEntries
} from '../utils/downloadList'
import { describeError, linkExpired } from '../utils/format'
import { isFinished, type Item } from '../utils/status'

const EMPTY_MESSAGES: Partial<Record<DownloadFilter, string>> = {
  progress: 'No downloads in progress',
  finished: 'No finished downloads',
  failed: 'No downloads need attention',
  downloading: 'Nothing is downloading right now',
  queued: 'Nothing is waiting in the queue',
  paused: 'Nothing is paused'
}

const platformTrash = (): string =>
  window.lightning.platform === 'win32' ? 'Recycle Bin' : 'Trash'

const isUnfinished = (item: Item): boolean => !isFinished(item) && item.status !== 'completed'
const isTrashable = (item: Item): boolean =>
  !isUnfinished(item) &&
  !(isFinished(item) && item.missing) &&
  (item.kind !== 'torrent' || !item.folder || !isFinished(item) || !!item.downloadedFiles?.length)

function SettingsButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button type="button" size="icon" variant="ghost" aria-label="Settings" onClick={onClick}>
            <Settings />
          </Button>
        }
      />
      <TooltipContent>Settings</TooltipContent>
    </Tooltip>
  )
}

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
  const [limitsOpen, setLimitsOpen] = useState(false)
  const [limitsPage, setLimitsPage] = useState<string | null>(null)
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
  const shown = useMemo(
    () => sortEntries(filterEntries(entries, filter, kindFilter, search), sort),
    [entries, filter, kindFilter, search, sort]
  )
  const [matchIndex, setMatchIndex] = useState(0)
  const matchCount = search.trim() === '' ? 0 : shown.length
  const stepMatch = (dir: 1 | -1): void => {
    if (matchCount === 0) return
    setMatchIndex((index) => (index + dir + matchCount) % matchCount)
  }
  useEffect(() => setMatchIndex(0), [search])
  useEffect(() => {
    if (matchCount === 0) return
    const row = document.querySelectorAll<HTMLElement>('[data-row-entry]')[matchIndex]
    row?.scrollIntoView({ block: 'nearest' })
  }, [matchIndex, matchCount, shown])

  // Every file of what is listed, a group's included, open or not.
  const items = useMemo(() => shown.flatMap(entryItems), [shown])
  // What is on screen top to bottom, for a Shift-click range.
  const orderedIds = useMemo(
    () =>
      shown.flatMap((entry) =>
        entry.type === 'item'
          ? [entry.item.id]
          : groupUi[entry.id]?.open
            ? entry.entry.items.map((item) => item.id)
            : []
      ),
    [shown, groupUi]
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
  // One button for both: it pauses while anything is running, and resumes once all is paused.
  const pausing = pausableAll.length > 0 || resumableAll.length === 0

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
  const noun = count === 1 ? 'download' : 'downloads'
  const confirmTitle =
    confirmation?.kind === 'cancel'
      ? `Cancel ${count} ${noun}?`
      : confirmation?.kind === 'trash'
        ? `Move ${count === 1 ? 'this file' : `${count} files`} to ${platformTrash()}?`
        : confirmation?.kind === 'remove'
          ? `Remove ${count} ${noun} from the list?`
          : 'Download this again?'
  const confirmText =
    confirmation?.kind === 'cancel'
      ? 'This stops the selected unfinished downloads and deletes their downloaded data. Finished downloads stay unchanged.'
      : confirmation?.kind === 'trash'
        ? `This moves the files to the ${platformTrash()} and removes them from the list. Unrelated files stay in place.`
        : confirmation?.kind === 'remove'
          ? 'Only the list entry goes. The downloaded files stay on your computer.'
          : 'It is taken off the list, any partly downloaded data is deleted, and the link opens in New download to start over.'
  const confirmButton =
    confirmation?.kind === 'cancel'
      ? 'Cancel downloads'
      : confirmation?.kind === 'trash'
        ? `Move to ${platformTrash()}`
        : confirmation?.kind === 'remove'
          ? 'Remove from list'
          : 'Start again'

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
                  aria-label={pausing ? 'Pause all' : 'Resume all'}
                  disabled={noDownloadsAtAll || (!pausing && resumableAll.length === 0)}
                  onClick={() =>
                    void (pausing
                      ? runAction(pausableAll, 'pause')
                      : runAction(resumableAll, 'resume'))
                  }
                >
                  {pausing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
                </Button>
              }
            />
            <TooltipContent>{pausing ? 'Pause all' : 'Resume all'}</TooltipContent>
          </Tooltip>
          <NetworksMenu
            onOpenLimits={(page) => {
              setLimitsPage(page)
              setLimitsOpen(true)
            }}
          />
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    render={<Button type="button" size="icon" aria-label="New download" />}
                  >
                    <Plus />
                  </DropdownMenuTrigger>
                }
              />
              <TooltipContent>New download</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => openNewDownload()}>
                <Link2 />
                One link
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openMultiLinks()}>
                <ListPlus />
                Several links
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* After the + button, so a VPN turning up doesn't move it. */}
          <VpnControl />
          <div className="flex-1" />
          <div className="relative w-[260px] min-w-[140px] shrink">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchInput}
              type="search"
              disabled={noDownloadsAtAll}
              aria-label="Search downloads"
              placeholder="Search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setSearch('')
                  event.currentTarget.blur()
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  stepMatch(event.shiftKey ? -1 : 1)
                }
              }}
              className="h-8 pr-[92px] pl-7 text-[12.5px] [&::-webkit-search-cancel-button]:hidden"
            />
            {search.trim() !== '' && (
              <span className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
                <span className="px-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {matchCount === 0 ? '0/0' : `${matchIndex + 1}/${matchCount}`}
                </span>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Previous result"
                  disabled={matchCount === 0}
                  onClick={() => stepMatch(-1)}
                >
                  <ChevronUp />
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Next result"
                  disabled={matchCount === 0}
                  onClick={() => stepMatch(1)}
                >
                  <ChevronDown />
                </Button>
              </span>
            )}
          </div>
          <SettingsButton onClick={onOpenSettings} />
        </div>
      ) : (
        <div
          role="toolbar"
          aria-label="Selected downloads"
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
          </div>
          <SettingsButton onClick={onOpenSettings} />
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
          <>
            <DownloadsSidebar
              counts={counts}
              filter={filter}
              kind={kindFilter}
              onFilter={chooseFilter}
              onKind={(kind) => {
                setKindFilter(kind)
                setSelected(new Set())
              }}
              canClear={history.length > 0}
              onClear={() => void window.lightning.clearHistory()}
            />
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
                    <p className="text-[16px] font-semibold">
                      {kindFilter !== null || search.trim() !== ''
                        ? 'No matching downloads'
                        : (EMPTY_MESSAGES[filter] ?? 'No downloads')}
                    </p>
                    <Button type="button" variant="secondary" onClick={showAll}>
                      Show all downloads
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
                      handlers={handlers}
                      getVisual={getVisual}
                      visualsKey={visualsKey}
                    />
                  ) : (
                    <GroupTableRow
                      key={entry.id}
                      entry={entry.entry}
                      selected={selected}
                      getVisual={getVisual}
                      onToggle={toggle}
                      onSelect={selectRow}
                      onOpen={openRow}
                    />
                  )
                )}
              </DownloadsTable>
            </TableBoundary>
          </>
        )}
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
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
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
          <div className="font-sans text-[16px] leading-[1.2] font-bold">No networks connected</div>
          <div className="max-w-[380px] text-[12.5px] leading-[1.6] text-[var(--text-secondary)]">
            Lightning needs at least one active network. Join a Wi-Fi network, plug in Ethernet, or
            connect your phone using USB tethering.
          </div>
          <div className="mt-1 flex gap-2">
            <Button type="button" variant="secondary" onClick={() => loadInterfaces()}>
              Scan again
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => window.lightning.openNetworkSettings()}
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
