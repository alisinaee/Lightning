import type { DownloadState, FinishedDownload, GroupInfo, PendingGroupItem } from '@shared/types'
import { cn } from 'cn'
import { Download, Pause, Play, RotateCw, X } from 'lucide-react'
import { memo } from 'react'
import { useNetworkOptions } from '../hooks/useNetworkOptions'
import type { ResolveNetworkVisual } from '../hooks/useNetworkVisuals'
import { useAppStore } from '../store/useAppStore'
import { describeError, sourceOf } from '../utils/format'
import { chooseConnection, networksOf, type GroupFile } from '../utils/groupFiles'
import { describeItem, statusKeyOf, type RowInfo } from '../utils/status'
import { ConnectionPicker } from './ConnectionPicker'
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
} from './downloads/cells'
import { useColumns } from './downloads/columns'
import { chipsOf, onControl, ROW_CLASS, stateEdge } from './downloads/rowHelpers'
import { FormatBadge } from './downloads/FileKindIcon'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

export type GroupFileEntry =
  | { kind: 'download'; download: DownloadState }
  | { kind: 'finished'; download: DownloadState | FinishedDownload }
  | { kind: 'waiting'; item: PendingGroupItem }

const subject = (entry: GroupFileEntry): object =>
  entry.kind === 'waiting' ? entry.item : entry.download

/** One file in an open group, as a row of the same table: what it is, which connections it is on
 * and why, and its actions. */
export const GroupFileRow = memo(
  function GroupFileRow({
    group,
    entry,
    selected,
    onSelect,
    onOpen,
    onError,
    getVisual
  }: {
    group: GroupInfo
    entry: GroupFileEntry
    selected: boolean
    selecting?: boolean
    onSelect: (id: string, on: boolean) => void
    onOpen: (id: string) => void
    onError: (message: string) => void
    getVisual: ResolveNetworkVisual
    visualsKey?: string
  }): React.JSX.Element {
    const columns = useColumns()
    const options = useNetworkOptions()
    const removeDownload = useAppStore((store) => store.removeDownload)
    const auto = group.mode === 'auto'
    const id = entry.kind === 'waiting' ? entry.item.id : entry.download.id
    const name =
      entry.kind === 'waiting' ? entry.item.request.suggestedFileName : entry.download.fileName
    const pinned = auto && group.pinned.includes(id)
    const nameOf = (networkId: string): string =>
      options.find((option) => option.id === networkId)?.name ?? networkId
    const retryGroupFiles = async (groupId: string, only: string[]): Promise<void> => {
      const { failed } = await window.lightning.retryGroup(groupId, only)
      if (failed.length > 0) throw new Error(failed[0])
    }
    const attempt = (work: () => Promise<unknown>): void =>
      void work().catch((error: unknown) => onError(describeError(error)))

    let info: RowInfo
    let chips: ConnectionChip[] = []
    let reason = ''
    let action: { label: string; icon: typeof Pause; run: () => void } | null = null
    let host = ''

    if (entry.kind === 'waiting') {
      const planned = group.plannedNetworks[id]
      const chosen = pinned ? entry.item.request.interfaceIds : planned ? [planned] : []
      const failed = entry.item.error ? describeError(entry.item.error) : undefined
      info = {
        status: failed ? 'failed' : 'queued',
        label: failed ? 'Failed' : 'Queued',
        reason: failed?.split(/(?<=[.!?])\s/)[0],
        reasonFull: failed,
        percent: 0,
        bar: false,
        received: 0,
        total: entry.item.request.totalBytes,
        speed: 0,
        etaSeconds: null,
        addedAt: group.createdAt,
        missing: false
      }
      if (!failed && chosen.length > 0) reason = `next on ${chosen.map(nameOf).join(' + ')}`
      chips = chosen.map((networkId) => ({
        id: networkId,
        name: nameOf(networkId),
        color: options.find((option) => option.id === networkId)?.solid ?? 'currentColor'
      }))
      host = sourceOf(entry.item.request.url)
      if (failed) {
        action = {
          label: 'Retry',
          icon: RotateCw,
          run: () => attempt(() => retryGroupFiles(group.id, [id]))
        }
      }
    } else {
      const download = entry.download
      info = describeItem(download)
      host = sourceOf(download.url)
      chips = chipsOf(download, getVisual)
      if (entry.kind === 'download') {
        const live = entry.download
        if (live.status === 'downloading' || live.status === 'queued') {
          action = {
            label: 'Pause',
            icon: Pause,
            run: () => attempt(() => window.lightning.pauseDownload(id))
          }
        } else if (live.status === 'paused') {
          action = {
            label: 'Resume',
            icon: Play,
            run: () => attempt(() => window.lightning.resumeDownload(id))
          }
        } else if (live.status === 'error' && live.resumable !== false) {
          action = {
            label: 'Retry',
            icon: RotateCw,
            run: () => attempt(() => window.lightning.resumeDownload(id))
          }
        } else if (live.status === 'error') {
          // It can't continue (the file on the server changed, say): it starts again from a fresh
          // look at its link, in this group.
          action = {
            label: 'Download again',
            icon: Download,
            run: () => attempt(() => retryGroupFiles(group.id, [id]))
          }
        }
        if (auto && live.status === 'downloading') {
          const on = chips
          const fastest = [...group.plan.networks].sort((a, b) => b.baselineBps - a.baselineBps)[0]
          if (pinned) reason = 'your choice'
          else if (on.length > 1) reason = 'extra connections are helping'
          else if (on.length === 1 && fastest?.id === on[0].id) reason = 'fastest network'
          else if (on.length === 1) reason = 'its own network'
        } else if (pinned) reason = 'your choice'
      }
    }

    const file: GroupFile | null =
      entry.kind === 'waiting'
        ? { kind: 'waiting', item: entry.item }
        : entry.kind === 'download'
          ? { kind: 'download', download: entry.download }
          : null

    const remove = (): void => {
      if (entry.kind === 'waiting') attempt(() => window.lightning.removeGroupItem(group.id, id))
      else if (
        entry.kind === 'download' &&
        entry.download.bytesDownloaded > 0 &&
        !window.confirm(`Remove ${name}? The part already downloaded is deleted.`)
      )
        return
      else removeDownload(id)
    }

    const finished = info.status === 'completed'
    const cells: Record<string, React.JSX.Element> = {
      name: (
        <div key="name" role="cell" className={cn(cellClass, 'gap-2.5 pl-9')}>
          <FormatBadge
            name={name}
            size="sm"
            kind={
              entry.kind !== 'waiting' && entry.download.kind === 'torrent' ? 'torrent' : undefined
            }
          />
          {entry.kind === 'waiting' ? (
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <ClippedText text={name} className="text-[12.5px] leading-none font-medium" />
              <span className="truncate text-[11px] leading-none text-muted-foreground">
                {[host, reason].filter(Boolean).join(' · ')}
              </span>
            </span>
          ) : (
            <button
              type="button"
              aria-label={`Open ${name}`}
              onClick={() => onOpen(id)}
              className="flex min-w-0 flex-1 flex-col gap-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ClippedText
                text={name}
                className={cn(
                  'text-[12.5px] leading-none font-medium',
                  finished && 'text-[var(--text-secondary)]'
                )}
              />
              <span className="truncate text-[11px] leading-none text-muted-foreground">
                {[host, pinned && 'pinned by you', !pinned && reason].filter(Boolean).join(' · ')}
              </span>
            </button>
          )}
        </div>
      ),
      size: (
        <SizeCell
          key="size"
          received={info.received}
          total={info.total}
          running={!finished && entry.kind !== 'waiting'}
          done={finished}
        />
      ),
      status: <StatusCell key="status" info={info} />,
      speed: <SpeedCell key="speed" speed={info.speed} />,
      eta: <EtaCell key="eta" seconds={info.etaSeconds} />,
      added: (
        <AddedCell key="added" at={finished ? (info.completedAt ?? info.addedAt) : info.addedAt} />
      ),
      connections: <ConnectionsCell key="connections" chips={chips} />
    }

    return (
      <div
        role="row"
        data-selected={selected || undefined}
        data-status={info.status}
        onDoubleClick={(event) => {
          if (entry.kind !== 'waiting' && !onControl(event.target)) onOpen(id)
        }}
        className={cn(ROW_CLASS, 'bg-card/40', selected && 'bg-primary/10 hover:bg-primary/15')}
        style={
          entry.kind === 'waiting' ? undefined : stateEdge(statusKeyOf(entry.download), selected)
        }
      >
        <div role="cell" className="flex items-center justify-center">
          {entry.kind !== 'waiting' && (
            <Checkbox
              aria-label={`Select ${name}`}
              checked={selected}
              onCheckedChange={(on) => onSelect(id, on)}
            />
          )}
        </div>
        {columns.map((column) => cells[column])}
        <div role="cell" className="flex items-center justify-end gap-0.5 px-1.5">
          {file && (
            <ConnectionPicker
              iconOnly
              // A general rule decides for every file.
              disabled={group.mode === 'manual' && group.rule === 'general'}
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
                    className="text-muted-foreground hover:text-foreground"
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
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X />
                </Button>
              }
            />
            <TooltipContent>
              {entry.kind === 'finished' ? 'Remove from list' : 'Remove from group'}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    )
  },
  (a, b) =>
    a.entry.kind === b.entry.kind &&
    subject(a.entry) === subject(b.entry) &&
    a.selected === b.selected &&
    a.group === b.group &&
    a.visualsKey === b.visualsKey &&
    a.onSelect === b.onSelect &&
    a.onOpen === b.onOpen &&
    a.onError === b.onError &&
    a.getVisual === b.getVisual
)
