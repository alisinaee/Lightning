import { t } from '@shared/i18n/react'
import { CircleNotch as Loader2, X } from '@phosphor-icons/react'
import { Button } from '../ui/button'
import { useYoutubeStore } from '../../store/useYoutubeStore'
import { YoutubeErrorText } from './YoutubeErrorText'
import { YoutubeSignInFix } from './YoutubeSignInFix'
import { needsSignIn } from './youtubeErrors'
import type { SettingsPage } from '../SettingsDialog'

/** Links being fetched, and fetched links waiting for a quality choice. Shown above the job list. */
export function YoutubeFetchQueue({
  onOpenSettings
}: {
  onOpenSettings?: (page?: SettingsPage) => void
}): React.JSX.Element | null {
  const fetches = useYoutubeStore((store) => store.fetches)
  const openFetch = useYoutubeStore((store) => store.openFetch)
  const dismissFetch = useYoutubeStore((store) => store.dismissFetch)
  const retryFetch = useYoutubeStore((store) => store.retryFetch)
  if (fetches.length === 0) return null

  return (
    <div className="flex flex-col gap-2 border-b-[0.5px] border-border px-3 py-2.5">
      <div className="text-[12px] font-medium text-muted-foreground">{t('Fetch queue')}</div>
      {fetches.map((item) => (
        <div key={item.id}>
          <div className="flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2">
            {item.state === 'fetching' && (
              <>
                <Loader2
                  className="size-4 shrink-0 animate-spin text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                  {t('Fetching {url}', { url: item.url })}
                </span>
              </>
            )}
            {item.state === 'ready' && item.meta && (
              <>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                  {item.meta.title}
                </span>
                <Button type="button" size="sm" onClick={() => openFetch(item.id)}>
                  {t('Choose quality')}
                </Button>
              </>
            )}
            {item.state === 'error' && (
              <YoutubeErrorText
                error={item.error}
                className="min-w-0 flex-1 text-[13px] text-destructive"
              />
            )}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={t('Dismiss')}
              onClick={() => void dismissFetch(item.id)}
            >
              <X />
            </Button>
          </div>
          {item.state === 'error' && needsSignIn(item.error) && (
            <YoutubeSignInFix onFixed={() => retryFetch(item.id)} onOpenSettings={onOpenSettings} />
          )}
        </div>
      ))}
    </div>
  )
}
