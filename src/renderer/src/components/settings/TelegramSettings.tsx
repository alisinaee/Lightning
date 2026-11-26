import { useEffect, useState } from 'react'
import { CaretRight } from '@phosphor-icons/react'
import type { TdlStatus } from '@shared/telegram'
import { t } from '@shared/i18n/react'
import { toDisplayPath } from '../../utils/format'
import { Button } from '../ui/button'
import { NumberField, Row, type SettingsSectionProps } from './SettingsControls'

/** Settings → Telegram: account status, destination folder, concurrency, and tdl options. */
export function TelegramSettings({
  prefs,
  save,
  telegramDir,
  homeDir,
  onTelegramDirChange,
  onOpenClipboard
}: SettingsSectionProps & {
  telegramDir: string
  homeDir: string
  onTelegramDirChange: (dir: string) => void
  onOpenClipboard: () => void
}): React.JSX.Element {
  const [tdl, setTdl] = useState<TdlStatus | null>(null)

  useEffect(() => {
    void window.lightning.tdlStatus().then(setTdl, () => setTdl(null))
  }, [])

  return (
    <>
      <div>
        <div className="text-[15px] font-semibold">Telegram</div>
        <div className="ios-note">
          {tdl === null
            ? t('Checking the account…')
            : !tdl.binary
              ? t('The Telegram downloader (tdl) is missing from this build.')
              : tdl.loggedIn
                ? tdl.account
                  ? t('Signed in as {account}.', { account: tdl.account })
                  : t('Signed in.')
                : t('Not signed in. Sign in from the Telegram section.')}
        </div>
        {tdl?.loggedIn && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => {
              if (
                window.confirm(
                  t('Sign out of Telegram? The saved session is deleted from this computer.')
                )
              ) {
                void window.lightning.tdlLogout().then(() => {
                  setTdl({ ...tdl, loggedIn: false, account: undefined })
                })
              }
            }}
          >
            {t('Sign out')}
          </Button>
        )}
      </div>
      <button
        type="button"
        className="ios-row text-start"
        data-setting="Telegram links in the clipboard"
        onClick={onOpenClipboard}
      >
        <span className="ios-label">
          {t('Telegram links in the clipboard')}
          <span className="ios-hint">
            {prefs.clipboardTrack && prefs.telegramWatchClipboard
              ? t('On: offered when copied.')
              : t('Off. Change it in Clipboard settings.')}
          </span>
        </span>
        <CaretRight className="size-4 text-muted-foreground rtl:-scale-x-100" />
      </button>
      <div className="ios-row">
        <span className="ios-label">{t('Telegram folder')}</span>
        <input
          readOnly
          dir="ltr"
          aria-label={t('Telegram folder')}
          value={toDisplayPath(telegramDir, homeDir)}
          title={telegramDir}
          className="ios-input w-44 font-mono"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="rounded-full"
          onClick={() =>
            void window.lightning.chooseDestinationFolder(telegramDir).then((picked) => {
              if (!picked) return
              onTelegramDirChange(picked)
              void window.lightning.updateSettings({ telegramDir: picked })
            })
          }
        >
          {t('Change…')}
        </Button>
      </div>
      <NumberField
        label="Connections per file"
        value={prefs.telegramThreads}
        min={1}
        max={16}
        onChange={(telegramThreads) => save({ telegramThreads })}
      />
      <NumberField
        label="Files at once"
        value={prefs.telegramParallel}
        min={1}
        max={8}
        onChange={(telegramParallel) => save({ telegramParallel })}
      />
      <div className="ios-note">
        {t('High numbers can make Telegram slow the account down (FLOOD_WAIT).')}
      </div>
      <Row
        checked={prefs.telegramSkipSame}
        onChange={(telegramSkipSame) => save({ telegramSkipSame })}
        label="Skip files already in the folder with the same name and size"
      />
      <Row
        checked={prefs.telegramSortByKind}
        onChange={(telegramSortByKind) => save({ telegramSortByKind })}
        label="Sort finished files into Videos, Photos, Audio, Documents and Other folders"
      />
      <Row
        checked={prefs.telegramGroupAlbums}
        onChange={(telegramGroupAlbums) => save({ telegramGroupAlbums })}
        label="Download an album's files together"
      />
      <Row
        checked={prefs.telegramTakeout}
        onChange={(telegramTakeout) => save({ telegramTakeout })}
        label="Use a takeout session (gentler limits for large exports)"
      />
      <Row
        checked={prefs.telegramUseProxy}
        onChange={(telegramUseProxy) => save({ telegramUseProxy })}
        label="Use the manual proxy from Network settings"
      />
      <label className="ios-row" data-setting="File name template">
        <span className="ios-label">{t('File name template')}</span>
        <input
          defaultValue={prefs.telegramTemplate}
          spellCheck={false}
          onBlur={(event) => {
            const telegramTemplate = event.target.value.trim()
            if (telegramTemplate !== prefs.telegramTemplate) save({ telegramTemplate })
          }}
          className="ios-input w-44 text-start font-mono"
          dir="ltr"
          placeholder={t('tdl default')}
        />
      </label>
      <div className="ios-note">
        {t(
          'Telegram downloads use the default connection, not Lightning’s networks, DNS or speed limits. Only the proxy is passed on.'
        )}
      </div>
    </>
  )
}
