import { t } from '@shared/i18n/react'
import {
  Clipboard as ClipboardPaste,
  DownloadSimple as Download,
  CircleNotch as Loader2,
  MagnifyingGlass as Search
} from '@phosphor-icons/react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { YoutubeErrorText } from './YoutubeErrorText'
import { useYoutubeStore } from '../../store/useYoutubeStore'
import { formatBytes, formatSeconds } from '../../utils/format'
import { cn } from 'cn'

/** Paste a link, see the video, pick a quality, download. One dialog, from the screen's + button. */
export function YoutubeAddDialog(): React.JSX.Element {
  const open = useYoutubeStore((store) => store.addOpen)
  const setAddOpen = useYoutubeStore((store) => store.setAddOpen)
  const options = useYoutubeStore((store) => store.options)
  const offerId = useYoutubeStore((store) => store.offerId)
  const inputUrl = useYoutubeStore((store) => store.inputUrl)
  const setInputUrl = useYoutubeStore((store) => store.setInputUrl)
  const probeState = useYoutubeStore((store) => store.probeState)
  const probeError = useYoutubeStore((store) => store.probeError)
  const probe = useYoutubeStore((store) => store.currentProbe)
  const selected = useYoutubeStore((store) => store.selectedFormat)
  const setSelected = useYoutubeStore((store) => store.setSelectedFormat)
  const queueFetch = useYoutubeStore((store) => store.queueFetch)
  const startDownload = useYoutubeStore((store) => store.startDownload)
  const loading = probeState === 'loading'
  const close = (): void => setAddOpen(false)

  const paste = async (): Promise<void> => {
    const text = await window.lightning.readClipboardText()
    if (!text) return
    setInputUrl(text.trim())
    void queueFetch(text)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setAddOpen(true) : close())}>
      <DialogContent className="flex max-h-[calc(100%-2rem)] w-[560px] max-w-[calc(100%-2rem)] flex-col gap-0 p-0 sm:max-w-[calc(100%-2rem)]">
        <DialogHeader className="border-b-[0.5px] border-border px-5 py-4">
          <DialogTitle className="text-[16px] font-semibold">{t('Add YouTube video')}</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            {offerId
              ? t('Sent from your browser. Check the quality, then download.')
              : t('Paste a link, check the video, then choose a quality.')}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault()
            // Fetching runs in the queue; the dialog closes and the person keeps working.
            if (!probe) void queueFetch(inputUrl)
          }}
        >
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 start-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                autoFocus
                type="url"
                aria-label={t('Video link')}
                placeholder="https://www.youtube.com/watch?v=…"
                value={inputUrl}
                onChange={(event) => setInputUrl(event.target.value)}
                className="h-9 ps-8 text-[12.5px]"
              />
            </div>
            <Button type="button" variant="secondary" onClick={() => void paste()}>
              <ClipboardPaste />
              {t('Paste')}
            </Button>
            <Button type="submit" variant="secondary" disabled={loading || !inputUrl.trim()}>
              {loading ? <Loader2 className="animate-spin" /> : null}
              {t('Fetch')}
            </Button>
          </div>

          {probeError && (
            <YoutubeErrorText
              role="alert"
              error={probeError}
              className="text-[12.5px] text-[var(--color-danger)]"
            />
          )}

          {probe && (
            <div className="flex flex-col gap-4">
              <div className="flex gap-3 rounded-[9px] border-[0.5px] border-border p-3">
                {probe.thumbnail ? (
                  <img
                    src={probe.thumbnail}
                    alt=""
                    className="h-[72px] w-[128px] shrink-0 rounded-md bg-muted object-cover"
                  />
                ) : (
                  <div className="h-[72px] w-[128px] shrink-0 rounded-md bg-muted" />
                )}
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="line-clamp-2 text-[13px] font-medium">{probe.title}</span>
                  <span className="truncate text-[12px] text-muted-foreground">
                    {[probe.channel, probe.duration ? formatSeconds(probe.duration) : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
              </div>

              <div className="grid gap-1 rounded-[9px] bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground">
                <span className="truncate">
                  {t('Saving to')}{' '}
                  <span className="text-foreground" dir="ltr">
                    {options.folder || t('Downloads')}
                  </span>
                </span>
                <span>
                  {t('Playlists:')}{' '}
                  <span className="text-foreground">
                    {options.playlist === 'full' ? t('whole playlist') : t('only this video')}
                  </span>
                  {' · '}
                  {t('Cookies:')}{' '}
                  <span className="text-foreground">
                    {options.cookieMode === 'none' ? t('off') : options.cookieMode}
                  </span>
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-[12.5px] font-medium">{t('Quality')}</span>
                <div role="radiogroup" aria-label={t('Quality')} className="grid grid-cols-2 gap-2">
                  {probe.formats.map((format) => {
                    const active = selected?.formatId === format.formatId
                    return (
                      <button
                        key={format.formatId}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setSelected(format)}
                        className={cn(
                          'flex flex-col items-start gap-0.5 rounded-[9px] border-[0.5px] px-3 py-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          active
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:bg-secondary'
                        )}
                      >
                        <span className="text-[12.5px] font-medium">{format.resolution}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {format.ext.toUpperCase()}
                          {format.filesize ? ` · ${formatBytes(format.filesize)}` : ''}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </form>

        <DialogFooter className="mx-0 mb-0 flex-row justify-end gap-2 border-t-[0.5px] border-border px-5 py-3">
          <Button type="button" variant="secondary" onClick={close}>
            {t('Cancel')}
          </Button>
          <Button type="button" disabled={!probe || !selected} onClick={() => void startDownload()}>
            <Download />
            {selected ? t('Download {quality}', { quality: selected.resolution }) : t('Download')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
