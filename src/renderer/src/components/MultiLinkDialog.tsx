import type { ProbeResult } from '@shared/types'
import type { DuplicateMatch } from '@shared/duplicates'
import { cn } from 'cn'
import { AlertTriangle, FolderOpen, ListChecks, ListX, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { RequestOptions } from './RequestOptions'
import {
  EMPTY_DRAFT,
  draftFromExtras,
  extrasFromDraft,
  type RequestDraft
} from '../utils/requestDraft'
import { defaultNetworkIds, withVpnLayer } from '@shared/networks'
import { useAppStore } from '../store/useAppStore'
import { describeError, formatBytes, toDisplayPath } from '../utils/format'
import { folderNameOf, isSplittable, linksIn, probeLinks, requestFor } from '../utils/links'
import { useNetworkOptions } from '../hooks/useNetworkOptions'
import { ConnectionPicker } from './ConnectionPicker'
import { GroupSettings, type GroupSettingsValue } from './GroupSettings'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { VpnSwitch } from './VpnSwitch'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { describeDuplicate } from '../utils/duplicateText'

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
      <DialogContent className="flex h-[560px] max-h-[calc(100%-2rem)] min-h-[360px] w-[760px] max-w-[calc(100%-2rem)] min-w-[480px] resize flex-col gap-0 overflow-auto p-0 sm:max-w-[calc(100%-2rem)]">
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

  const seed = useAppStore.getState().multiLinksSeed
  const [text, setText] = useState(() => seed?.links.join('\n') ?? '')
  // Scan a web page for the links to files on it.
  const [pageUrl, setPageUrl] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanAll, setScanAll] = useState(false)
  const [scanNote, setScanNote] = useState<string | null>(null)
  // Sign-in, cookies and headers, for every link in the box.
  const [draft, setDraft] = useState<RequestDraft>(() =>
    seed?.extras ? draftFromExtras(seed.extras) : EMPTY_DRAFT
  )
  const [rows, setRows] = useState<Row[] | null>(null)
  // With links found: first the list is confirmed, then the group's settings are chosen.
  const [step, setStep] = useState<'files' | 'settings'>('files')
  const [skipped, setSkipped] = useState(0)
  const [unticked, setUnticked] = useState<string[]>([])
  // Existing copies of the checked links, kept with the rows they were looked up for.
  const [duplicates, setDuplicates] = useState<{ of: Row[]; matches: DuplicateMatch[] } | null>(
    null
  )
  const warnDuplicates = useAppStore((store) => store.prefsSnapshot.warnDuplicates)
  const [folder, setFolder] = useState('')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  // Some files started, some didn't: starting again would repeat the ones that did.
  const [started, setStarted] = useState(false)
  const [settings, setSettings] = useState<GroupSettingsValue>(() => ({
    mode: 'auto',
    rule: 'general',
    interfaceIds: [],
    maxAtOnce: null,
    dnsId: null
  }))
  const { mode } = settings
  // The networks picked for a file in manual mode, by link; left out: every enabled network.
  const [connections, setConnections] = useState<Record<string, string[]>>({})

  // A link on the clipboard is most likely what this is for.
  useEffect(() => {
    void window.lightning
      .readClipboardText()
      .then((clip) => {
        if (linksIn(clip).links.length > 0) setText((current) => current || clip)
      })
      .catch(() => {})
  }, [])

  const found = linksIn(text)

  const handleScan = async (): Promise<void> => {
    const address = pageUrl.trim()
    if (!address || scanning) return
    setScanning(true)
    setScanNote(null)
    try {
      const result = await window.lightning.scanPage(
        /^[a-z][a-z0-9+.-]*:/i.test(address) ? address : `https://${address}`,
        scanAll,
        extrasFromDraft(draft, address)
      )
      if (result.links.length === 0) {
        setScanNote(
          result.otherCount > 0
            ? `No file links found (${result.otherCount} other links). Tick “Every link” to list them.`
            : 'No links found. A page that builds its links with JavaScript can’t be read here.'
        )
      } else {
        setText(
          (current) => `${current.trim()}${current.trim() ? '\n' : ''}${result.links.join('\n')}`
        )
        setScanNote(
          `${result.links.length} ${result.links.length === 1 ? 'link' : 'links'} added to the box` +
            (result.otherCount > 0 ? `, ${result.otherCount} other links left out` : '')
        )
      }
    } catch (error) {
      setScanNote(describeError(error))
    } finally {
      setScanning(false)
    }
  }

  const handleCheck = (): void => {
    const { links, skipped: dropped } = linksIn(text)
    setSkipped(dropped)
    setUnticked([])
    setStep('files')
    setRows(links.map((url) => ({ url, status: 'checking' })))
    probeLinks(
      links,
      (url) => window.lightning.probeUrl(url, extrasFromDraft(draft, url)),
      (url, outcome) => {
        const row: Row =
          'result' in outcome
            ? { url, status: 'ready', result: outcome.result }
            : { url, status: 'error', message: describeError(outcome.error) }
        setRows((current) => current?.map((entry) => (entry.url === url ? row : entry)) ?? null)
      }
    )
  }

  const ready = (rows ?? []).filter((row) => row.status === 'ready')
  const chosen = ready.filter((row) => !unticked.includes(row.url))
  const checking = (rows ?? []).some((row) => row.status === 'checking')
  const allTicked = ready.length > 0 && chosen.length === ready.length

  // Once every link is checked: which of them are already here. Those start unticked.
  useEffect(() => {
    if (!rows || checking || !warnDuplicates) return
    const readyRows = rows.filter(
      (row): row is Extract<Row, { status: 'ready' }> => row.status === 'ready'
    )
    if (readyRows.length === 0) return
    let stale = false
    window.lightning
      .findDuplicates(
        readyRows.map((row) => row.url),
        destinationDir || undefined,
        {
          probes: readyRows.map((row) => ({
            url: row.url,
            finalUrl: row.result.finalUrl,
            fileName: row.result.suggestedFileName,
            totalBytes: row.result.totalBytes
          }))
        }
      )
      .then((matches) => {
        if (stale) return
        setDuplicates({ of: rows, matches })
        const again = matches.map((match) => match.url)
        setUnticked((prev) => [...new Set([...prev, ...again])])
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [rows, checking, destinationDir, warnDuplicates])
  const duplicateByUrl = new Map<string, DuplicateMatch>()
  if (warnDuplicates && duplicates && duplicates.of === rows) {
    for (const match of duplicates.matches) {
      if (!duplicateByUrl.has(match.url)) duplicateByUrl.set(match.url, match)
    }
  }
  const folderName = folderNameOf(folder)
  const separator = destinationDir.includes('\\') && !destinationDir.includes('/') ? '\\' : '/'
  const target = folderName
    ? `${destinationDir.replace(/[\\/]+$/, '')}${separator}${folderName}`
    : destinationDir
  const enabledIds = defaultNetworkIds(interfaces, useAppStore.getState().networkPreferences, false)
  const totalBytes = chosen.reduce(
    (sum, row) => sum + (row.status === 'ready' ? (row.result.totalBytes ?? 0) : 0),
    0
  )
  const canStart = chosen.length > 0 && !checking && Boolean(destinationDir) && !starting
  const layer = (ids: string[]): string[] =>
    withVpnLayer(ids, useAppStore.getState().allInterfaces, useAppStore.getState().useVpn)
  // The group's networks until the user picks: the ones switched on in the networks menu.
  const groupIds = settings.interfaceIds.length > 0 ? settings.interfaceIds : enabledIds
  const perFile = mode === 'manual' && settings.rule === 'perFile'
  const connectionOf = (url: string): string[] => connections[url] ?? groupIds

  const handleBrowse = async (): Promise<void> => {
    const picked = await window.lightning.chooseDestinationFolder(destinationDir)
    if (picked) setDestinationDir(picked)
  }

  const handleStart = async (later = false): Promise<void> => {
    if (!canStart) return
    setStarting(true)
    setStartError(null)
    const requests = chosen.flatMap((row) =>
      row.status === 'ready'
        ? [
            requestFor(
              row.result,
              target,
              layer(perFile ? connectionOf(row.url) : groupIds),
              extrasFromDraft(draft, row.url)
            )
          ]
        : []
    )
    try {
      const { failed } = await window.lightning.createGroup({
        name: folderName,
        destinationDir: target,
        mode,
        rule: mode === 'manual' ? settings.rule : undefined,
        maxAtOnce: settings.maxAtOnce ?? undefined,
        dnsId: settings.dnsId ?? undefined,
        interfaceIds: layer(groupIds),
        requests,
        ...(later ? { startLater: true } : {})
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

  const stepNumber = !rows ? 1 : step === 'files' ? 2 : 3
  const title = !rows
    ? 'Add several links'
    : step === 'files'
      ? 'Choose what to download'
      : 'Download settings'
  const plural = chosen.length === 1 ? 'file' : 'files'

  const selectButton = (
    label: string,
    Icon: typeof ListChecks,
    disabled: boolean,
    onClick: () => void
  ): React.JSX.Element => (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className="text-muted-foreground hover:text-foreground"
          >
            <Icon />
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (!rows) {
          if (found.links.length > 0) handleCheck()
        } else if (step === 'files') {
          if (chosen.length > 0 && !checking) setStep('settings')
        } else void handleStart(false)
      }}
    >
      <div className="flex items-baseline justify-between gap-3 border-b-[0.5px] border-border px-5 py-4">
        <DialogTitle className="text-[16px] font-semibold">{title}</DialogTitle>
        <span className="mr-9 text-[12px] text-muted-foreground">Step {stepNumber} of 3</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
        {!rows ? (
          <>
            <div className="flex shrink-0 flex-col gap-1.5">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={pageUrl}
                  onChange={(event) => setPageUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleScan()
                    }
                  }}
                  placeholder="Or scan a web page: paste its address to list the files on it"
                  spellCheck={false}
                  aria-label="Page address"
                  className="h-9 min-w-0 flex-1 rounded-[9px] border border-input bg-[var(--input-bg)] px-3 text-[12.5px] outline-none"
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={scanning || pageUrl.trim() === ''}
                  onClick={() => void handleScan()}
                >
                  {scanning ? 'Scanning…' : 'Scan page'}
                </Button>
              </div>
              <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={scanAll}
                  onChange={(event) => setScanAll(event.target.checked)}
                />
                Every link, not only files
              </label>
              {scanNote && (
                <div role="status" className="text-[12px] text-[var(--text-secondary)]">
                  {scanNote}
                </div>
              )}
            </div>
            <textarea
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={'Paste your links here, one on each line'}
              spellCheck={false}
              aria-label="Links"
              rows={9}
              className="h-[190px] min-h-[190px] w-full shrink-0 resize-none rounded-[9px] border border-input bg-[var(--input-bg)] p-3 font-mono text-[12.5px] text-foreground outline-none"
            />
            <RequestOptions value={draft} onChange={setDraft} link={found.links[0] ?? ''} />
            <div className="text-[12.5px] text-[var(--text-secondary)]">
              {found.links.length === 0
                ? 'Links start with https:// or magnet:'
                : `${found.links.length} ${found.links.length === 1 ? 'link' : 'links'} found` +
                  (found.skipped > 0 ? `, ${found.skipped} skipped (repeated or not a link)` : '')}
            </div>
          </>
        ) : step === 'files' ? (
          <>
            <div className="flex shrink-0 items-center gap-1 text-[12.5px]">
              <span className="flex-1 font-medium">
                {chosen.length} of {rows.length} selected
                {totalBytes > 0 && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    {formatBytes(totalBytes)}
                  </span>
                )}
                {skipped > 0 && (
                  <span className="ml-2 font-normal text-muted-foreground">{skipped} skipped</span>
                )}
                {duplicateByUrl.size > 0 && (
                  <span className="ml-2 font-normal text-amber-700 dark:text-amber-400">
                    {duplicateByUrl.size} already downloaded or downloading
                  </span>
                )}
              </span>
              {selectButton('Select all', ListChecks, ready.length === 0 || allTicked, () =>
                setUnticked([])
              )}
              {selectButton('Unselect all', ListX, chosen.length === 0, () =>
                setUnticked(ready.map((row) => row.url))
              )}
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
                      {duplicateByUrl.has(row.url) && (
                        <div className="flex items-center gap-1 text-[11.5px] text-amber-700 dark:text-amber-400">
                          <TriangleAlert aria-hidden className="size-3 shrink-0" />
                          <span className="truncate">
                            {describeDuplicate(duplicateByUrl.get(row.url) as DuplicateMatch)}
                          </span>
                        </div>
                      )}
                    </div>
                  </label>
                  {row.status === 'ready' && row.result.totalBytes !== null && (
                    <span className="w-20 shrink-0 text-right font-mono text-[11.5px] text-muted-foreground">
                      {formatBytes(row.result.totalBytes)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="text-[12.5px] text-[var(--text-secondary)]">
              {chosen.length} {plural}
              {totalBytes > 0 && ` · ${formatBytes(totalBytes)}`}
            </div>

            <GroupSettings
              value={{ ...settings, interfaceIds: groupIds }}
              onChange={(patch) => setSettings((current) => ({ ...current, ...patch }))}
            />

            {perFile && (
              <div className="flex min-h-[96px] max-h-[220px] flex-col overflow-y-auto rounded-[9px] border-[0.5px] border-border">
                {chosen.map(
                  (row) =>
                    row.status === 'ready' && (
                      <div
                        key={row.url}
                        className="flex items-center gap-2 border-b-[0.5px] border-border px-3 py-2 text-[12.5px] last:border-b-0"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {row.result.suggestedFileName}
                        </span>
                        <ConnectionPicker
                          options={networkOptions}
                          value={connectionOf(row.url)}
                          single={!isSplittable(row.result)}
                          label={row.result.suggestedFileName}
                          onChange={(ids) =>
                            setConnections((prev) => ({ ...prev, [row.url]: ids }))
                          }
                        />
                      </div>
                    )
                )}
              </div>
            )}

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
            onClick={() => (step === 'settings' ? setStep('files') : setRows(null))}
          >
            Back
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onDone} disabled={starting}>
          {started ? 'Close' : 'Cancel'}
        </Button>
        {!rows ? (
          <Button type="submit" disabled={found.links.length === 0}>
            Continue
          </Button>
        ) : step === 'files' ? (
          <Button type="submit" disabled={chosen.length === 0 || checking}>
            {checking ? 'Checking…' : `Continue with ${chosen.length} ${plural}`}
          </Button>
        ) : (
          !started && (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={!canStart}
                onClick={() => void handleStart(true)}
              >
                Download later
              </Button>
              <Button type="submit" disabled={!canStart}>
                {starting ? 'Starting…' : `Download ${chosen.length} ${plural}`}
              </Button>
            </>
          )
        )}
      </div>
    </form>
  )
}
