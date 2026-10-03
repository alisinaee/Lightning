import type { DownloadState, FinishedDownload } from '@shared/types'
import { ChevronRight, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FixLinkDialog } from '../components/FixLinkDialog'
import { LimitsDialog } from '../components/LimitsDialog'
import { NetworksMenu } from '../components/NetworksMenu'
import { ScreenFooter } from '../components/ScreenFooter'
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
import { Checkbox } from '../components/ui/checkbox'
import { Switch } from '../components/ui/switch'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { useAppStore } from '../store/useAppStore'
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
  wantedBytes
} from '../utils/format'

type Item = DownloadState | FinishedDownload

interface Group {
  label: string
  items: Item[]
}

const isFinished = (item: Item): item is FinishedDownload => 'unitsWritten' in item

function groupsOf(downloads: DownloadState[], history: FinishedDownload[]): Group[] {
  const byStatus = (status: DownloadState['status']): DownloadState[] =>
    downloads.filter((download) => download.status === status)
  return [
    { label: 'Downloading', items: byStatus('downloading') },
    {
      label: 'Queued',
      items: byStatus('queued').sort((a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0))
    },
    { label: 'Paused', items: byStatus('paused') },
    { label: 'Needs attention', items: byStatus('error') },
    // Completed but not in history yet: on its way there, so listed with it.
    { label: 'Finished', items: [...byStatus('completed'), ...history] }
  ].filter((group) => group.items.length > 0)
}

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
  const setView = useAppStore((store) => store.setView)
  const removeDownload = useAppStore((store) => store.removeDownload)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [fixing, setFixing] = useState<DownloadState | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [limitsOpen, setLimitsOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(interval)
  }, [])

  const downloads = Object.values(downloadsById)
    .filter((download) => download.status !== 'cancelled')
    .sort((a, b) => a.startedAt - b.startedAt)
  const groups = groupsOf(downloads, history)
  const items = groups.flatMap((group) => group.items)
  // Only what's still listed counts: one that finished or went is no longer selected.
  const chosen = items.filter((item) => selected.has(item.id))

  const toggle = (ids: string[], on: boolean): void =>
    setSelected((previous) => {
      const next = new Set(previous)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })

  const pausable = chosen.filter(
    (item): item is DownloadState =>
      !isFinished(item) && (item.status === 'downloading' || item.status === 'queued')
  )
  const resumable = chosen.filter(
    (item): item is DownloadState =>
      !isFinished(item) &&
      (item.status === 'paused' || (item.status === 'error' && item.resumable !== false))
  )
  const unfinished = chosen.filter((item) => !isFinished(item) && item.status !== 'completed')

  const removeChosen = (): void => {
    for (const item of chosen) removeDownload(item.id)
    setSelected(new Set())
    setConfirmingRemove(false)
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex shrink-0 items-center gap-3 border-b-[0.5px] border-border px-5 py-3.5">
        <h1 className="font-sans text-[17px] leading-none font-semibold">All downloads</h1>
        <div className="font-mono text-[11.5px] leading-none text-muted-foreground">
          {summaryOf(downloads)}
        </div>
        <div className="flex-1" />
        <NetworksMenu onOpenLimits={() => setLimitsOpen(true)} />
        <Button type="button" onClick={() => setView({ name: 'new' })}>
          <Plus data-icon="inline-start" />
          New download
        </Button>
      </div>

      {chosen.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b-[0.5px] border-border bg-card px-5 py-2">
          <div className="font-mono text-[11.5px] text-muted-foreground">
            {chosen.length} selected
          </div>
          <div className="flex-1" />
          {pausable.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => pausable.forEach((item) => void window.plexo.pauseDownload(item.id))}
            >
              Pause
            </Button>
          )}
          {resumable.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => resumable.forEach((item) => void window.plexo.resumeDownload(item.id))}
            >
              Resume
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => (unfinished.length > 0 ? setConfirmingRemove(true) : removeChosen())}
          >
            Remove
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Done
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {groups.map((group) => {
          const ids = group.items.map((item) => item.id)
          const all = ids.every((id) => selected.has(id))
          const some = !all && ids.some((id) => selected.has(id))
          return (
            <section key={group.label} aria-label={group.label}>
              <div className="flex items-center gap-3 border-b-[0.5px] border-border pt-5 pb-3">
                <Checkbox
                  aria-label={`Select every ${group.label.toLowerCase()} download`}
                  checked={all}
                  indeterminate={some}
                  onCheckedChange={(on) => toggle(ids, on)}
                />
                <h2 className={groupLabelClass}>
                  {group.label}
                  <span className="ml-2.5 tracking-normal">{group.items.length}</span>
                </h2>
                <div className="flex-1" />
                {group.label === 'Finished' && history.length > 0 && (
                  <button
                    type="button"
                    className="text-[12.5px] text-[var(--text-secondary)] hover:text-foreground"
                    onClick={() => void window.plexo.clearHistory()}
                  >
                    Clear list
                  </button>
                )}
              </div>
              {group.items.map((item) => (
                <DownloadRow
                  key={item.id}
                  item={item}
                  now={now}
                  selected={selected.has(item.id)}
                  onSelect={(on) => toggle([item.id], on)}
                  onOpen={() => setView({ name: 'download', id: item.id })}
                  onFix={() => !isFinished(item) && setFixing(item)}
                />
              ))}
            </section>
          )
        })}
      </div>

      <StatusBar downloads={downloads} />
      <FixLinkDialog download={fixing} onClose={() => setFixing(null)} />
      <LimitsDialog open={limitsOpen} onOpenChange={setLimitsOpen} />

      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {chosen.length} {chosen.length === 1 ? 'download' : 'downloads'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {unfinished.length === 1 ? 'One isn’t' : `${unfinished.length} aren’t`} finished: what
              they’ve downloaded is lost. Finished files stay where they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive', size: 'sm' })}
              onClick={removeChosen}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const FREE_SPACE_POLL_MS = 30_000

/** Along the bottom: how fast everything is going and under what limit, the queue, the slow
 * mode switch, and the room left where downloads are saved. */
function StatusBar({ downloads }: { downloads: DownloadState[] }): React.JSX.Element {
  const speedLimit = useAppStore((store) => store.speedLimit)
  const slowMode = useAppStore((store) => store.slowMode)
  const slowModeSpeed = useAppStore((store) => store.slowModeSpeed)
  const setSlowMode = useAppStore((store) => store.setSlowMode)
  const destinationDir = useAppStore((store) => store.destinationDir)
  const [free, setFree] = useState<number | null>(null)

  useEffect(() => {
    let disposed = false
    const load = (): void => {
      void window.plexo
        .freeSpace(destinationDir)
        .then((bytes) => !disposed && setFree(bytes))
        .catch(() => {})
    }
    load()
    const interval = setInterval(load, FREE_SPACE_POLL_MS)
    return () => {
      disposed = true
      clearInterval(interval)
    }
  }, [destinationDir])

  const speed = downloads.reduce(
    (sum, download) => sum + (download.status === 'downloading' ? download.speedBytesPerSec : 0),
    0
  )
  const limit = slowMode ? slowModeSpeed : speedLimit
  const waiting = downloads.filter((download) => download.status === 'queued').length

  return (
    <ScreenFooter className="gap-4 font-mono text-[11.5px] text-muted-foreground">
      <span className="tabular-nums">
        ↓ <span className="text-foreground">{formatSpeed(speed)}</span>
        {limit !== undefined && ` · limit ${formatSpeed(limit)}`}
      </span>
      <span>{waiting === 0 ? 'Queue is empty' : `${waiting} waiting in the queue`}</span>
      <div className="flex-1" />
      <label className="flex items-center gap-2">
        Slow mode
        <Switch checked={slowMode} onCheckedChange={setSlowMode} />
      </label>
      {free !== null && <span>{formatBytes(free)} free</span>}
    </ScreenFooter>
  )
}

function DownloadRow({
  item,
  now,
  selected,
  onSelect,
  onOpen,
  onFix
}: {
  item: Item
  now: number
  selected: boolean
  onSelect: (on: boolean) => void
  onOpen: () => void
  onFix: () => void
}): React.JSX.Element {
  const networkVisual = useNetworkVisuals()
  const finished = isFinished(item) || item.status === 'completed'
  const badge = isFolder(item) ? 'DIR' : fileExtensionBadge(item.fileName)
  const wanted = wantedBytes(item)
  const percent = formatPercent(item.bytesDownloaded, wanted)

  let detail: string
  let tone = 'text-muted-foreground'
  let action: { label: string; run: () => void; danger?: boolean } | null = null
  if (isFinished(item) || item.status === 'completed') {
    detail = [
      formatBytes(wanted || item.bytesDownloaded),
      sourceOf(item),
      isFinished(item) && item.missing
        ? 'moved or deleted'
        : formatWhen(item.completedAt ?? now, now)
    ].join(' · ')
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
        action = { label: 'Pause', run: () => void window.plexo.pauseDownload(download.id) }
        break
      case 'queued':
        detail = `Waiting for a turn · ${sizes}`
        break
      case 'paused':
        detail = wanted > 0 ? `Paused at ${percent}% · ${sizes}` : `Paused · ${sizes}`
        action = { label: 'Resume', run: () => void window.plexo.resumeDownload(download.id) }
        break
      default:
        detail = describeError(download.error ?? 'Something went wrong')
        tone = 'text-[var(--color-danger)]'
        if (linkExpired(download)) action = { label: 'Fix', run: onFix, danger: true }
        else if (download.resumable !== false) {
          action = { label: 'Resume', run: () => void window.plexo.resumeDownload(download.id) }
        }
    }
  }

  // The bar shows each network's share of the file in its color; a failed one shows in red.
  const segments =
    finished || isFinished(item)
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
    <div className="flex items-center gap-3 border-b-[0.5px] border-border py-3">
      <Checkbox
        aria-label={`Select ${item.fileName}`}
        checked={selected}
        onCheckedChange={(on) => onSelect(on)}
      />
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-border bg-card font-mono text-[10px] font-semibold text-muted-foreground">
          {badge}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="truncate font-sans text-[14px] leading-tight font-medium">
            {item.fileName}
          </div>
          {segments.length > 0 && (
            <div className="flex h-1 overflow-hidden rounded-full bg-muted">
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
      {action && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className={`rounded-full px-3.5 ${action.danger ? 'text-[var(--color-danger)]' : 'text-primary'}`}
          onClick={action.run}
        >
          {action.label}
        </Button>
      )}
      <button
        type="button"
        aria-label={`Open ${item.fileName}`}
        onClick={onOpen}
        className="text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  )
}
