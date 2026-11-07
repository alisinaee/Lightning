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
      ? 'A cookies.txt file'
      : options.cookieMode === 'saved'
        ? 'Cookies saved in Lightning'
        : options.cookiesBrowser
          ? `Your ${options.cookiesBrowser[0].toUpperCase()}${options.cookiesBrowser.slice(1)} sign-in`
          : 'Not signed in'
  const rows: [string, string][] = [
    ['Connection', 'One connection, the system default (YouTube cannot be split across networks)'],
    [
      'Parallel parts',
      options.concurrentFragments > 1
        ? `${options.concurrentFragments} fragments at a time`
        : '1 at a time (raise it in YouTube options)'
    ],
    ['Quality', job.resolution],
    [
      'Progress',
      job.total > 0
        ? `${formatBytes(job.received)} of ${formatBytes(job.total)}${
            job.speed > 0 ? ` at ${formatSpeed(job.speed)}` : ''
          }`
        : job.speed > 0
          ? formatSpeed(job.speed)
          : 'Waiting for the size'
    ],
    ['Sign-in', signIn],
    ['Saved to', job.destDir],
    ['Link', job.url]
  ]
  return (
    <div className="border-b-[0.5px] border-border/50 bg-card/50 py-3 pr-4 pl-[60px]">
      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12px] leading-snug">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
