import type {
  DownloadState,
  FinishedDownload,
  GroupInfo,
  GroupMode,
  PendingGroupItem
} from '@shared/types'
import { cn } from 'cn'
import { AlertTriangle, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { defaultNetworkIds } from '@shared/networks'
import { useAppStore } from '../store/useAppStore'
import {
  describeError,
  formatBytes,
  formatPercent,
  formatSpeed,
  toDisplayPath,
  wantedBytes
} from '../utils/format'
import { linksIn, probeLinks, requestFor } from '../utils/links'
import { useNetworkOptions } from '../hooks/useNetworkOptions'
import { chooseConnection, networksOf, type GroupFile } from '../utils/groupFiles'
import { ConnectionPicker } from './ConnectionPicker'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from './ui/alert-dialog'
import { Button, buttonVariants } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

type FileRow =
  | { key: string; name: string; kind: 'live'; download: DownloadState }
  | { key: string; name: string; kind: 'done'; download: DownloadState | FinishedDownload }
  | { key: string; name: string; kind: 'waiting'; item: PendingGroupItem }

const fileOf = (row: Extract<FileRow, { kind: 'live' | 'waiting' }>): GroupFile =>
  row.kind === 'live'
    ? { kind: 'download', download: row.download }
    : { kind: 'waiting', item: row.item }

/** Rename a group, add links to it, take files out, and change which networks each file uses. */
export function GroupDialog(): React.JSX.Element {
  const groupId = useAppStore((store) => store.editingGroupId)
  const group = useAppStore((store) => store.groups.find((entry) => entry.id === groupId))
  const editGroup = useAppStore((store) => store.editGroup)

  return (
    <Dialog
      open={group !== undefined}
      disablePointerDismissal
      onOpenChange={(next) => !next && editGroup(null)}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[560px] max-h-[calc(100%-2rem)] min-h-[360px] w-[760px] max-w-[calc(100%-2rem)] min-w-[480px] resize flex-col gap-0 overflow-auto p-0 sm:max-w-[calc(100%-2rem)]"
      >
        {group && <GroupForm group={group} onDone={() => editGroup(null)} />}
      </DialogContent>
    </Dialog>
  )
}

function GroupForm({ group, onDone }: { group: GroupInfo; onDone: () => void }): React.JSX.Element {
  const downloads = useAppStore((store) => store.downloads)
  const history = useAppStore((store) => store.history)
  const interfaces = useAppStore((store) => store.interfaces)
  const homeDir = useAppStore((store) => store.homeDir)
  const removeDownload = useAppStore((store) => store.removeDownload)
  const networkOptions = useNetworkOptions()

  const [name, setName] = useState(group.name)
  // In the store, so what is typed survives anything that remounts the form.
  const text = useAppStore((store) => store.groupDrafts[group.id] ?? '')
  const setDraft = useAppStore((store) => store.setGroupDraft)
  const setText = (value: string): void => setDraft(group.id, value)
  const [adding, setAdding] = useState(false)
  const [addErrors, setAddErrors] = useState<string[]>([])
  const [removing, setRemoving] = useState<DownloadState | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // The networks the files added next use, in a manual group.
  const [newConnection, setNewConnection] = useState<string[]>(() =>
    defaultNetworkIds(
      interfaces,
      useAppStore.getState().networkPreferences,
      useAppStore.getState().useVpn
    )
  )

  const rows: FileRow[] = [
    ...history
      .filter((entry) => entry.groupId === group.id)
      .map((download): FileRow => ({
        key: download.id,
        name: download.fileName,
        kind: 'done',
        download
      })),
    ...Object.values(downloads)
      .filter((download) => download.groupId === group.id && download.status !== 'cancelled')
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((download): FileRow =>
        download.status === 'completed'
          ? { key: download.id, name: download.fileName, kind: 'done', download }
          : { key: download.id, name: download.fileName, kind: 'live', download }
      ),
    ...group.pending.map((item): FileRow => ({
      key: item.id,
      name: item.request.suggestedFileName,
      kind: 'waiting',
      item
    }))
  ]
  const manual = group.mode === 'manual'

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setActionError(null)
    try {
      await action()
    } catch (error) {
      setActionError(describeError(error))
    }
  }

  const commitName = (): void => {
    const next = name.trim()
    if (!next) setName(group.name)
    else if (next !== group.name) void run(() => window.plexo.updateGroup(group.id, { name: next }))
  }

  const setMode = (mode: GroupMode): void => {
    if (mode !== group.mode) void run(() => window.plexo.updateGroup(group.id, { mode }))
  }

  const handleAdd = (): void => {
    const { links } = linksIn(text)
    if (links.length === 0 || adding) return
    setAdding(true)
    setAddErrors([])
    const requests: ReturnType<typeof requestFor>[] = []
    const errors: string[] = []
    let left = links.length
    const finish = async (): Promise<void> => {
      try {
        if (requests.length > 0) {
          const { failed } = await window.plexo.addGroupItems(group.id, requests)
          errors.push(...failed)
        }
      } catch (error) {
        errors.push(describeError(error))
      }
      setAddErrors(errors)
      setText(errors.length === 0 ? '' : links.filter((link) => failedLinks.has(link)).join('\n'))
      setAdding(false)
    }
    const failedLinks = new Set<string>()
    const interfaceIds = manual
      ? newConnection
      : defaultNetworkIds(
          interfaces,
          useAppStore.getState().networkPreferences,
          useAppStore.getState().useVpn
        )
    probeLinks(links, window.plexo.probeUrl, (url, outcome) => {
      if ('result' in outcome) {
        requests.push(requestFor(outcome.result, group.destinationDir, interfaceIds))
      } else {
        failedLinks.add(url)
        errors.push(`${url}: ${describeError(outcome.error)}`)
      }
      if (--left === 0) void finish()
    })
  }

  const handleRemove = (row: FileRow): void => {
    if (row.kind === 'waiting') void run(() => window.plexo.removeGroupItem(group.id, row.item.id))
    else if (row.kind === 'done') removeDownload(row.download.id)
    // A download under way has partial data to lose: asked about first.
    else if (row.download.bytesDownloaded > 0) setRemoving(row.download)
    else removeDownload(row.download.id)
  }

  const found = linksIn(text).links.length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b-[0.5px] border-border px-5 py-4">
        <DialogTitle className="text-[16px] font-semibold">Edit group</DialogTitle>
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="w-24 shrink-0 text-[var(--text-secondary)]">Name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
            spellCheck={false}
            aria-label="Group name"
            className="h-9 min-w-0 flex-1 rounded-[9px] border border-input bg-[var(--input-bg)] px-3 text-[13px] text-foreground outline-none"
          />
        </div>
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="w-24 shrink-0 text-[var(--text-secondary)]">Saved to</span>
          <span
            className="min-w-0 flex-1 truncate font-mono text-[12px]"
            title={group.destinationDir}
          >
            {toDisplayPath(group.destinationDir, homeDir)}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[12.5px]">
          <span className="w-24 shrink-0 text-[var(--text-secondary)]">Connections</span>
          <ToggleGroup
            aria-label="How files are given networks"
            value={[group.mode]}
            onValueChange={(values) => {
              const next = values[0]
              if (next === 'auto' || next === 'manual') setMode(next)
            }}
            size="sm"
            spacing={0.5}
            className="bg-secondary p-0.5"
          >
            <ToggleGroupItem value="auto">Auto</ToggleGroupItem>
            <ToggleGroupItem value="manual">Manual</ToggleGroupItem>
          </ToggleGroup>
          <span className="min-w-0 flex-1 text-[11.5px] text-muted-foreground">
            {manual
              ? 'Pick the networks each file uses.'
              : 'Each file gets a network of its own, matched to how fast it is. Files wait for one to be free.'}
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
        <div className="flex min-h-[120px] flex-1 flex-col overflow-y-auto rounded-[9px] border-[0.5px] border-border">
          {rows.length === 0 && (
            <div className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">
              No files in this group.
            </div>
          )}
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex items-center gap-2 border-b-[0.5px] border-border px-3 py-2 text-[12.5px] last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <Tooltip>
                  <TooltipTrigger render={<div className="truncate font-medium">{row.name}</div>} />
                  <TooltipContent className="max-w-[min(560px,90vw)] break-all">
                    {row.name}
                  </TooltipContent>
                </Tooltip>
                <div
                  className={cn(
                    'truncate text-[11.5px] text-muted-foreground',
                    (row.kind === 'waiting' && row.item.error) ||
                      (row.kind === 'live' && row.download.status === 'error')
                      ? 'text-[var(--color-danger)]'
                      : ''
                  )}
                >
                  {statusOf(row)}
                </div>
              </div>
              {row.kind !== 'done' && (
                <ConnectionPicker
                  options={networkOptions}
                  value={networksOf(
                    group,
                    row.kind === 'live'
                      ? { kind: 'download', download: row.download }
                      : { kind: 'waiting', item: row.item }
                  )}
                  label={row.name}
                  auto={
                    manual
                      ? undefined
                      : {
                          pinned: group.pinned.includes(row.key),
                          onAuto: () => void run(() => chooseConnection(group, fileOf(row), null))
                        }
                  }
                  onChange={(ids) => void run(() => chooseConnection(group, fileOf(row), ids))}
                />
              )}
              {!manual && group.pinned.includes(row.key) && (
                <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10.5px] text-primary">
                  pinned by you
                </span>
              )}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${row.name}`}
                      onClick={() => handleRemove(row)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X />
                    </Button>
                  }
                />
                <TooltipContent>
                  {row.kind === 'done' ? 'Remove from list' : 'Remove from group'}
                </TooltipContent>
              </Tooltip>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[12.5px] font-medium">Add links</span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Paste more links here, one on each line"
            spellCheck={false}
            aria-label="Links to add"
            rows={3}
            className="w-full resize-none rounded-[9px] border border-input bg-[var(--input-bg)] p-3 font-mono text-[12.5px] text-foreground outline-none"
          />
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 text-[12px] text-[var(--text-secondary)]">
              {found > 0 ? `${found} ${found === 1 ? 'link' : 'links'} found` : ''}
            </span>
            {manual && (
              <ConnectionPicker
                options={networkOptions}
                value={newConnection}
                label="the new files"
                onChange={setNewConnection}
              />
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={found === 0 || adding}
              onClick={handleAdd}
            >
              <Plus data-icon="inline-start" />
              {adding ? 'Adding…' : 'Add to group'}
            </Button>
          </div>
          {addErrors.length > 0 && (
            <div className="flex items-start gap-2 text-[12px] text-[var(--color-danger)]">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 break-words">
                {addErrors.length} could not be added. {addErrors[0]}
              </span>
            </div>
          )}
        </div>
        {actionError && (
          <div role="alert" className="text-[12px] text-[var(--color-danger)]">
            {actionError}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t-[0.5px] border-border px-5 py-3">
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </div>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.fileName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops the download and deletes the part of it already downloaded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive', size: 'sm' })}
              onClick={() => {
                if (removing) removeDownload(removing.id)
                setRemoving(null)
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function statusOf(row: FileRow): string {
  if (row.kind === 'waiting') return row.item.error ?? 'Waiting for a network'
  if (row.kind === 'done')
    return `${formatBytes(wantedBytes(row.download) || row.download.bytesDownloaded)} · finished`
  const { download } = row
  const wanted = wantedBytes(download)
  const percent = formatPercent(download.bytesDownloaded, wanted)
  switch (download.status) {
    case 'downloading':
      return [wanted > 0 && `${percent}%`, formatSpeed(download.speedBytesPerSec)]
        .filter(Boolean)
        .join(' · ')
    case 'queued':
      return 'Waiting for a turn'
    case 'paused':
      return wanted > 0 ? `Paused at ${percent}%` : 'Paused'
    default:
      return describeError(download.error ?? 'Something went wrong')
  }
}
