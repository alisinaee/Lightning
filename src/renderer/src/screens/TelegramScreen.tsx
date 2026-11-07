import type { TdlItem, TdlJob, TgMediaKind } from '@shared/telegram'
import { EmptyStatusIcon } from '../components/EmptyIcon'
import { TelegramIcon } from '../components/telegram/TelegramIcon'
import { ListPlus, Plus, Warning as TriangleAlert, User, X } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { TelegramItemRow } from '../components/telegram/TelegramItemRow'
import { NetworksMenu } from '../components/NetworksMenu'
import { VpnControl } from '../components/VpnControl'
import { NewMenu, PauseAllButton, SearchField, SettingsButton } from '../components/ListTopBar'
import { useLimitsDialog } from '../hooks/useLimitsDialog'
import { TelegramJobGroup } from '../components/telegram/TelegramJobGroup'
import { columnsFor, jobTitle, columnsContext } from '../components/telegram/telegramRowInfo'
import type { SettingsPage } from '../components/SettingsDialog'
import { useAppStore } from '../store/useAppStore'
import {
  isActiveJob,
  isFailedJob,
  isFinishedJob,
  useTelegramStore,
  type TelegramJobFilter
} from '../store/useTelegramStore'

interface Entry {
  job: TdlJob
  items: TdlItem[]
  group: boolean
}

const EMPTY_FILTERED: Record<TelegramJobFilter, string> = {
  all: 'Nothing matches',
  active: 'No Telegram downloads in progress',
  finished: 'No finished Telegram downloads',
  failed: 'No Telegram downloads need attention'
}

const matchesJob = (job: TdlJob, filter: TelegramJobFilter): boolean =>
  filter === 'all' ||
  (filter === 'active' && isActiveJob(job)) ||
  (filter === 'finished' && isFinishedJob(job)) ||
  (filter === 'failed' && isFailedJob(job))

export function TelegramScreen({
  onOpenSettings
}: {
  onOpenSettings: (page?: SettingsPage) => void
}): React.JSX.Element {
  const view = useAppStore((store) => store.view)
  const kind: TgMediaKind | null = view.name === 'telegram' ? view.kind : null
  const jobs = useTelegramStore((store) => store.jobs)
  const status = useTelegramStore((store) => store.status)
  const jobFilter = useTelegramStore((store) => store.jobFilter)
  const search = useTelegramStore((store) => store.search)
  const setSearch = useTelegramStore((store) => store.setSearch)
  const selected = useTelegramStore((store) => store.selected)
  const setSelected = useTelegramStore((store) => store.setSelected)
  const expanded = useTelegramStore((store) => store.expanded)
  const toggleExpanded = useTelegramStore((store) => store.toggleExpanded)
  const openAdd = useTelegramStore((store) => store.openAdd)
  const openExport = useTelegramStore((store) => store.openExport)
  const openLogin = useTelegramStore((store) => store.openLogin)
  const { openLimits, limitsDialog } = useLimitsDialog()
  const [matchIndex, setMatchIndex] = useState(0)

  const [width, setWidth] = useState(1000)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = listRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [status?.loggedIn, status?.binary])
  const columns = useMemo(() => columnsFor(width), [width])

  const allJobs = useMemo(
    () => Object.values(jobs).sort((a, b) => b.createdAt - a.createdAt),
    [jobs]
  )
  const needle = search.trim().toLowerCase()

  const entries = useMemo(() => {
    const list: Entry[] = []
    for (const job of allJobs) {
      if (!matchesJob(job, jobFilter)) continue
      const items = job.items.filter(
        (item) =>
          (kind === null || item.media === kind) &&
          (!needle ||
            item.fileName.toLowerCase().includes(needle) ||
            jobTitle(job).toLowerCase().includes(needle))
      )
      const narrowed = kind !== null || needle !== ''
      if (items.length === 0 && (narrowed || job.items.length > 0)) continue
      list.push({ job, items, group: job.items.length > 1 || job.source.type === 'export' })
    }
    return list
  }, [allJobs, jobFilter, kind, needle])

  // The rows a search finds, in order: Enter and the arrows step through them and scroll to each.
  const hitIds = useMemo(
    () => (needle === '' ? [] : entries.map((entry) => entry.job.id)),
    [entries, needle]
  )
  const stepMatch = (dir: 1 | -1): void => {
    if (hitIds.length === 0) return
    setMatchIndex((index) => (index + dir + hitIds.length) % hitIds.length)
  }
  useEffect(() => {
    const id = hitIds[matchIndex]
    if (id)
      document
        .querySelector(`[data-row-entry="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
  }, [matchIndex, hitIds])

  const chosen = allJobs.filter((job) => selected.has(job.id))
  const running = allJobs.filter((job) => job.status === 'running' || job.status === 'queued')
  const paused = allJobs.filter((job) => job.status === 'paused')
  const pausing = running.length > 0
  const act = (list: TdlJob[], call: (id: string) => Promise<void>): void => {
    for (const job of list) void call(job.id).catch(() => {})
  }
  const pausable = chosen.filter((job) => job.status === 'running' || job.status === 'queued')
  const resumable = chosen.filter((job) => job.status === 'paused')
  const retryable = chosen.filter((job) => isFailedJob(job) && !isActiveJob(job))
  const removeChosen = (): void => {
    for (const job of chosen) {
      void window.lightning
        .tdlRemoveJob(job.id)
        .then(() => useTelegramStore.getState().removeJobLocal(job.id))
        .catch(() => {})
    }
  }

  const select = (id: string, on: boolean): void => {
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    setSelected(next)
  }

  // Keyboard, as on Downloads: Esc lets go of the selection, ⌘/Ctrl+A takes everything listed.
  // Not while typing in a box or a dialog is open, so those keep their own keys.
  useEffect(() => {
    const mod = window.lightning.platform === 'darwin' ? 'metaKey' : 'ctrlKey'
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName))
      if (typing || document.querySelector('[role="dialog"]')) return
      if (event.key === 'Escape') setSelected(new Set())
      else if (event[mod] && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSelected(new Set(entries.map((entry) => entry.job.id)))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [entries, setSelected])

  const ready = status?.binary && status.loggedIn
  const accountLabel = status?.loggedIn ? (status.account ?? 'Signed in') : 'Sign in'

  return (
    <div className="flex h-full min-w-0 flex-1 bg-background">
      <div className="@container flex min-w-0 flex-1 flex-col">
        {limitsDialog}
        {chosen.length === 0 ? (
          <div className="flex h-12 shrink-0 items-center gap-2 overflow-hidden border-b-[0.5px] border-border px-3">
            <h1 className="sr-only">Telegram</h1>
            <PauseAllButton
              pausing={pausing}
              resumeLabel="Resume all"
              disabled={pausing ? false : paused.length === 0}
              onPause={() => act(running, window.lightning.tdlPauseJob)}
              onResume={() => act(paused, window.lightning.tdlResumeJob)}
            />
            <NetworksMenu onOpenLimits={openLimits} />
            <NewMenu
              label="New download"
              disabled={!ready}
              items={[
                { label: 'Telegram links', icon: Plus, run: () => openAdd() },
                { label: 'Export a chat', icon: ListPlus, run: openExport }
              ]}
            />
            {/* After the + button, so a VPN turning up doesn't move it. */}
            <VpnControl />
            <div className="flex-1" />
            <SearchField
              label="Search Telegram downloads"
              value={search}
              onChange={(value) => {
                setSearch(value)
                setMatchIndex(0)
              }}
              matches={needle === '' ? undefined : hitIds.length}
              matchIndex={matchIndex}
              onStep={stepMatch}
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!status?.binary}
                    onClick={() => openLogin()}
                    aria-label={`Telegram account: ${accountLabel}`}
                    className="max-w-[160px]"
                  >
                    <User data-icon="inline-start" />
                    <span className="truncate">{accountLabel}</span>
                  </Button>
                }
              />
              <TooltipContent>
                {status?.loggedIn ? 'Telegram account' : 'Sign in to Telegram'}
              </TooltipContent>
            </Tooltip>
            <SettingsButton label="Settings" onClick={() => onOpenSettings('Telegram')} />
          </div>
        ) : (
          <div
            role="toolbar"
            aria-label="Selected jobs"
            className="flex h-12 shrink-0 items-center gap-2 overflow-hidden border-b-[0.5px] border-border px-3"
          >
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Deselect all"
              onClick={() => setSelected(new Set())}
            >
              <X />
            </Button>
            <span className="shrink-0 text-[13px] font-semibold whitespace-nowrap">
              {chosen.length} selected
            </span>
            <div className="flex-1" />
            {pausable.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => act(pausable, window.lightning.tdlPauseJob)}
              >
                Pause ({pausable.length})
              </Button>
            )}
            {resumable.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => act(resumable, window.lightning.tdlResumeJob)}
              >
                Resume ({resumable.length})
              </Button>
            )}
            {retryable.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => act(retryable, window.lightning.tdlRetryJob)}
              >
                Retry ({retryable.length})
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              title="Takes them off the list; the files stay on your computer"
              onClick={removeChosen}
            >
              Remove from list ({chosen.length})
            </Button>
          </div>
        )}

        {status === null ? (
          <div className="flex-1" />
        ) : !status.binary ? (
          <div className="p-4">
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>The Telegram downloader is missing</AlertTitle>
              <AlertDescription>
                Lightning couldn’t start its bundled tdl program, so Telegram downloads are
                unavailable. Reinstalling Lightning restores it.
              </AlertDescription>
            </Alert>
          </div>
        ) : !status.loggedIn ? (
          <div className="flex flex-col items-center gap-4 px-5 pt-16 pb-10 text-center">
            <TelegramIcon className="size-14" />
            <div className="font-sans text-[16px] leading-[1.2] font-bold">Sign in to Telegram</div>
            <div className="max-w-[380px] text-[12.5px] leading-[1.6] text-[var(--text-secondary)]">
              Lightning downloads the files in messages you can see in your Telegram account. Choose
              how to sign in.
            </div>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={() => openLogin('qr')}>
                QR code
              </Button>
              <Button type="button" variant="secondary" onClick={() => openLogin('code')}>
                Phone number
              </Button>
              <Button type="button" variant="secondary" onClick={() => openLogin('desktop')}>
                Telegram Desktop
              </Button>
            </div>
          </div>
        ) : (
          <columnsContext.Provider value={columns}>
            <div
              ref={listRef}
              role="table"
              aria-label="Telegram downloads"
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              {entries.length > 0 && (
                <div
                  role="row"
                  style={{ gridTemplateColumns: columns.template }}
                  className="sticky top-0 z-10 grid h-8 shrink-0 items-center border-b-[0.5px] border-border bg-background text-[11px] font-medium text-muted-foreground"
                >
                  <div role="columnheader" className="flex items-center justify-center">
                    <Checkbox
                      aria-label="Select all"
                      checked={entries.length > 0 && entries.every((e) => selected.has(e.job.id))}
                      onCheckedChange={(on) =>
                        setSelected(on ? new Set(entries.map((entry) => entry.job.id)) : new Set())
                      }
                    />
                  </div>
                  <div role="columnheader" className="px-2">
                    Name
                  </div>
                  <div role="columnheader" className="px-2 text-right">
                    Size
                  </div>
                  <div role="columnheader" className="px-2">
                    Status
                  </div>
                  <div role="columnheader" className="px-2 text-right">
                    Speed
                  </div>
                  {columns.eta && (
                    <div role="columnheader" className="px-2 text-right">
                      Time left
                    </div>
                  )}
                  {columns.added && (
                    <div role="columnheader" className="px-2">
                      Added
                    </div>
                  )}
                  <div role="columnheader" />
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {entries.length === 0 ? (
                  <EmptyList
                    nothingAtAll={allJobs.length === 0}
                    message={EMPTY_FILTERED[jobFilter]}
                    filter={jobFilter}
                    onAdd={() => openAdd()}
                    onExport={openExport}
                  />
                ) : (
                  entries.map(({ job, items, group }) =>
                    group ? (
                      <TelegramJobGroup
                        key={job.id}
                        job={job}
                        items={items}
                        open={expanded.has(job.id)}
                        selected={selected.has(job.id)}
                        onToggle={() => toggleExpanded(job.id)}
                        onSelect={(on) => select(job.id, on)}
                      />
                    ) : (
                      <TelegramItemRow
                        key={job.id}
                        job={job}
                        item={items[0]}
                        selected={selected.has(job.id)}
                        onSelect={(on) => select(job.id, on)}
                      />
                    )
                  )
                )}
              </div>
            </div>
          </columnsContext.Provider>
        )}
        <div className="shrink-0 border-t-[0.5px] border-border px-3 py-1.5 text-[11.5px] text-muted-foreground">
          Telegram downloads use the default connection.
        </div>
      </div>
    </div>
  )
}

function EmptyList({
  nothingAtAll,
  message,
  filter,
  onAdd,
  onExport
}: {
  nothingAtAll: boolean
  message: string
  filter: TelegramJobFilter
  onAdd: () => void
  onExport: () => void
}): React.JSX.Element {
  if (!nothingAtAll) {
    return (
      <div className="flex flex-col items-center gap-2 px-5 pt-16 text-center text-[13px] text-muted-foreground">
        <EmptyStatusIcon
          status={
            filter === 'active'
              ? 'downloading'
              : filter === 'finished'
                ? 'completed'
                : filter === 'failed'
                  ? 'failed'
                  : 'all'
          }
        />
        {message}
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-4 px-5 pt-16 pb-10 text-center">
      <TelegramIcon className="size-14" />
      <div className="font-sans text-[16px] leading-[1.2] font-bold">No Telegram downloads yet</div>
      <div className="max-w-[380px] text-[12.5px] leading-[1.6] text-[var(--text-secondary)]">
        Copy a link to a Telegram message and Lightning offers to download it, or add links and
        whole chats here.
      </div>
      <div className="mt-1 flex gap-2">
        <Button type="button" onClick={onAdd}>
          <Plus data-icon="inline-start" />
          Add links
        </Button>
        <Button type="button" variant="secondary" onClick={onExport}>
          <ListPlus data-icon="inline-start" />
          Export chat…
        </Button>
      </div>
    </div>
  )
}
