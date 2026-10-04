import type { DownloadState, FinishedDownload, GroupInfo, PendingGroupItem } from '@shared/types'
import { cn } from 'cn'
import { ChevronRight, Pause, Play, RotateCw, X } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { useNetworkOptions } from '../hooks/useNetworkOptions'
import type { ResolveNetworkVisual } from '../hooks/useNetworkVisuals'
import {
  describeError,
  formatBytes,
  formatEta,
  formatPercent,
  formatSpeed,
  wantedBytes
} from '../utils/format'
import { chooseConnection, networksOf, type GroupFile } from '../utils/groupFiles'
import { ConnectionPicker } from './ConnectionPicker'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

export type GroupFileEntry =
  | { kind: 'download'; download: DownloadState }
  | { kind: 'finished'; download: DownloadState | FinishedDownload }
  | { kind: 'waiting'; item: PendingGroupItem }

/** One file in an open group: what it is, which connections it is on and why, and its actions. */
export function GroupFileRow({
  group,
  entry,
  selected,
  selecting,
  networkVisual,
  onSelect,
  onOpen,
  onError
}: {
  group: GroupInfo
  entry: GroupFileEntry
  selected: boolean
  selecting: boolean
  networkVisual: ResolveNetworkVisual
  onSelect: (id: string, on: boolean) => void
  onOpen: (id: string) => void
  onError: (message: string) => void
}): React.JSX.Element {
  const options = useNetworkOptions()
  const removeDownload = useAppStore((store) => store.removeDownload)
  const auto = group.mode === 'auto'
  const id = entry.kind === 'waiting' ? entry.item.id : entry.download.id
  const name =
    entry.kind === 'waiting' ? entry.item.request.suggestedFileName : entry.download.fileName
  const pinned = auto && group.pinned.includes(id)
  const nameOf = (networkId: string): string =>
    options.find((option) => option.id === networkId)?.name ?? networkId

  let status = ''
  let tone = 'text-muted-foreground'
  let size = ''
  let percent = 0
  let speed = 0
  let chips: { id: string; name: string; color: string; speed: number }[] = []
  let reason = ''
  let action: { label: string; icon: typeof Pause; run: () => void } | null = null
  const attempt = (work: () => Promise<unknown>): void =>
    void work().catch((error: unknown) => onError(describeError(error)))

  if (entry.kind === 'waiting') {
    const planned = group.plannedNetworks[id]
    const chosen = pinned ? entry.item.request.interfaceIds : planned ? [planned] : []
    size = formatBytes(entry.item.request.totalBytes)
    if (entry.item.error) {
      status = describeError(entry.item.error)
      tone = 'text-[var(--color-danger)]'
    } else {
      status = 'Waiting for a network'
      reason = chosen.length > 0 ? `waiting for ${chosen.map(nameOf).join(' + ')}` : ''
    }
    chips = chosen.map((networkId) => ({
      id: networkId,
      name: nameOf(networkId),
      color: options.find((option) => option.id === networkId)?.solid ?? 'currentColor',
      speed: 0
    }))
  } else if (entry.kind === 'finished') {
    const wanted = wantedBytes(entry.download)
    size = formatBytes(wanted || entry.download.bytesDownloaded)
    status = 'Finished'
    percent = 100
  } else {
    const download = entry.download
    const wanted = wantedBytes(download)
    percent = formatPercent(download.bytesDownloaded, wanted)
    size =
      wanted > 0
        ? `${formatBytes(download.bytesDownloaded)} of ${formatBytes(wanted)}`
        : formatBytes(download.bytesDownloaded)
    speed = download.status === 'downloading' ? download.speedBytesPerSec : 0
    const on = download.networks.filter((network) => network.enabled)
    chips = on.map((network) => ({
      id: network.id,
      name: networkVisual(network.id, network.kind, network.label).name,
      color: networkVisual(network.id, network.kind, network.label).solid,
      speed: download.status === 'downloading' ? network.speedBytesPerSec : 0
    }))
    switch (download.status) {
      case 'downloading':
        status = [
          wanted > 0 && `${percent}%`,
          wanted > 0 && speed > 0 && formatEta(wanted - download.bytesDownloaded, speed)
        ]
          .filter(Boolean)
          .join(' · ')
        action = {
          label: 'Pause',
          icon: Pause,
          run: () => attempt(() => window.plexo.pauseDownload(id))
        }
        break
      case 'queued':
        status = 'Waiting for a turn'
        action = {
          label: 'Pause',
          icon: Pause,
          run: () => attempt(() => window.plexo.pauseDownload(id))
        }
        break
      case 'paused':
        status = wanted > 0 ? `Paused at ${percent}%` : 'Paused'
        action = {
          label: 'Resume',
          icon: Play,
          run: () => attempt(() => window.plexo.resumeDownload(id))
        }
        break
      default:
        status = describeError(download.error ?? 'Something went wrong')
        tone = 'text-[var(--color-danger)]'
        if (download.resumable !== false) {
          action = {
            label: 'Retry',
            icon: RotateCw,
            run: () => attempt(() => window.plexo.resumeDownload(id))
          }
        }
    }
    if (auto && download.status === 'downloading') {
      const fastest = [...group.plan.networks].sort((a, b) => b.baselineBps - a.baselineBps)[0]
      if (pinned) reason = 'your choice'
      else if (on.length > 1) reason = 'extra connections are helping'
      else if (on.length === 1 && fastest?.id === on[0].id) reason = 'fastest network'
      else if (on.length === 1) reason = 'its own network'
    } else if (pinned) reason = 'your choice'
  }

  const file: GroupFile | null =
    entry.kind === 'waiting'
      ? { kind: 'waiting', item: entry.item }
      : entry.kind === 'download'
        ? { kind: 'download', download: entry.download }
        : null

  const remove = (): void => {
    if (entry.kind === 'waiting') attempt(() => window.plexo.removeGroupItem(group.id, id))
    else if (
      entry.kind === 'download' &&
      entry.download.bytesDownloaded > 0 &&
      !window.confirm(`Remove ${name}? The part already downloaded is deleted.`)
    )
      return
    else removeDownload(id)
  }

  return (
    <div
      className={cn(
        'group/file-row flex items-center gap-2 rounded-md px-1.5 py-1.5 text-[12.5px] hover:bg-secondary',
        selected && 'bg-primary/10'
      )}
    >
      {entry.kind !== 'waiting' && (
        <Checkbox
          className={cn(
            !selecting &&
              !selected &&
              'opacity-0 group-hover/file-row:opacity-100 focus-visible:opacity-100'
          )}
          aria-label={`Select ${name}`}
          checked={selected}
          onCheckedChange={(on) => onSelect(id, on)}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger render={<span className="truncate font-medium">{name}</span>} />
            <TooltipContent className="max-w-[min(560px,90vw)] break-all">{name}</TooltipContent>
          </Tooltip>
          {pinned && (
            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10.5px] text-primary">
              pinned by you
            </span>
          )}
        </div>
        {percent > 0 && percent < 100 && (
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary/70" style={{ width: `${percent}%` }} />
          </div>
        )}
        <div
          className={cn(
            'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px]',
            tone
          )}
        >
          <span className="truncate">{[size, status].filter(Boolean).join(' · ')}</span>
          {speed > 0 && <span className="font-mono">{formatSpeed(speed)}</span>}
          {chips.map((chip) => (
            <span key={chip.id} className="inline-flex items-center gap-1 text-muted-foreground">
              <span className="size-1.5 rounded-full" style={{ background: chip.color }} />
              {chip.name}
              {chip.speed > 0 && <span className="font-mono">{formatSpeed(chip.speed)}</span>}
            </span>
          ))}
          {reason && <span className="text-muted-foreground italic">· {reason}</span>}
        </div>
      </div>
      {file && (
        <ConnectionPicker
          iconOnly
          options={options}
          value={networksOf(group, file)}
          label={name}
          auto={
            auto
              ? { pinned, onAuto: () => attempt(() => chooseConnection(group, file, null)) }
              : undefined
          }
          onChange={(ids) => attempt(() => chooseConnection(group, file, ids))}
        />
      )}
      {action && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`${action.label} ${name}`}
                onClick={action.run}
                className="text-muted-foreground"
              >
                <action.icon />
              </Button>
            }
          />
          <TooltipContent>{action.label}</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Remove ${name}`}
              onClick={remove}
              className="text-muted-foreground"
            >
              <X />
            </Button>
          }
        />
        <TooltipContent>
          {entry.kind === 'finished' ? 'Remove from list' : 'Remove from group'}
        </TooltipContent>
      </Tooltip>
      {entry.kind !== 'waiting' && (
        <button
          type="button"
          aria-label={`Open ${name}`}
          onClick={() => onOpen(id)}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ChevronRight className="size-4" />
        </button>
      )}
    </div>
  )
}
