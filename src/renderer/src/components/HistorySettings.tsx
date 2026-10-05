import type { DownloadState, FinishedDownload } from '@shared/types'
import { FolderOpen, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { describeError, formatBytes } from '../utils/format'
import { FormatBadge } from './downloads/FileKindIcon'
import { Button } from './ui/button'

function finishedOn(time: number): string {
  return new Date(time).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
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
export function HistorySettings(): React.JSX.Element {
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
    if (!window.confirm(`Remove “${entry.fileName}” from the history? The file stays where it is.`))
      return
    removeDownload(entry.id)
    if (editing === entry.id) setEditing(null)
  }

  const clear = (): void => {
    if (!window.confirm('Clear the download history? The files stay where they are.')) return
    void window.lightning.clearHistory()
    setEditing(null)
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[15px] font-semibold">Download history</div>
        <div className="text-[12.5px] text-muted-foreground">
          Finished files. Renaming also renames the file on disk when it is still there.
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Downloaded" value={formatBytes(finishedDown + live.downloaded)} />
        <Stat label="Uploaded" value={formatBytes(finishedUp + live.uploaded)} />
        <Stat label="Finished" value={String(history.length)} />
      </div>
      <div className="text-[12px] text-muted-foreground">
        Totals cover the files listed here
        {live.downloaded > 0 || live.uploaded > 0
          ? `, and ${formatBytes(live.downloaded)} still downloading${live.uploaded > 0 ? ` and ${formatBytes(live.uploaded)} uploaded so far` : ''}`
          : ''}
        . Removing a file from the history takes it out of them.
      </div>
      <input
        type="search"
        aria-label="Search history"
        placeholder="Search history"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="h-8 rounded-md border border-input bg-[var(--input-bg)] px-2 text-[12.5px] outline-none"
      />
      {shown.length === 0 ? (
        <div className="py-6 text-center text-[12.5px] text-muted-foreground">
          {history.length === 0 ? 'No finished downloads yet.' : 'Nothing matches.'}
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
                  <div className="truncate text-[12.5px] font-medium">{entry.fileName}</div>
                  <div className="truncate text-[11.5px] text-muted-foreground">
                    {formatBytes(entry.bytesDownloaded)}
                    {' · '}
                    {finishedOn(entry.completedAt ?? entry.startedAt)}
                    {entry.missing ? ' · file missing' : ''}
                    {uploadedOf(entry) > 0 ? ` · up ${formatBytes(uploadedOf(entry))}` : ''}
                  </div>
                </div>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Rename ${entry.fileName}`}
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
                  aria-label={`Show ${entry.fileName} in the folder`}
                  disabled={entry.missing}
                  onClick={() => void window.lightning.revealDownload(entry.id)}
                >
                  <FolderOpen />
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remove ${entry.fileName} from history`}
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
                    aria-label="File name"
                    value={draft}
                    disabled={busy}
                    onChange={(event) => setDraft(event.target.value)}
                    className="h-8 min-w-0 flex-1 rounded-md border border-input bg-[var(--input-bg)] px-2 text-[12.5px] outline-none"
                  />
                  <Button type="submit" size="sm" disabled={busy || draft.trim() === ''}>
                    Save
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setEditing(null)}
                  >
                    Cancel
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
          Clear history
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
