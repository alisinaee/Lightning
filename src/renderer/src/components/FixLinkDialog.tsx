import { t } from '@shared/i18n/react'
import type { DownloadState } from '@shared/types'
import { useState } from 'react'
import { describeError, formatBytes } from '../utils/format'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Input } from './ui/input'

/** Asks for a fresh link to a download whose link stopped working; it carries on from where it
 * stopped (see DownloadManager.relink). Open while `download` is set. */
export function FixLinkDialog({
  download,
  onClose
}: {
  download: DownloadState | null
  onClose: () => void
}): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fixing, setFixing] = useState(false)

  const close = (): void => {
    setUrl('')
    setError(null)
    onClose()
  }

  const handleFix = async (): Promise<void> => {
    if (!download || !url.trim()) return
    setFixing(true)
    setError(null)
    try {
      await window.lightning.relinkDownload(download.id, url.trim())
      close()
    } catch (failure) {
      setError(describeError(failure))
    } finally {
      setFixing(false)
    }
  }

  return (
    <Dialog
      disablePointerDismissal
      open={download !== null}
      onOpenChange={(open) => !open && close()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Paste a new link')}</DialogTitle>
          <DialogDescription>
            {download &&
              (download.totalBytes > 0
                ? t(
                    'Paste a new link to the same file: {name} ({size}). Lightning resumes from where the download stopped.',
                    {
                      name: `\u2068${download.fileName}\u2069`,
                      size: formatBytes(download.totalBytes)
                    }
                  )
                : t(
                    'Paste a new link to the same file: {name}. Lightning resumes from where the download stopped.',
                    { name: `\u2068${download.fileName}\u2069` }
                  ))}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void handleFix()
          }}
        >
          <Input
            autoFocus
            aria-label={t('New link')}
            placeholder="https://…"
            dir="ltr"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="font-mono"
          />
          {error && <div className="text-[12px] text-[var(--color-danger)]">{error}</div>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={close}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={fixing || !url.trim()}>
              {fixing ? t('Checking…') : t('Continue download')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
