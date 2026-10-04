import type { ProbeResult } from '@shared/types'
import { cn } from 'cn'
import { AlertTriangle, FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { acceptedLink, describeError, formatBytes, toDisplayPath } from '../utils/format'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

/** Links checked at the same moment: enough to be quick, few enough not to hammer one host. */
const PROBE_PARALLEL = 3

type Row =
  | { url: string; status: 'checking' }
  | { url: string; status: 'ready'; result: ProbeResult }
  | { url: string; status: 'error'; message: string }

/** The links in pasted text: one per line or separated by spaces, repeats dropped. */
function linksIn(text: string): { links: string[]; skipped: number } {
  const seen = new Set<string>()
  const links: string[] = []
  let skipped = 0
  for (const piece of text.split(/\s+/)) {
    if (!piece) continue
    const link = acceptedLink(piece)
    if (!link || seen.has(link)) {
      skipped++
      continue
    }
    seen.add(link)
    links.push(link)
  }
  return { links, skipped }
}

/** A folder name that is one folder: no separators or characters a path can't hold. */
function folderNameOf(text: string): string {
  return text
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim()
    .replace(/^\.+$/, '')
}

/** Paste several links, tick the ones wanted, name a folder for them and start them together. */
export function MultiLinkDialog(): React.JSX.Element {
  const open = useAppStore((store) => store.multiLinksOpen)
  const close = useAppStore((store) => store.closeMultiLinks)

  return (
    <Dialog open={open} disablePointerDismissal onOpenChange={(next) => !next && close()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100%-2rem)] flex-col gap-0 p-0 sm:max-w-[600px]"
      >
        {open && <MultiLinkForm onDone={close} />}
      </DialogContent>
    </Dialog>
  )
}

function MultiLinkForm({ onDone }: { onDone: () => void }): React.JSX.Element {
  const interfaces = useAppStore((store) => store.interfaces)
  const destinationDir = useAppStore((store) => store.destinationDir)
  const setDestinationDir = useAppStore((store) => store.setDestinationDir)
  const homeDir = useAppStore((store) => store.homeDir)

  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [unticked, setUnticked] = useState<string[]>([])
  const [folder, setFolder] = useState('')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  // A link on the clipboard is most likely what this is for.
  useEffect(() => {
    void window.plexo
      .readClipboardText()
      .then((clip) => {
        if (linksIn(clip).links.length > 0) setText((current) => current || clip)
      })
      .catch(() => {})
  }, [])

  const found = linksIn(text)

  const handleCheck = (): void => {
    const { links, skipped: dropped } = linksIn(text)
    setSkipped(dropped)
    setUnticked([])
    setRows(links.map((url) => ({ url, status: 'checking' })))
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < links.length) {
        const url = links[next++]
        let row: Row
        try {
          row = { url, status: 'ready', result: await window.plexo.probeUrl(url) }
        } catch (error) {
          row = { url, status: 'error', message: describeError(error) }
        }
        setRows((current) => current?.map((entry) => (entry.url === url ? row : entry)) ?? null)
      }
    }
    for (let i = 0; i < Math.min(PROBE_PARALLEL, links.length); i++) void worker()
  }

  const ready = (rows ?? []).filter((row) => row.status === 'ready')
  const chosen = ready.filter((row) => !unticked.includes(row.url))
  const checking = (rows ?? []).some((row) => row.status === 'checking')
  const allTicked = ready.length > 0 && chosen.length === ready.length
  const folderName = folderNameOf(folder)
  const separator = destinationDir.includes('\\') && !destinationDir.includes('/') ? '\\' : '/'
  const target = folderName
    ? `${destinationDir.replace(/[\\/]+$/, '')}${separator}${folderName}`
    : destinationDir
  const enabledIds = interfaces
    .map((iface) => iface.id)
    .filter((id) => !useAppStore.getState().networkPreferences[id]?.off)
  const canStart = chosen.length > 0 && !checking && Boolean(destinationDir) && !starting

  const handleBrowse = async (): Promise<void> => {
    const picked = await window.plexo.chooseDestinationFolder(destinationDir)
    if (picked) setDestinationDir(picked)
  }

  const handleStart = async (): Promise<void> => {
    if (!canStart) return
    setStarting(true)
    setStartError(null)
    const failed: string[] = []
    for (const row of chosen) {
      if (row.status !== 'ready') continue
      const { result } = row
      const supportsRanges = result.supportsRanges && result.totalBytes !== null
      const interfaceIds = supportsRanges ? enabledIds : enabledIds.slice(0, 1)
      try {
        await window.plexo.startDownload(
          result.kind === 'torrent'
            ? {
                kind: 'torrent',
                url: result.finalUrl,
                destinationDir: target,
                suggestedFileName: result.suggestedFileName,
                totalBytes: result.totalBytes ?? 0,
                supportsRanges,
                interfaceIds,
                etag: result.etag,
                lastModified: result.lastModified,
                infoHash: result.torrent.infoHash
              }
            : {
                kind: 'http',
                url: result.finalUrl,
                destinationDir: target,
                suggestedFileName: result.suggestedFileName,
                totalBytes: result.totalBytes ?? 0,
                supportsRanges,
                interfaceIds,
                etag: result.etag,
                lastModified: result.lastModified
              }
        )
      } catch (error) {
        failed.push(`${result.suggestedFileName}: ${describeError(error)}`)
      }
    }
    if (failed.length === 0) {
      onDone()
      return
    }
    setStartError(`${failed.length} could not start. ${failed[0]}`)
    setStarting(false)
  }

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (rows) void handleStart()
        else if (found.links.length > 0) handleCheck()
      }}
    >
      <div className="border-b-[0.5px] border-border px-5 py-4">
        <DialogTitle className="text-[16px] font-semibold">
          {rows ? 'Choose what to download' : 'Add several links'}
        </DialogTitle>
      </div>

      <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto px-5 py-4">
        {!rows ? (
          <>
            <textarea
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={'Paste your links here, one on each line'}
              spellCheck={false}
              aria-label="Links"
              rows={9}
              className="w-full resize-none rounded-[9px] border border-input bg-[var(--input-bg)] p-3 font-mono text-[12.5px] text-foreground outline-none"
            />
            <div className="text-[12.5px] text-[var(--text-secondary)]">
              {found.links.length === 0
                ? 'Links start with https:// or magnet:'
                : `${found.links.length} ${found.links.length === 1 ? 'link' : 'links'} found` +
                  (found.skipped > 0 ? `, ${found.skipped} skipped (repeated or not a link)` : '')}
            </div>
          </>
        ) : (
          <>
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium">
              <Checkbox
                checked={allTicked}
                indeterminate={chosen.length > 0 && chosen.length < ready.length}
                disabled={ready.length === 0}
                onCheckedChange={(checked) =>
                  setUnticked(checked ? [] : ready.map((row) => row.url))
                }
              />
              <span className="flex-1">
                {allTicked ? 'Unselect all' : 'Select all'}
                <span className="ml-2 font-normal text-muted-foreground">
                  {chosen.length} of {rows.length} selected
                  {skipped > 0 ? `, ${skipped} skipped` : ''}
                </span>
              </span>
            </label>

            <div className="flex max-h-[260px] flex-col overflow-y-auto rounded-[9px] border-[0.5px] border-border">
              {rows.map((row) => (
                <label
                  key={row.url}
                  className={cn(
                    'flex items-center gap-2 border-b-[0.5px] border-border px-3 py-2 text-[12.5px] last:border-b-0',
                    row.status === 'ready' ? 'cursor-pointer' : 'opacity-70'
                  )}
                >
                  <Checkbox
                    disabled={row.status !== 'ready'}
                    checked={row.status === 'ready' && !unticked.includes(row.url)}
                    onCheckedChange={(checked) =>
                      setUnticked((prev) =>
                        checked ? prev.filter((u) => u !== row.url) : [...prev, row.url]
                      )
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {row.status === 'ready' ? row.result.suggestedFileName : row.url}
                    </div>
                    {row.status === 'checking' && (
                      <div className="text-[11.5px] text-muted-foreground">Checking…</div>
                    )}
                    {row.status === 'error' && (
                      <div className="flex items-center gap-1 text-[11.5px] text-[var(--color-danger)]">
                        <AlertTriangle aria-hidden className="size-3 shrink-0" />
                        <span className="truncate">{row.message}</span>
                      </div>
                    )}
                  </div>
                  {row.status === 'ready' && row.result.totalBytes !== null && (
                    <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">
                      {formatBytes(row.result.totalBytes)}
                    </span>
                  )}
                </label>
              ))}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-[12.5px]">
                <span className="w-24 shrink-0 text-[var(--text-secondary)]">New folder</span>
                <input
                  type="text"
                  value={folder}
                  onChange={(event) => setFolder(event.target.value)}
                  placeholder="Name of a folder to put them in (optional)"
                  spellCheck={false}
                  aria-label="Folder name"
                  className="h-9 min-w-0 flex-1 rounded-[9px] border border-input bg-[var(--input-bg)] px-3 text-[13px] text-foreground outline-none"
                />
              </label>
              <div className="flex items-center gap-2 text-[12.5px]">
                <span className="w-24 shrink-0 text-[var(--text-secondary)]">Saved to</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={target}>
                  {toDisplayPath(target, homeDir)}
                </span>
                <Button type="button" variant="secondary" onClick={handleBrowse}>
                  <FolderOpen data-icon="inline-start" />
                  Browse…
                </Button>
              </div>
            </div>
            {startError && (
              <div className="flex items-center gap-2 text-[12.5px] text-[var(--color-danger)]">
                <AlertTriangle className="size-4 shrink-0" />
                {startError}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t-[0.5px] border-border px-5 py-3">
        {rows && (
          <Button
            type="button"
            variant="ghost"
            className="mr-auto"
            disabled={starting}
            onClick={() => setRows(null)}
          >
            Back
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onDone} disabled={starting}>
          Cancel
        </Button>
        {rows ? (
          <Button type="submit" disabled={!canStart}>
            {starting
              ? 'Starting…'
              : checking
                ? 'Checking…'
                : `Download ${chosen.length} ${chosen.length === 1 ? 'file' : 'files'}`}
          </Button>
        ) : (
          <Button type="submit" disabled={found.links.length === 0}>
            Continue
          </Button>
        )}
      </div>
    </form>
  )
}
