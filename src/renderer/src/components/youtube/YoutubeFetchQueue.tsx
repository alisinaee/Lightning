import { Loader2, X } from 'lucide-react'
import { Button } from '../ui/button'
import { useYoutubeStore } from '../../store/useYoutubeStore'
import { YoutubeErrorText } from './YoutubeErrorText'

/** Links being fetched, and fetched links waiting for a quality choice. Shown above the job list. */
export function YoutubeFetchQueue(): React.JSX.Element | null {
  const fetches = useYoutubeStore((store) => store.fetches)
  const openFetch = useYoutubeStore((store) => store.openFetch)
  const dismissFetch = useYoutubeStore((store) => store.dismissFetch)
  if (fetches.length === 0) return null

  return (
    <div className="flex flex-col gap-2 border-b-[0.5px] border-border px-3 py-2.5">
      <div className="text-[12px] font-medium text-muted-foreground">Fetch queue</div>
      {fetches.map((item) => (
        <div key={item.id} className="flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2">
          {item.state === 'fetching' && (
            <>
              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                Fetching {item.url}
              </span>
            </>
          )}
          {item.state === 'ready' && item.meta && (
            <>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                {item.meta.title}
              </span>
              <Button type="button" size="sm" onClick={() => openFetch(item.id)}>
                Choose quality
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
            aria-label="Dismiss"
            onClick={() => void dismissFetch(item.id)}
          >
            <X />
          </Button>
        </div>
      ))}
    </div>
  )
}
