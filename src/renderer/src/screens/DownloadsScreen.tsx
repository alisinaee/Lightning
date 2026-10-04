import type { DownloadState } from '@shared/types'
import { CirclePause, CirclePlay, ListPlus, Plus, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CombineDiagram } from '../components/CombineDiagram'
import { DownloadFilterMenu } from '../components/DownloadFilterMenu'
import { DownloadRow } from '../components/downloads/DownloadRow'
import type { RowHandlers } from '../components/downloads/rowHelpers'
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
  sortEntries,
  summaryOf
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

const platformTrash = (): string => (window.plexo.platform === 'win32' ? 'Recycle Bin' : 'Trash')

const isUnfinished = (item: Item): boolean => !isFinished(item) && item.status !== 'completed'
const isTrashable = (item: Item): boolean =>
  !isUnfinished(item) &&
  !(isFinished(item) && item.missing) &&
  (item.kind !== 'torrent' || !item.folder || !isFinished(item) || !!item.downloadedFiles?.length)

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
    kind: 'cancel' | 'trash'
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
  const filtering = filter !== 'all' || kindFilter !== null || search.trim() !== ''
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
        if (action === 'pause') await window.plexo.pauseDownload(item.id)
        else if (action === 'resume') await window.plexo.resumeDownload(item.id)
        else {
          await window.plexo.removeDownload(item.id, { trashFile: action === 'trash' })
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
  useEffect(() => {
    actionRef.current = runAction
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
      again: (item) => {
        removeDownload(item.id)
        openNewDownload(item.url)
      },
      cancel: (item) => setConfirmation({ kind: 'cancel', ids: [item.id] }),
      removeFromList: (item) => void actionRef.current([item], 'remove'),
      trash: (item) => setConfirmation({ kind: 'trash', ids: [item.id] })
    }),
    [toggle, setSelected, selectRow, openRow, removeDownload, openNewDownload]
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
  const unfinished = chosen.filter(isUnfinished)
  const finished = chosen.filter((item) => !isUnfinished(item))
  const trashable = finished.filter(isTrashable)
  const confirmationItems = confirmation
    ? allItems.filter(
        (item) =>
          confirmation.ids.includes(item.id) &&
          (confirmation.kind === 'cancel' ? isUnfinished(item) : isTrashable(item))
      )
    : []
  const pausableAll = downloads.filter(
    (download) => download.status === 'downloading' || download.status === 'queued'
  )
  const resumableAll = downloads.filter((download) => download.status === 'paused')

  // Keyboard, as a file manager has it: Esc lets go of the selection, ⌘/Ctrl+A takes everything
  // listed, ⌘/Ctrl+F goes to the search box.
  useEffect(() => {
    const mod = window.plexo.platform === 'darwin' ? 'metaKey' : 'ctrlKey'
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

  return (
    <div className="flex h-full flex-col bg-background">
      {chosen.length === 0 ? (
        <div className="flex h-12 shrink-0 items-center gap-2 overflow-hidden border-b-[0.5px] border-border px-3">
          <DownloadFilterMenu value={filter} counts={counts.statuses} onChange={chooseFilter} />
          {!noDownloadsAtAll && (
            <>
              <div className="relative w-[220px] min-w-[72px] shrink">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  ref={searchInput}
                  type="search"
                  aria-label="Search downloads"
                  placeholder="Search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setSearch('')
                      event.currentTarget.blur()
                    }
                  }}
                  className="h-8 pr-2 pl-7 text-[12.5px] [&::-webkit-search-cancel-button]:hidden"
                />
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="Pause all"
                      disabled={pausableAll.length === 0}
                      onClick={() => void runAction(pausableAll, 'pause')}
                    >
                      <CirclePause />
                    </Button>
                  }
                />
                <TooltipContent>Pause all</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="Resume all"
                      disabled={resumableAll.length === 0}
                      onClick={() => void runAction(resumableAll, 'resume')}
                    >
                      <CirclePlay />
                    </Button>
                  }
                />
                <TooltipContent>Resume all</TooltipContent>
              </Tooltip>
              {entries.length > 1 && (
                <div className="hidden truncate font-mono text-[11.5px] leading-none text-muted-foreground @min-[1100px]:block">
                  {summaryOf(downloads)}
                </div>
              )}
            </>
          )}
          <div className="flex-1" />
          <NetworksMenu
            onOpenLimits={(page) => {
              setLimitsPage(page)
              setLimitsOpen(true)
            }}
          />
          <VpnControl />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label="Add several links"
                  onClick={() => openMultiLinks()}
                >
                  <ListPlus />
                </Button>
              }
            />
            <TooltipContent>Add several links</TooltipContent>
          </Tooltip>
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
                Move files to {platformTrash()}… ({trashable.length})
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
              onClear={() => void window.plexo.clearHistory()}
            />
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
          </>
        )}
      </div>
      {filtering && !noDownloadsAtAll && shown.length > 0 && (
        <div className="flex h-7 shrink-0 items-center gap-3 border-t-[0.5px] border-border px-4 text-[11.5px] text-muted-foreground">
          <span>
            Showing {shown.length} of {entries.length}
          </span>
          <button type="button" className="hover:text-foreground hover:underline" onClick={showAll}>
            Show all downloads
          </button>
        </div>
      )}

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
              {confirmation?.kind === 'cancel' ? 'Cancel' : `Move files to ${platformTrash()} for`}{' '}
              {confirmationItems.length} {confirmationItems.length === 1 ? 'download' : 'downloads'}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.kind === 'cancel'
                ? 'This stops the selected unfinished downloads and deletes their downloaded data. Finished downloads stay unchanged.'
                : `This moves the selected finished downloads’ files to the ${platformTrash()} and removes them from the list. Unrelated files stay in place.`}
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
                : `Move files to ${platformTrash()}`}
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
