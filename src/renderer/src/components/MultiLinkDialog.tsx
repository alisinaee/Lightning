import type { GroupMode, ProbeResult } from '@shared/types'
import { cn } from 'cn'
import { AlertTriangle, FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { defaultNetworkIds } from '@shared/networks'
import { useAppStore } from '../store/useAppStore'
import { describeError, formatBytes, toDisplayPath } from '../utils/format'
import { folderNameOf, isSplittable, linksIn, probeLinks, requestFor } from '../utils/links'
import { useNetworkOptions } from '../hooks/useNetworkOptions'
import { ConnectionPicker } from './ConnectionPicker'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { VpnSwitch } from './VpnSwitch'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

type Row =
  | { url: string; status: 'checking' }
  | { url: string; status: 'ready'; result: ProbeResult }
  | { url: string; status: 'error'; message: string }

/** Paste several links, tick the ones wanted, name a folder for them and start them together as one group. */
export function MultiLinkDialog(): React.JSX.Element {
  const open = useAppStore((store) => store.multiLinksOpen)
  const close = useAppStore((store) => store.closeMultiLinks)

  return (
    <Dialog open={open} disablePointerDismissal onOpenChange={(next) => !next && close()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[560px] max-h-[calc(100%-2rem)] min-h-[360px] w-[760px] max-w-[calc(100%-2rem)] min-w-[480px] resize flex-col gap-0 overflow-auto p-0 sm:max-w-[calc(100%-2rem)]"
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
  const networkOptions = useNetworkOptions()

  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [unticked, setUnticked] = useState<string[]>([])
  const [folder, setFolder] = useState('')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  // Some files started, some didn't: starting again would repeat the ones that did.
  const [started, setStarted] = useState(false)
  const [mode, setMode] = useState<GroupMode>('auto')
  // The networks picked for a file in manual mode, by link; left out: every enabled network.
  const [connections, setConnections] = useState<Record<string, string[]>>({})

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
    probeLinks(links, window.plexo.probeUrl, (url, outcome) => {
      const row: Row =
        'result' in outcome
          ? { url, status: 'ready', result: outcome.result }
          : { url, status: 'error', message: describeError(outcome.error) }
      setRows((current) => current?.map((entry) => (entry.url === url ? row : entry)) ?? null)
    })
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
  const enabledIds = defaultNetworkIds(
    interfaces,
    useAppStore.getState().networkPreferences,
    useAppStore.getState().useVpn
  )
  const canStart = chosen.length > 0 && !checking && Boolean(destinationDir) && !starting
  const connectionOf = (url: string): string[] => connections[url] ?? enabledIds

  const handleBrowse = async (): Promise<void> => {
    const picked = await window.plexo.chooseDestinationFolder(destinationDir)
    if (picked) setDestinationDir(picked)
  }

  const handleStart = async (): Promise<void> => {
    if (!canStart) return
    setStarting(true)
    setStartError(null)
    const requests = chosen.flatMap((row) =>
      row.status === 'ready'
        ? [requestFor(row.result, target, mode === 'manual' ? connectionOf(row.url) : enabledIds)]
        : []
    )
    try {
      const { failed } = await window.plexo.createGroup({
        name: folderName,
        destinationDir: target,
        mode,
        interfaceIds: enabledIds,
        requests
      })
      if (failed.length === 0) {
        onDone()
        return
      }
      setStarted(failed.length < requests.length)
      setStartError(`${failed.length} could not start. ${failed[0]}`)
    } catch (error) {
      setStartError(describeError(error))
    }
    setStarting(false)
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
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

            <div className="flex items-center gap-3 text-[12.5px]">
              <span className="w-24 shrink-0 text-[var(--text-secondary)]">Connections</span>
              <ToggleGroup
                aria-label="How files are given networks"
                value={[mode]}
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
                {mode === 'auto'
                  ? 'Each file gets a network of its own, matched to how fast it is.'
                  : 'Pick the networks each file uses.'}
              </span>
            </div>

            <div className="flex min-h-[120px] flex-1 flex-col overflow-y-auto rounded-[9px] border-[0.5px] border-border">
              {rows.map((row) => (
                <div
                  key={row.url}
                  className={cn(
                    'flex items-center gap-2 border-b-[0.5px] border-border px-3 py-2 text-[12.5px] last:border-b-0',
                    row.status !== 'ready' && 'opacity-70'
                  )}
                >
                  <label
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2',
                      row.status === 'ready' && 'cursor-pointer'
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
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <div className="truncate font-medium">
                              {row.status === 'ready' ? row.result.suggestedFileName : row.url}
                            </div>
                          }
                        />
                        <TooltipContent className="max-w-[min(560px,90vw)] break-all">
                          {row.status === 'ready' ? row.result.suggestedFileName : row.url}
                        </TooltipContent>
                      </Tooltip>
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
                  </label>
                  {row.status === 'ready' && row.result.totalBytes !== null && (
                    <span className="w-20 shrink-0 text-right font-mono text-[11.5px] text-muted-foreground">
                      {formatBytes(row.result.totalBytes)}
                    </span>
                  )}
                  {row.status === 'ready' &&
                    (mode === 'manual' ? (
                      <>
                        <ConnectionPicker
                          options={networkOptions}
                          value={connectionOf(row.url)}
                          single={!isSplittable(row.result)}
                          label={row.result.suggestedFileName}
                          onChange={(ids) =>
                            setConnections((prev) => ({ ...prev, [row.url]: ids }))
                          }
                        />
                      </>
                    ) : (
                      <span className="w-[150px] shrink-0 text-right text-[11.5px] text-muted-foreground">
                        Auto
                      </span>
                    ))}
                </div>
              ))}
            </div>

            <div className="-mx-4 -my-2 shrink-0">
              <VpnSwitch />
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
            disabled={starting || started}
            onClick={() => setRows(null)}
          >
            Back
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onDone} disabled={starting}>
          {started ? 'Close' : 'Cancel'}
        </Button>
        {rows && !started ? (
          <Button type="submit" disabled={!canStart}>
            {starting
              ? 'Starting…'
              : checking
                ? 'Checking…'
                : `Download ${chosen.length} ${chosen.length === 1 ? 'file' : 'files'}`}
          </Button>
        ) : (
          !started && (
            <Button type="submit" disabled={found.links.length === 0}>
              Continue
            </Button>
          )
        )}
      </div>
    </form>
  )
}
