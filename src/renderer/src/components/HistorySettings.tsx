import type { DownloadState, FinishedDownload } from '@shared/types'
import { FolderOpen, PencilSimple as Pencil, Trash as Trash2 } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { t, formatDate } from '@shared/i18n/react'
import { useAppStore } from '../store/useAppStore'
import { describeError, formatBytes } from '../utils/format'
import { FormatBadge } from './downloads/FileKindIcon'
import { Button } from './ui/button'

function finishedOn(time: number): string {
  return formatDate(time, { month: 'short', day: 'numeric', year: 'numeric' })
}

function uploadedOf(entry: { kind: string; bytesUploaded?: number }): number {
  return entry.kind === 'torrent' ? (entry.bytesUploaded ?? 0) : 0
}

/** Downloads still in progress: one that has finished is in the history already, and counting it
 * there and here would count it twice. */
function liveTotals(
  downloads: Record<string, DownloadState>,
  finishedIds: Set<string>
): {
  downloaded: number
  uploaded: number
} {
  let downloaded = 0
  let uploaded = 0
  for (const download of Object.values(downloads)) {
    if (download.status === 'completed' || finishedIds.has(download.id)) continue
    downloaded += download.bytesDownloaded
    uploaded += uploadedOf(download)
  }
  return { downloaded, uploaded }
}

/** Finished downloads: rename a file, drop it from the list, and the download and upload totals. */
export function HistorySettings({
  historyLimit,
  onHistoryLimitChange
}: {
  historyLimit: number
  onHistoryLimitChange: (limit: number) => void
}): React.JSX.Element {
  const history = useAppStore((store) => store.history)
  const downloads = useAppStore((store) => store.downloads)
  const removeDownload = useAppStore((store) => store.removeDownload)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needle = query.trim().toLowerCase()
  const shown = useMemo(
    () =>
      history.filter(
        (entry) =>
          needle === '' ||
          entry.fileName.toLowerCase().includes(needle) ||
          entry.url.toLowerCase().includes(needle)
      ),
    [history, needle]
  )

  const finishedDown = history.reduce((sum, entry) => sum + entry.bytesDownloaded, 0)
  const finishedUp = history.reduce((sum, entry) => sum + uploadedOf(entry), 0)
  const live = liveTotals(downloads, new Set(history.map((entry) => entry.id)))

  const saveName = async (entry: FinishedDownload): Promise<void> => {
    const name = draft.trim()
    if (!name || name === entry.fileName) {
      setEditing(null)
      setError(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await window.lightning.updateHistory(entry.id, name)
      setEditing(null)
    } catch (caught) {
      setError(describeError(caught))
    } finally {
      setBusy(false)
    }
  }

  const forget = (entry: FinishedDownload): void => {
    if (
      !window.confirm(
        t('Remove “{name}” from the history? The file stays where it is.', {
          name: entry.fileName
        })
      )
    )
      return
    removeDownload(entry.id)
    if (editing === entry.id) setEditing(null)
  }

  const clear = (): void => {
    if (!window.confirm(t('Clear the download history? The files stay where they are.'))) return
    void window.lightning.clearHistory()
    setEditing(null)
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[15px] font-semibold">{t('Download history')}</div>
        <div className="text-[12.5px] text-muted-foreground">
          {t('Finished files. Renaming also renames the file on disk when it is still there.')}
        </div>
      </div>
      <label className="flex items-center gap-3 text-[13px]">
        {t('Keep this many finished downloads')}
        <input
          type="number"
          min={50}
          max={5000}
          step={1}
          value={historyLimit}
          onChange={(event) => {
            const limit = Math.floor(Number(event.target.value))
            if (limit >= 50 && limit <= 5000) onHistoryLimitChange(limit)
          }}
          className="h-8 w-20 rounded-md border border-input bg-[var(--input-bg)] px-2 text-center outline-none"
        />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <Stat label={t('Downloaded')} value={formatBytes(finishedDown + live.downloaded)} />
        <Stat label={t('Uploaded')} value={formatBytes(finishedUp + live.uploaded)} />
        <Stat label={t('Finished')} value={String(history.length)} />
      </div>
      <div className="text-[12px] text-muted-foreground">
        {live.uploaded > 0
          ? t(
              'Totals cover the files listed here, and {down} still downloading and {up} uploaded so far. Removing a file from the history takes it out of them.',
              { down: formatBytes(live.downloaded), up: formatBytes(live.uploaded) }
            )
          : live.downloaded > 0
            ? t(
                'Totals cover the files listed here, and {down} still downloading. Removing a file from the history takes it out of them.',
                { down: formatBytes(live.downloaded) }
              )
            : t(
                'Totals cover the files listed here. Removing a file from the history takes it out of them.'
              )}
      </div>
      <input
        type="search"
        aria-label={t('Search history')}
        placeholder={t('Search history')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="h-8 rounded-md border border-input bg-[var(--input-bg)] px-2 text-[12.5px] outline-none"
      />
      {shown.length === 0 ? (
        <div className="py-6 text-center text-[12.5px] text-muted-foreground">
          {history.length === 0 ? t('No finished downloads yet.') : t('Nothing matches.')}
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {shown.map((entry) => (
            <li key={entry.id} className="rounded-md border-[0.5px] border-border px-2 py-1.5">
              <div className="flex items-center gap-2">
                <FormatBadge
                  name={entry.fileName}
                  size="sm"
                  kind={entry.kind === 'torrent' ? 'torrent' : undefined}
                />
                <div className="min-w-0 flex-1">
                  <div dir="auto" className="truncate text-[12.5px] font-medium">
                    {entry.fileName}
                  </div>
                  <div className="truncate text-[11.5px] text-muted-foreground">
                    {[
                      formatBytes(entry.bytesDownloaded),
                      finishedOn(entry.completedAt ?? entry.startedAt),
                      entry.missing ? t('file missing') : '',
                      uploadedOf(entry) > 0
                        ? t('up {size}', { size: formatBytes(uploadedOf(entry)) })
                        : ''
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t('Rename {name}', { name: entry.fileName })}
                  onClick={() => {
                    setEditing(entry.id)
                    setDraft(entry.fileName)
                    setError(null)
                  }}
                >
                  <Pencil />
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t('Show {name} in the folder', { name: entry.fileName })}
                  disabled={entry.missing}
                  onClick={() => void window.lightning.revealDownload(entry.id)}
                >
                  <FolderOpen />
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t('Remove {name} from history', { name: entry.fileName })}
                  onClick={() => forget(entry)}
                >
                  <Trash2 />
                </Button>
              </div>
              {editing === entry.id && (
                <form
                  className="mt-2 flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void saveName(entry)
                  }}
                >
                  <input
                    aria-label={t('File name')}
                    value={draft}
                    disabled={busy}
                    onChange={(event) => setDraft(event.target.value)}
                    className="h-8 min-w-0 flex-1 rounded-md border border-input bg-[var(--input-bg)] px-2 text-[12.5px] outline-none"
                  />
                  <Button type="submit" size="sm" disabled={busy || draft.trim() === ''}>
                    {t('Save')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setEditing(null)}
                  >
                    {t('Cancel')}
                  </Button>
                </form>
              )}
              {editing === entry.id && error && (
                <div role="alert" className="mt-1 text-[12px] text-destructive">
                  {error}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {history.length > 0 && (
        <Button type="button" variant="secondary" className="self-start" onClick={clear}>
          {t('Clear history')}
        </Button>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-md border-[0.5px] border-border px-2.5 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-mono text-[13px] font-semibold tabular-nums">{value}</div>
    </div>
  )
}
