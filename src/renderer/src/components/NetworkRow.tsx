import type { HttpBlockState, HttpStreamState, NetworkStatus } from '@shared/types'
import { useState } from 'react'
import { DANGER, type NetworkVisual } from '../theme'
import type { HttpNetworkGroup, NetworkGroup, TorrentNetworkGroup } from '../utils/format'
import { formatBytes, formatSpeed } from '../utils/format'
import { ColorBadge } from './ColorBadge'
import { NetworkEditPopover } from './NetworkEditPopover'
import { TruncatedText } from './TruncatedText'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

interface NetworkRowProps {
  group: NetworkGroup
  visual: NetworkVisual
  sharePercent: number
  totalBytes?: number | null
  blocks?: HttpBlockState[]
  onSwitch: (enabled: boolean) => void
}

const STATUS_TEXT: Record<Exclude<NetworkStatus, 'on'>, string> = {
  off: 'Off',
  offline: 'Not connected',
  unreachable: 'Can’t reach server',
  failed: 'Failed'
}

const rowClass = 'col-span-full grid grid-cols-subgrid items-center gap-3'

function ProgressBar({
  percent,
  color,
  label,
  className
}: {
  percent: number
  color: string
  label: string
  className: string
}): React.JSX.Element {
  return (
    <div
      role="cell"
      className={`w-full overflow-hidden rounded-full border-[0.5px] border-[var(--border-strong)] bg-[var(--track-bg)] ${className}`}
    >
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(percent)}
        className="h-full rounded-full transition-[width] duration-200 ease-out"
        style={{ width: `${percent}%`, background: color }}
      />
    </div>
  )
}

function streamProgress(
  stream: HttpStreamState,
  blocks?: HttpBlockState[]
): {
  block: HttpBlockState | undefined
  done: boolean
  size: number
  downloaded: number
  percent: number
} {
  const block = stream.currentBlockIndex == null ? undefined : blocks?.[stream.currentBlockIndex]
  const done = stream.status === 'completed' || block?.status === 'completed'
  const size = block?.rangeEnd == null ? 0 : block.rangeEnd - block.rangeStart + 1
  const downloaded = block?.bytesDownloaded ?? stream.bytesDownloaded
  return {
    block,
    done,
    size,
    downloaded,
    percent: done ? 100 : size > 0 ? Math.min(100, (downloaded / size) * 100) : 0
  }
}

function HttpStreamRows({
  group,
  visual,
  blocks
}: {
  group: HttpNetworkGroup
  visual: NetworkVisual
  blocks?: HttpBlockState[]
}): React.JSX.Element {
  return (
    <>
      {group.streams.map((stream, index) => {
        const progress = streamProgress(stream, blocks)
        const active = stream.status === 'downloading'
        const status = progress.done
          ? 'Done'
          : stream.status === 'paused'
            ? 'Paused'
            : stream.status === 'retrying'
              ? 'Retrying…'
              : 'Idle'
        return (
          <div
            role="row"
            key={stream.id}
            className={`${rowClass} border-[var(--border-subtle)] bg-card py-[6px] font-mono text-[11px] leading-[1.2] ${index === 0 ? 'border-t-[0.5px] pt-[9px]' : ''} ${index === group.streams.length - 1 ? 'border-b-[0.5px] pb-[11px]' : ''}`}
          >
            <div role="cell" className="flex justify-center pl-5">
              <div
                className="size-[5px] rounded-full"
                style={{
                  background: active || progress.done ? visual.solid : 'var(--icon-muted)',
                  opacity: active || progress.done ? 1 : 0.4
                }}
              />
            </div>
            <div role="cell" className="flex min-w-0 items-center gap-[6px]">
              <span className="font-medium whitespace-nowrap text-foreground">
                Stream #{index + 1}
              </span>
              {progress.block && (
                <span className="rounded-[3px] border-[0.5px] border-border bg-secondary px-[4.5px] py-[1.5px] text-[9px] leading-none whitespace-nowrap text-muted-foreground">
                  Chunk #{progress.block.index + 1}
                </span>
              )}
              {active ? (
                <Tooltip disabled={!stream.hedge}>
                  <TooltipTrigger
                    render={
                      <ColorBadge
                        bg={visual.bg}
                        border={visual.border}
                        text={visual.text}
                        tabIndex={stream.hedge ? 0 : undefined}
                        className="h-[13px] rounded-[3px] px-[5px] py-px text-[9px] font-semibold tracking-[0.04em] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {stream.hedge ? 'BACKUP' : 'ACTIVE'}
                      </ColorBadge>
                    }
                  />
                  <TooltipContent>
                    Racing another stream for this chunk, which was running slowly
                  </TooltipContent>
                </Tooltip>
              ) : (
                <span
                  className={`text-[9.5px] ${stream.status === 'retrying' ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  {status}
                </span>
              )}
            </div>
            <ProgressBar
              className="h-[5px]"
              label={`Stream #${index + 1} progress`}
              percent={progress.percent}
              color={visual.solid}
            />
            <div
              role="cell"
              className="text-right font-mono text-[11px] leading-none font-medium tabular-nums"
              style={{
                color: progress.done ? visual.text : active ? 'var(--text)' : 'var(--text-tertiary)'
              }}
            >
              {progress.block || progress.done ? `${Math.round(progress.percent)}%` : '—'}
            </div>
            <div
              role="cell"
              className="text-right font-mono text-[11px] leading-none font-medium whitespace-nowrap tabular-nums"
              style={{ color: active ? visual.text : 'var(--text-tertiary)' }}
            >
              {active ? formatSpeed(stream.speedBytesPerSec) : '—'}
            </div>
            <div
              role="cell"
              className="pr-5 text-right font-mono text-[11px] leading-none whitespace-nowrap text-[var(--text-secondary)] tabular-nums"
            >
              {progress.size > 0
                ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.size)}`
                : formatBytes(progress.downloaded)}
            </div>
          </div>
        )
      })}
    </>
  )
}

function PeerRows({
  group,
  visual
}: {
  group: TorrentNetworkGroup
  visual: NetworkVisual
}): React.JSX.Element {
  return (
    <>
      {group.peers.map((peer, index) => {
        const receiving = peer.status === 'receiving' && peer.speedBytesPerSec > 0
        return (
          <div
            role="row"
            key={peer.id}
            className={`${rowClass} border-[var(--border-subtle)] bg-card py-[6px] font-mono text-[11px] leading-[1.2] ${index === 0 ? 'border-t-[0.5px] pt-[9px]' : ''} ${index === group.peers.length - 1 ? 'border-b-[0.5px] pb-[11px]' : ''}`}
          >
            <div role="cell" />
            <div role="cell" className="flex min-w-0 items-center gap-[6px]">
              <span className="font-medium whitespace-nowrap text-foreground">
                Peer #{index + 1}
              </span>
              <ColorBadge
                bg={visual.bg}
                border={visual.border}
                text={visual.text}
                className="h-[13px] rounded-[3px] px-[5px] py-px text-[9px] font-semibold tracking-[0.04em]"
              >
                {receiving ? 'RECEIVING' : 'CONNECTED'}
              </ColorBadge>
            </div>
            <div role="cell" />
            <div role="cell" />
            <div
              role="cell"
              className="text-right font-mono text-[10px] leading-[1.35] whitespace-nowrap tabular-nums"
            >
              {receiving && (
                <div style={{ color: visual.text }}>
                  <span aria-hidden>↓ </span>
                  {formatSpeed(peer.speedBytesPerSec)}
                </div>
              )}
              {peer.uploadSpeedBytesPerSec > 0 && (
                <div className="text-muted-foreground">
                  <span aria-hidden>↑ </span>
                  {formatSpeed(peer.uploadSpeedBytesPerSec)}
                </div>
              )}
            </div>
            <div
              role="cell"
              className="pr-5 text-right font-mono text-[10px] leading-[1.35] text-[var(--text-secondary)] tabular-nums"
            >
              {peer.bytesDownloaded > 0 && (
                <div>
                  <span aria-hidden>↓ </span>
                  {formatBytes(peer.bytesDownloaded)}
                </div>
              )}
              {peer.bytesUploaded > 0 && (
                <div>
                  <span aria-hidden>↑ </span>
                  {formatBytes(peer.bytesUploaded)}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}

export function NetworkRow({
  group,
  visual,
  sharePercent,
  totalBytes,
  blocks,
  onSwitch
}: NetworkRowProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const connections = group.transfer === 'http' ? group.streams : group.peers
  const isActive =
    group.transfer === 'http'
      ? group.streams.some((stream) => stream.status === 'downloading')
      : group.peers.some((peer) => peer.status === 'receiving')
  const hasError = group.status === 'failed'
  const rounded = Math.round(sharePercent)
  const shareLabel = group.bytesDownloaded === 0 ? '0%' : rounded === 0 ? '<1%' : `${rounded}%`
  const noun = group.transfer === 'http' ? 'stream' : 'peer'
  return (
    <>
      <div
        role="row"
        className={`${rowClass} border-t-[0.5px] border-[var(--border-subtle)] py-[11px]`}
      >
        <div
          role="cell"
          aria-label={hasError ? 'Error' : isActive ? 'Active' : 'Idle'}
          className="ml-5 size-2 rounded-full"
          style={{
            background: hasError ? DANGER : visual.solid,
            animation: isActive ? 'plexo-glow 1.8s infinite' : undefined,
            opacity: isActive || hasError ? 1 : 0.65
          }}
        />
        <div role="cell" className="flex min-w-0 items-center gap-[6px]">
          <Checkbox
            checked={group.enabled}
            onCheckedChange={(checked) => onSwitch(checked)}
            aria-label={`Use ${visual.name}`}
            className="shrink-0 data-checked:border-transparent"
            style={group.enabled ? { background: visual.solid, color: visual.onSolid } : undefined}
          />
          <TruncatedText
            text={visual.name}
            className={`font-sans text-[12.5px] leading-[1.2] font-semibold ${group.enabled ? 'text-foreground' : 'text-[var(--text-secondary)]'}`}
          />
          <NetworkEditPopover
            interfaceId={group.id}
            interfaceKind={group.kind}
            osName={group.label}
          />
          {connections.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              className="h-auto cursor-pointer rounded-[4px] border-[0.5px] bg-card px-[7px] py-[3px] font-mono text-[10.5px] leading-none font-medium text-[var(--text-secondary)] aria-expanded:bg-secondary dark:bg-card"
            >
              {connections.length} {noun}
              {connections.length === 1 ? '' : 's'}{' '}
              <span aria-hidden className="text-[7.5px] opacity-75">
                {expanded ? '▲' : '▼'}
              </span>
            </Button>
          )}
          {group.status !== 'on' && (
            <Tooltip disabled={!group.error}>
              <TooltipTrigger
                render={
                  <span
                    tabIndex={group.error ? 0 : undefined}
                    className={`rounded-sm font-mono text-[10px] whitespace-nowrap outline-none ${hasError ? 'text-destructive' : 'text-muted-foreground'}`}
                  >
                    {group.status === 'unreachable' && group.transfer === 'torrent'
                      ? 'Can’t reach peers'
                      : STATUS_TEXT[group.status]}
                  </span>
                }
              />
              <TooltipContent>{group.error}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <ProgressBar
          className="h-1.5"
          label={`${visual.name} progress`}
          percent={
            totalBytes && totalBytes > 0
              ? Math.min(100, (group.bytesDownloaded / totalBytes) * 100)
              : 0
          }
          color={visual.solid}
        />
        <div
          role="cell"
          className="text-right font-mono text-[11.5px] leading-none font-medium tabular-nums"
          style={{ color: sharePercent > 0 ? 'var(--text)' : 'var(--text-tertiary)' }}
        >
          {shareLabel}
        </div>
        <div
          role="cell"
          className="text-right font-mono text-[11px] leading-[1.35] font-semibold whitespace-nowrap tabular-nums"
          style={{ color: isActive ? visual.text : 'var(--text-tertiary)' }}
        >
          <div>
            <span className="sr-only">Downloading at </span>
            {group.transfer === 'torrent' && <span aria-hidden>↓ </span>}
            {isActive ? formatSpeed(group.speedBytesPerSec) : '—'}
          </div>
          {group.transfer === 'torrent' && (
            <div className="text-[10px] font-medium text-muted-foreground">
              <span className="sr-only">Uploading at </span>
              <span aria-hidden>↑ </span>
              {formatSpeed(group.uploadSpeedBytesPerSec)}
            </div>
          )}
        </div>
        <div
          role="cell"
          className="pr-5 text-right font-mono text-[11.5px] leading-none text-[var(--text-secondary)] tabular-nums"
        >
          {formatBytes(group.bytesDownloaded)}
        </div>
      </div>
      {expanded &&
        (group.transfer === 'http' ? (
          <HttpStreamRows group={group} visual={visual} blocks={blocks} />
        ) : (
          <PeerRows group={group} visual={visual} />
        ))}
    </>
  )
}
