import { CircleArrowUp } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

/** Sits next to ThemeToggle once the banner has been dismissed — same size/shape, so it reads as
 * part of the same row of controls, but in the accent colour and blinking so an update isn't missed. */
export function UpdateIndicator(): React.JSX.Element | null {
  const availableUpdate = useAppStore((store) => store.availableUpdate)

  if (!availableUpdate?.dismissed) return null

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          // target="_blank" routes through the main process's window-open handler, which hands
          // http(s) links to the OS browser instead of opening a second app window.
          <a
            href={availableUpdate.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Update available: ${availableUpdate.version}`}
            className="relative flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-[0.5px] border-primary/60 bg-primary/10 text-primary [-webkit-app-region:no-drag]"
          >
            {/* Blinks to be noticed, but only for people who haven't asked for less motion. */}
            <span
              aria-hidden
              className="absolute inset-0 rounded-[6px] bg-primary/30 motion-safe:animate-pulse"
            />
            <CircleArrowUp
              size={15}
              strokeWidth={1.6}
              className="relative motion-safe:animate-pulse"
            />
          </a>
        }
      />
      <TooltipContent>New update available</TooltipContent>
    </Tooltip>
  )
}
