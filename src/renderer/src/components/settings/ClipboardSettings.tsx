import { useEffect, useState } from 'react'
import { Copy, DownloadSimple, Trash } from '@phosphor-icons/react'
import type { ClipboardHistoryEntry, ClipboardLinkKind, ResolvedPrefs } from '@shared/types'
import { redactUrl } from '@shared/urlTools'
import { t, formatDate, formatTime } from '@shared/i18n/react'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'

const kindLabel = (kind: ClipboardLinkKind): string =>
  kind === 'file' ? t('File') : kind === 'youtube' ? 'YouTube' : 'Telegram'

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (on: boolean) => void
}): React.JSX.Element {
  return (
    <label className={`ios-row ${disabled ? 'opacity-50' : ''}`} data-setting={label}>
      <span className="ios-label">
        {t(label)}
        {hint && <span className="ios-hint">{t(hint)}</span>}
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={t(label)}
      />
    </label>
  )
}

function when(at: number): string {
  return `${formatDate(at, { month: 'short', day: 'numeric' })} ${formatTime(at, { hour: '2-digit', minute: '2-digit' })}`
}

/** Settings → Clipboard: whether (and for which links) the clipboard is read, and the links it noticed. */
export function ClipboardSettings({
  prefs,
  save
}: {
  prefs: ResolvedPrefs
  save: (patch: Partial<ResolvedPrefs>) => void
}): React.JSX.Element {
  const [entries, setEntries] = useState<ClipboardHistoryEntry[]>([])
  useEffect(() => {
    void window.lightning.getClipboardHistory().then(setEntries, () => setEntries([]))
    return window.lightning.onClipboardHistoryChanged(setEntries)
  }, [])
  const tracking = prefs.clipboardTrack
  return (
    <>
      <Toggle
        label="Track the clipboard for download links"
        hint={
          tracking
            ? 'Lightning reads the text you copy, once a second, to spot links. Nothing leaves this computer.'
            : 'Off: Lightning never reads the clipboard.'
        }
        checked={tracking}
        onChange={(clipboardTrack) => save({ clipboardTrack })}
      />
      <div className="ios-title">{t('Which links')}</div>
      <Toggle
        label="File links"
        hint="Links to archives, videos, installers, magnet links and the like."
        checked={prefs.watchClipboard}
        disabled={!tracking}
        onChange={(watchClipboard) => save({ watchClipboard })}
      />
      <Toggle
        label="YouTube links"
        checked={prefs.clipboardYoutube}
        disabled={!tracking}
        onChange={(clipboardYoutube) => save({ clipboardYoutube })}
      />
      <Toggle
        label="Telegram links"
        checked={prefs.telegramWatchClipboard}
        disabled={!tracking}
        onChange={(telegramWatchClipboard) => save({ telegramWatchClipboard })}
      />
      <div className="ios-title">{t('When')}</div>
      <Toggle
        label="Only while Lightning is in the background"
        hint="Off: links copied while Lightning is in front are added to the list too. Offers are always notifications."
        checked={prefs.clipboardOnlyInBackground}
        disabled={!tracking}
        onChange={(clipboardOnlyInBackground) => save({ clipboardOnlyInBackground })}
      />
      <div className="ios-title" data-setting="Recent links">
        {t('Recent links')}
      </div>
      {entries.length === 0 ? (
        <div className="ios-note">
          {t('No links yet. The last 50 links Lightning noticed show here.')}
        </div>
      ) : (
        <>
          {entries.map((entry) => (
            <div key={entry.id} className="ios-row">
              <span className="ios-label min-w-0">
                <span
                  dir="ltr"
                  className="block truncate text-start font-mono text-[12.5px]"
                  title={redactUrl(entry.url)}
                >
                  {redactUrl(entry.url)}
                </span>
                <span className="ios-hint">
                  {kindLabel(entry.kind)} · {when(entry.at)}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('Download')}
                title={t('Download')}
                onClick={() => void window.lightning.downloadClipboardEntry(entry.id)}
              >
                <DownloadSimple className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('Copy')}
                title={t('Copy')}
                onClick={() => void navigator.clipboard.writeText(entry.url)}
              >
                <Copy className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('Remove')}
                title={t('Remove')}
                onClick={() => void window.lightning.removeClipboardEntry(entry.id)}
              >
                <Trash className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2 self-start"
            onClick={() => void window.lightning.clearClipboardHistory()}
          >
            {t('Clear history')}
          </Button>
        </>
      )}
    </>
  )
}
