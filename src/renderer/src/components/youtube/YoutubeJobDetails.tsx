import { t } from '@shared/i18n/react'
import { useYoutubeStore } from '../../store/useYoutubeStore'
import type { YoutubeJob } from '@shared/youtube'
import { formatBytes, formatSpeed } from '../../utils/format'

/** What is under a YouTube row when it is opened: how it is being fetched, in plain words. YouTube
 * downloads run through one connection (yt-dlp), so unlike a Downloads row there is no list of
 * networks to split across; what can be shown is the real settings behind the download. */
export function YoutubeJobDetails({ job }: { job: YoutubeJob }): React.JSX.Element {
  const options = useYoutubeStore((store) => store.options)
  const signIn =
    options.cookieMode === 'manual' && options.manualCookiesFile
      ? t('A cookies.txt file')
      : options.cookieMode === 'saved'
        ? t('Cookies saved in Lightning')
        : options.cookiesBrowser
          ? t('Your {browser} sign-in', {
              browser: `${options.cookiesBrowser[0].toUpperCase()}${options.cookiesBrowser.slice(1)}`
            })
          : t('Not signed in')
  const rows: [string, string, boolean?][] = [
    [
      t('Connection'),
      t('One connection, the system default (YouTube cannot be split across networks)')
    ],
    [
      t('Parallel parts'),
      options.concurrentFragments > 1
        ? t('{count} fragments at a time', { count: options.concurrentFragments })
        : t('1 at a time (raise it in YouTube options)')
    ],
    [t('Quality'), job.resolution],
    [
      t('Progress'),
      job.total > 0
        ? job.speed > 0
          ? t('{received} of {total} at {speed}', {
              received: formatBytes(job.received),
              total: formatBytes(job.total),
              speed: formatSpeed(job.speed)
            })
          : t('{received} of {total}', {
              received: formatBytes(job.received),
              total: formatBytes(job.total)
            })
        : job.speed > 0
          ? formatSpeed(job.speed)
          : t('Waiting for the size')
    ],
    [t('Sign-in'), signIn],
    [t('Saved to'), job.destDir, true],
    [t('Link'), job.url, true]
  ]
  return (
    <div className="border-b-[0.5px] border-border/50 bg-card/50 py-3 pe-4 ps-[60px]">
      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12px] leading-snug">
        {rows.map(([label, value, ltr]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words text-foreground" dir={ltr ? 'ltr' : undefined}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
