import { t } from '@shared/i18n/react'
import { localeTag } from '@shared/i18n'
import type { ProbeResult } from '@shared/types'
import type { DuplicateMatch } from '@shared/duplicates'
import { DnsPicker } from './DnsPicker'
import { VpnSwitch } from './VpnSwitch'
import { FormatBadge } from './downloads/FileKindIcon'
import { cn } from 'cn'
import {
  Warning as AlertTriangle,
  FolderOpen,
  Warning as TriangleAlert,
  X
} from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { defaultNetworkIds, withVpnLayer } from '@shared/networks'
import { useAppStore } from '../store/useAppStore'
import {
  acceptedLink,
  describeError,
  describeFileCount,
  formatBytes,
  toDisplayPath
} from '../utils/format'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { RequestOptions } from './RequestOptions'
import {
  checksumFromDraft,
  draftFromExtras,
  extrasFromDraft,
  type RequestDraft
} from '../utils/requestDraft'
import { TorrentFileList } from './TorrentFiles'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { describeDuplicate } from '../utils/duplicateText'

type ProbeState =
  | { status: 'idle' }
  | { status: 'probing' }
  | { status: 'ready'; result: ProbeResult }
  | { status: 'error'; message: string }

const PROBE_DEBOUNCE_MS = 600

type OnComplete = 'nothing' | 'open' | 'folder'
const whenDone = (): [OnComplete, string][] => [
  ['nothing', t('Nothing')],
  ['open', t('Open file')],
  ['folder', t('Show in folder')]
]

type StreamsChoice = 'auto' | number
/** Streams per network the user can pick instead of Auto. */
const STREAMS_CHOICES: StreamsChoice[] = ['auto', 4, 8, 16, 32]

const labelClass = 'w-16 shrink-0 text-[12.5px] text-[var(--text-secondary)]'

/** New download: a link, then only what differs from one download to the next — its name (or a
 * torrent's files), where it goes, over which networks, and how many streams each runs. Everything set once for every
 * download lives in Speed & data limits and the networks menu. */
export function NewDownloadDialog(): React.JSX.Element {
  const open = useAppStore((store) => store.newDownloadOpen)
  const close = useAppStore((store) => store.closeNewDownload)

  return (
    <Dialog open={open} disablePointerDismissal onOpenChange={(next) => !next && close()}>
      <DialogContent className="flex max-h-[calc(100%-2rem)] flex-col gap-0 p-0 sm:max-w-[560px]">
        {/* Mounted only while open, so each opening starts fresh from the link field. */}
        {open && <NewDownloadForm onDone={close} />}
      </DialogContent>
    </Dialog>
  )
}

function NewDownloadForm({ onDone }: { onDone: () => void }): React.JSX.Element {
  const interfaces = useAppStore((store) => store.interfaces)
  const networkPreferences = useAppStore((store) => store.networkPreferences)
  const useVpn = useAppStore((store) => store.useVpn)
  const allInterfaces = useAppStore((store) => store.allInterfaces)
  const homeDir = useAppStore((store) => store.homeDir)
  const url = useAppStore((store) => store.draftUrl)
  const setUrl = useAppStore((store) => store.setDraftUrl)
  const destinationDir = useAppStore((store) => store.destinationDir)
  const [dnsId, setDnsId] = useState<string | null>(null)
  const setDestinationDir = useAppStore((store) => store.setDestinationDir)
  const full = useAppStore(
    (store) =>
      Object.values(store.downloads).filter((download) => download.status === 'downloading')
        .length >= store.downloadsAtOnce
  )
  const networkVisual = useNetworkVisuals()
  const linkInput = useRef<HTMLInputElement>(null)

  const [probe, setProbe] = useState<ProbeState>({ status: 'idle' })
  // Bumped by "Search again" to check the same link once more.
  const [searchCount, setSearchCount] = useState(0)
  // How the magnet link being checked is going, as the main process reports it.
  const [magnetWait, setMagnetWait] = useState<{ link: string; noPeersYet: boolean } | null>(null)
  // What this download changes from the default networks (those on in the networks menu).
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [fileNameOverride, setFileNameOverride] = useState<string | null>(null)
  // Existing copies of the checked link, kept with the check result they were looked up for.
  const [duplicates, setDuplicates] = useState<{
    of: ProbeResult
    matches: DuplicateMatch[]
  } | null>(null)
  const warnDuplicates = useAppStore((store) => store.prefsSnapshot.warnDuplicates)
  // A torrent's files left out, by index: every file is downloaded unless unticked.
  const [skippedFiles, setSkippedFiles] = useState<number[]>([])
  // For this download only: the next one starts on Auto again.
  const [streamsChoice, setStreamsChoice] = useState<StreamsChoice>('auto')
  // Sign-in, cookies and headers for this link; they also shape the check that reads its size.
  // For this download only: what to do with the file once it is done.
  const [onComplete, setOnComplete] = useState<OnComplete>('nothing')
  const [requestDraft, setRequestDraft] = useState<RequestDraft>(() =>
    draftFromExtras(useAppStore.getState().draftExtras)
  )
  const extras = useMemo(() => extrasFromDraft(requestDraft, url), [requestDraft, url])
  const extrasKey = JSON.stringify(extras)

  // Opened with nothing in it: a link on the clipboard is most likely what it's for, as download
  // managers have long assumed. Anything else on the clipboard is left alone.
  useEffect(() => {
    if (useAppStore.getState().draftUrl) return
    void window.lightning
      .readClipboardText()
      .then((text) => {
        const link = acceptedLink(text)
        const { draftUrl, startedUrl } = useAppStore.getState()
        if (link && link !== startedUrl && !draftUrl) setUrl(link)
      })
      .catch(() => {})
  }, [setUrl])

  useEffect(() => window.lightning.onMagnetStatus(setMagnetWait), [])

  useEffect(() => {
    const trimmed = url.trim()
    if (!trimmed) {
      // Resetting derived probe state when its trigger (the URL) is cleared.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProbe({ status: 'idle' })
      setFileNameOverride(null)
      setSkippedFiles([])
      return
    }

    // Set once the link changes, cleared included: a magnet can take a while to answer, and its
    // answer is no longer wanted then.
    let stale = false
    setProbe({ status: 'probing' })
    setMagnetWait(null)
    setFileNameOverride(null)
    setSkippedFiles([])
    const timer = setTimeout(async () => {
      try {
        const result = await window.lightning.probeUrl(trimmed, extras)
        if (stale) return
        setProbe({ status: 'ready', result })
      } catch (error) {
        if (stale) return
        setProbe({ status: 'error', message: describeError(error) })
      }
    }, PROBE_DEBOUNCE_MS)

    return () => {
      stale = true
      clearTimeout(timer)
    }
    // extrasKey stands for `extras`: the check runs again when what it sends changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, extrasKey, searchCount])

  const ready = probe.status === 'ready' ? probe.result : null
  const torrent = ready?.kind === 'torrent' ? ready.torrent : null
  const chosenFiles = torrent
    ? torrent.files.flatMap((_, index) => (skippedFiles.includes(index) ? [] : [index]))
    : []
  // What will be downloaded: a torrent's chosen files, or the whole file.
  const sizeToFetch = torrent
    ? chosenFiles.reduce((sum, index) => sum + torrent.files[index].length, 0)
    : (ready?.totalBytes ?? null)
  const multiChunkAllowed = ready !== null && ready.supportsRanges && ready.totalBytes !== null
  const isSingleStreamOnly = ready !== null && !multiChunkAllowed

  // Looked up once the link is checked, and again when the folder changes. Only a notice: the
  // Download button stays as it is.
  useEffect(() => {
    if (!ready || !warnDuplicates || !destinationDir) return
    const link = ready.finalUrl || url.trim()
    let stale = false
    window.lightning
      .findDuplicates([link], destinationDir, {
        probes: [
          {
            url: link,
            fileName: ready.suggestedFileName,
            totalBytes: ready.totalBytes
          }
        ]
      })
      .then((matches) => {
        if (!stale) setDuplicates({ of: ready, matches })
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [ready, warnDuplicates, destinationDir, url])
  const duplicate =
    duplicates && ready && duplicates.of === ready ? (duplicates.matches[0] ?? null) : null

  const detectedIds = interfaces.map((iface) => iface.id)
  const defaultIds = defaultNetworkIds(interfaces, networkPreferences, false)
  const enabledIds = detectedIds.filter((id) => overrides[id] ?? defaultIds.includes(id))
  const selectedInterfaceIds = isSingleStreamOnly ? enabledIds.slice(0, 1) : enabledIds

  // The VPN layer rides along when it is on; a VPN alone still lets a download start.
  const startIds = withVpnLayer(selectedInterfaceIds, allInterfaces, useVpn)
  const canStart =
    probe.status === 'ready' &&
    (!torrent || chosenFiles.length > 0) &&
    startIds.length > 0 &&
    Boolean(destinationDir) &&
    !starting
  const startLabel = starting
    ? t('Starting…')
    : probe.status === 'probing'
      ? t('Checking…')
      : full
        ? t('Add to queue')
        : t('Download')

  // Two networks on one subnet: the OS sends both down one route, so there's nothing to combine.
  let subnetConflict: { subnet: string; names: string[] } | null = null
  if (selectedInterfaceIds.length > 1) {
    const subnets = new Map<string, string[]>()
    for (const id of selectedInterfaceIds) {
      const iface = interfaces.find((i) => i.id === id)
      const subnet = iface?.addresses.find((address) => address.family === 4)?.subnet
      if (subnet && iface) {
        const names = subnets.get(subnet) ?? []
        names.push(networkVisual(iface.id, iface.kind, iface.displayName).name)
        subnets.set(subnet, names)
      }
    }
    for (const [subnet, names] of subnets.entries()) {
      if (names.length > 1) {
        subnetConflict = { subnet, names }
        break
      }
    }
  }

  const handleToggleInterface = (id: string): void => {
    if (isSingleStreamOnly) {
      setOverrides(Object.fromEntries(detectedIds.map((other) => [other, other === id])))
      return
    }
    if (enabledIds.includes(id) && enabledIds.length === 1) return // keep at least one
    setOverrides((prev) => ({ ...prev, [id]: !enabledIds.includes(id) }))
  }

  const handleBrowse = async (): Promise<void> => {
    const chosen = await window.lightning.chooseDestinationFolder(destinationDir)
    if (chosen) setDestinationDir(chosen)
  }

  // A .torrent file goes in the link field as its path; the probe reads it from there.
  const handleOpenTorrent = async (): Promise<void> => {
    const path = await window.lightning.chooseTorrentFile()
    if (path) setUrl(path)
  }

  const handleStart = async (later = false): Promise<void> => {
    if (probe.status !== 'ready' || !canStart) return
    setStarting(true)
    setStartError(null)
    try {
      const common = {
        url: probe.result.finalUrl,
        destinationDir,
        suggestedFileName: fileNameOverride?.trim() || probe.result.suggestedFileName,
        totalBytes: probe.result.totalBytes ?? 0,
        supportsRanges: multiChunkAllowed,
        interfaceIds: startIds,
        ...(dnsId ? { dnsId } : {}),
        ...(later ? { startPaused: true } : {}),
        ...(onComplete === 'nothing' ? {} : { onComplete }),
        etag: probe.result.etag,
        lastModified: probe.result.lastModified,
        ...(probe.result.kind === 'http'
          ? { ...extras, checksum: checksumFromDraft(requestDraft) }
          : {})
      }
      const id = await window.lightning.startDownload(
        probe.result.kind === 'torrent'
          ? {
              ...common,
              kind: 'torrent',
              infoHash: probe.result.torrent.infoHash,
              selectedFiles: skippedFiles.length > 0 ? chosenFiles : undefined
            }
          : {
              ...common,
              kind: 'http',
              streamsPerNetwork: streamsChoice === 'auto' ? undefined : streamsChoice
            }
      )
      // Started: the link is spent, so the next download starts from an empty one. Its own
      // screen opens, unless it was only added to the queue.
      useAppStore.setState({
        startedUrl: url.trim(),
        draftUrl: '',
        ...(full || later ? {} : { view: { name: 'download', id } as const })
      })
      onDone()
    } catch (error) {
      setStartError(describeError(error))
      setStarting(false)
    }
  }

  const fileName = ready ? (fileNameOverride ?? ready.suggestedFileName) : ''

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        void handleStart()
      }}
    >
      <div className="border-b-[0.5px] border-border px-5 py-4">
        <DialogTitle className="text-[16px] font-semibold">{t('New download')}</DialogTitle>
      </div>

      <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto px-5 py-4">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[9px] border bg-[var(--input-bg)] px-3',
              probe.status === 'error' ? 'border-destructive' : 'border-input'
            )}
          >
            <input
              ref={linkInput}
              autoFocus
              type="text"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              dir="ltr"
              placeholder={t('Paste a link: https:// or magnet:')}
              spellCheck={false}
              aria-label={t('Link')}
              className="min-w-0 flex-1 border-none bg-transparent font-mono text-[13px] text-foreground outline-none"
            />
            {url && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => {
                        setUrl('')
                        linkInput.current?.focus()
                      }}
                      aria-label={t('Clear link')}
                      className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      <X aria-hidden className="size-3.5" />
                    </button>
                  }
                />
                <TooltipContent>{t('Clear link')}</TooltipContent>
              </Tooltip>
            )}
          </div>
          <Button type="button" variant="secondary" onClick={handleOpenTorrent} className="h-9">
            <FolderOpen data-icon="inline-start" />
            {t('Open .torrent…')}
          </Button>
        </div>

        {probe.status === 'probing' && (
          <div className="font-mono text-[11.5px] text-muted-foreground">
            {t('Checking the link…')}
          </div>
        )}
        {probe.status === 'probing' && magnetWait?.noPeersYet && magnetWait.link === url.trim() && (
          <div className="text-[12px] text-muted-foreground">
            {t('No peers found yet, still looking…')}
          </div>
        )}
        {probe.status === 'error' && (
          <div className="flex items-center gap-2 text-[12.5px] text-[var(--color-danger)]">
            <AlertTriangle className="size-4 shrink-0" />
            {probe.message}
            {/^magnet:/i.test(url.trim()) && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setSearchCount((count) => count + 1)}
              >
                {t('Search again')}
              </Button>
            )}
          </div>
        )}

        {ready && (
          <div className="flex items-center gap-3">
            <FormatBadge
              name={fileName}
              className="size-10 rounded-lg text-[10px]"
              kind={torrent && torrent.files.length > 1 ? 'torrent' : undefined}
            >
              {torrent && torrent.files.length > 1 ? 'DIR' : undefined}
            </FormatBadge>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {torrent ? (
                <div className="truncate text-[14px] font-medium">{ready.suggestedFileName}</div>
              ) : (
                <input
                  type="text"
                  value={fileName}
                  onChange={(event) => setFileNameOverride(event.target.value)}
                  aria-label={t('File name')}
                  dir="auto"
                  spellCheck={false}
                  className="min-w-0 rounded-md border border-transparent bg-transparent px-1 -ms-1 text-[14px] font-medium outline-none hover:border-input focus:border-input"
                />
              )}
              <div className="font-mono text-[11.5px] text-muted-foreground">
                {[
                  torrent && describeFileCount(chosenFiles.length, torrent.files.length),
                  sizeToFetch !== null ? formatBytes(sizeToFetch) : t('size unknown'),
                  !torrent &&
                    (isSingleStreamOnly
                      ? ready.supportsRanges
                        ? t('Uses one connection. The file size is unknown.')
                        : t('Uses one connection. This server doesn’t support parallel downloads.')
                      : t('resumable'))
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {duplicate && (
                <div className="flex items-center gap-1.5 text-[12px] text-amber-700 dark:text-amber-400">
                  <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                  <span className="truncate">{describeDuplicate(duplicate)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {torrent && (
          <TorrentFileList
            files={torrent.files}
            skipped={skippedFiles}
            onChange={setSkippedFiles}
          />
        )}

        <div className="flex items-center gap-3">
          <div className={labelClass}>{t('Save to')}</div>
          <div dir="ltr" className="min-w-0 flex-1 truncate text-end font-mono text-[12.5px]">
            {toDisplayPath(destinationDir, homeDir)}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={handleBrowse}>
            {t('Change…')}
          </Button>
        </div>

        <div className="flex items-start gap-3">
          <div className={cn(labelClass, 'pt-1.5')} id="new-download-networks">
            {t('Networks')}
          </div>
          <div
            role="group"
            aria-labelledby="new-download-networks"
            className="flex min-w-0 flex-1 flex-wrap gap-1.5"
          >
            {interfaces.map((iface) => {
              const visual = networkVisual(iface.id, iface.kind, iface.displayName)
              const selected = selectedInterfaceIds.includes(iface.id)
              return (
                <button
                  key={iface.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => handleToggleInterface(iface.id)}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors',
                    selected
                      ? 'border-transparent'
                      : 'border-border text-[var(--text-secondary)] opacity-70'
                  )}
                  style={
                    selected ? { background: visual.bg, borderColor: visual.border } : undefined
                  }
                >
                  <span className="size-2 rounded-full" style={{ background: visual.solid }} />
                  {visual.name}
                </button>
              )
            })}
          </div>
        </div>

        {/* The same switch as when adding several links; shown only while a VPN is detected. */}
        <div className="-mx-5 -my-2 shrink-0">
          <VpnSwitch />
        </div>

        <div className="flex items-center gap-3">
          <div className={labelClass}>DNS</div>
          <DnsPicker
            value={dnsId}
            followLabel={t('Default')}
            onChange={setDnsId}
            testUrl={/^https?:\/\//i.test(url.trim()) ? url.trim() : undefined}
          />
        </div>

        {!torrent && (
          <RequestOptions value={requestDraft} onChange={setRequestDraft} link={url} withChecksum />
        )}

        {/* A torrent's speed comes from its peers, and an unsplittable file has one stream. */}
        {ready && !torrent && !isSingleStreamOnly && (
          <div className="flex items-center gap-3">
            <div className={labelClass} id="new-download-streams">
              {t('Streams')}
            </div>
            <ToggleGroup
              value={[String(streamsChoice)]}
              onValueChange={(values) => {
                if (values.length === 0) return
                setStreamsChoice(values[0] === 'auto' ? 'auto' : Number(values[0]))
              }}
              aria-labelledby="new-download-streams"
              variant="pill"
              size="xs"
              spacing={1}
            >
              {STREAMS_CHOICES.map((choice) => (
                // h-6/min-w-6: WCAG 2.5.8's 24px floor — the xs toggle size is 20px.
                <ToggleGroupItem key={choice} value={String(choice)} className="h-6 min-w-6 px-2">
                  {choice === 'auto' ? t('Auto') : choice}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div className="font-mono text-[11px] text-muted-foreground">{t('per network')}</div>
          </div>
        )}

        {ready && (
          <div className="flex items-center gap-3">
            <div className={labelClass} id="new-download-when-done">
              {t('When done')}
            </div>
            <ToggleGroup
              value={[onComplete]}
              onValueChange={(values) => {
                if (values.length > 0) setOnComplete(values[0] as OnComplete)
              }}
              aria-labelledby="new-download-when-done"
              variant="pill"
              size="xs"
              spacing={1}
            >
              {whenDone().map(([value, label]) => (
                <ToggleGroupItem key={value} value={value} className="h-6 px-2">
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}

        {subnetConflict && (
          <div className="flex items-start gap-2 text-[12px] leading-snug text-[var(--color-usb-text)]">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {t(
              '{names} share a subnet ({subnet}), so the computer sends both down one route and they can’t be combined.',
              {
                names: new Intl.ListFormat(localeTag(), { type: 'conjunction' }).format(
                  subnetConflict.names
                ),
                subnet: subnetConflict.subnet
              }
            )}
          </div>
        )}
        {isSingleStreamOnly && selectedInterfaceIds.length === 1 && interfaces.length > 1 && (
          <div className="text-[12px] text-muted-foreground">
            {t('This download uses one connection on one network.')}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t-[0.5px] border-border px-4 py-2">
        {startError ? (
          <div className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--color-danger)]">
            {startError}
          </div>
        ) : (
          <div className="flex-1" />
        )}
        <Button type="button" variant="secondary" onClick={onDone}>
          {t('Cancel')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!canStart}
          onClick={() => void handleStart(true)}
        >
          {t('Download later')}
        </Button>
        <Button type="submit" disabled={!canStart}>
          {startLabel}
        </Button>
      </div>
    </form>
  )
}
