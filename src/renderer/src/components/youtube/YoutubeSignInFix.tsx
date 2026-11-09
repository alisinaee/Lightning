import { t } from '@shared/i18n/react'
import { Cookie, Globe, Plugs, ShieldCheck } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useYoutubeStore } from '../../store/useYoutubeStore'
import { Button } from '../ui/button'
import type { SettingsPage } from '../SettingsDialog'
import { needsSignIn } from './youtubeErrors'

type Browser = 'chrome' | 'safari' | 'firefox' | 'edge' | 'brave'

const NAMES: Record<Browser, string> = {
  chrome: 'Chrome',
  safari: 'Safari',
  firefox: 'Firefox',
  edge: 'Edge',
  brave: 'Brave'
}

/** Offered under a YouTube sign-in error: the ways to give Lightning the sign-in it needs, with the
 * permission each one asks for explained before it is asked. Once one is set up the failed link
 * is tried again by `onFixed`. */
export function YoutubeSignInFix({
  onFixed,
  onOpenSettings
}: {
  onFixed: () => void | Promise<void>
  onOpenSettings?: (page?: SettingsPage) => void
}): React.JSX.Element {
  const [browsers, setBrowsers] = useState<Browser[] | null>(null)
  const [pending, setPending] = useState<Browser | null>(null)
  const [busy, setBusy] = useState(false)
  const isMac = window.lightning.platform === 'darwin'

  useEffect(() => {
    let live = true
    void window.lightning
      .youtubeBrowsers()
      .then((found) => live && setBrowsers(found))
      .catch(() => live && setBrowsers([]))
    return () => {
      live = false
    }
  }, [])

  const apply = async (
    change: Parameters<typeof window.lightning.youtubeSetOptions>[0]
  ): Promise<void> => {
    setBusy(true)
    try {
      await useYoutubeStore.getState().setOptions(change)
      setPending(null)
      await onFixed()
    } finally {
      setBusy(false)
    }
  }

  const pickBrowser = (browser: Browser): void => {
    // Safari's cookies sit in a protected folder: say so first, instead of failing again.
    if (browser === 'safari' && isMac) return setPending('safari')
    void apply({ cookiesBrowser: browser, cookieMode: 'none' })
  }

  const chooseFile = async (): Promise<void> => {
    const file = await window.lightning.youtubeChooseCookies()
    if (file) await apply({ cookieMode: 'manual', manualCookiesFile: file, cookiesBrowser: '' })
  }

  return (
    <div
      role="group"
      aria-label={t('Sign in to YouTube')}
      className="mt-2 flex flex-col gap-3 rounded-xl border-[0.5px] border-border bg-card p-3.5 text-foreground"
    >
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <ShieldCheck className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">
            {t('Let Lightning use your YouTube sign-in')}
          </div>
          <div className="text-[12px] leading-snug text-muted-foreground">
            {t(
              'YouTube asks for a sign-in on this video. Pick one way below. Your sign-in stays on this computer and is used only for YouTube downloads.'
            )}
          </div>
        </div>
      </div>

      {pending === 'safari' ? (
        <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3 text-[12px] leading-snug">
          <div className="font-medium">{t('Safari needs one permission')}</div>
          <div className="text-muted-foreground">
            {t(
              'Safari keeps its sign-in in a protected folder. In System Settings, open Privacy & Security → Full Disk Access and switch Lightning on. Then come back and try again.'
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void window.lightning.openFullDiskAccess()}
            >
              {t('Open Full Disk Access')}
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void apply({ cookiesBrowser: 'safari', cookieMode: 'none' })}
            >
              {t('I allowed it, try again')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              {t('Back')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-[12px] font-medium">
              <Globe className="size-3.5" /> {t('Use a browser you are signed in with')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {browsers === null && (
                <span className="text-[12px] text-muted-foreground">
                  {t('Looking for browsers…')}
                </span>
              )}
              {browsers?.length === 0 && (
                <span className="text-[12px] text-muted-foreground">
                  {t('No supported browser found. Use the extension or a cookies file instead.')}
                </span>
              )}
              {browsers?.map((browser) => (
                <Button
                  key={browser}
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => pickBrowser(browser)}
                >
                  {NAMES[browser]}
                </Button>
              ))}
            </div>
            {isMac && (
              <div className="text-[11.5px] leading-snug text-muted-foreground">
                {t(
                  'Chrome, Edge and Brave: macOS will ask to let Lightning use their “Safe Storage” key. Choose Allow.'
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[12px] font-medium">
                <Plugs className="size-3.5" /> {t('Use the Lightning browser extension')}
              </div>
              <div className="text-[11.5px] leading-snug text-muted-foreground">
                {t('Sends the sign-in along with each video you pick in the browser.')}
              </div>
            </div>
            {onOpenSettings && (
              <Button size="sm" variant="secondary" onClick={() => onOpenSettings('Browser')}>
                {t('Set up')}
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[12px] font-medium">
                <Cookie className="size-3.5" /> {t('I have a cookies.txt file')}
              </div>
              <div className="text-[11.5px] leading-snug text-muted-foreground">
                {t('Exported from your browser with any cookies exporter.')}
              </div>
            </div>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void chooseFile()}>
              {t('Choose file')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/** Above the list: downloads that stopped for want of a sign-in, with the fix and one press to try
 * them all again. */
export function YoutubeSignInBanner({
  onOpenSettings
}: {
  onOpenSettings?: (page?: SettingsPage) => void
}): React.JSX.Element | null {
  const jobs = useYoutubeStore((store) => store.jobs)
  const retryJob = useYoutubeStore((store) => store.retryJob)
  const stuck = Object.values(jobs).filter(
    (job) => job.status === 'error' && needsSignIn(job.error)
  )
  if (stuck.length === 0) return null
  return (
    <div className="border-b-[0.5px] border-border px-3 pb-3">
      <YoutubeSignInFix
        onFixed={async () => {
          await Promise.all(stuck.map((job) => retryJob(job.id)))
        }}
        onOpenSettings={onOpenSettings}
      />
    </div>
  )
}
