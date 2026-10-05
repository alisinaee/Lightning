import { BugIcon, ScrollTextIcon } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { useLogsStore } from '../store/useLogsStore'
import { useLabStore } from '../store/useLabStore'
import { TITLE_BAR_HEIGHT } from '../theme'
import { Button } from './ui/button'

const isMac = window.lightning.platform === 'darwin'

/** Opens the Test lab (see components/lab). Only where the lab is enabled (not in a packaged build). */
function Debug(): React.JSX.Element {
  const open = useLabStore((store) => store.open)
  const setOpen = useLabStore((store) => store.setOpen)
  const running = useLabStore((store) => store.state?.running != null)
  return (
    <Button
      variant={open ? 'secondary' : 'ghost'}
      size="xs"
      aria-label="Debug: open the Test lab"
      aria-pressed={open}
      onClick={() => setOpen(!open)}
    >
      <BugIcon data-icon="inline-start" className={running ? 'animate-pulse text-sky-500' : ''} />
      Debug
    </Button>
  )
}

/** Opens the Logs window (see LogsDialog), beside Debug. */
function Logs(): React.JSX.Element {
  const open = useLogsStore((store) => store.open)
  const setOpen = useLogsStore((store) => store.setOpen)
  return (
    <Button
      variant={open ? 'secondary' : 'ghost'}
      size="xs"
      aria-label="Open the logs"
      aria-pressed={open}
      onClick={() => setOpen(true)}
    >
      <ScrollTextIcon data-icon="inline-start" />
      Logs
    </Button>
  )
}

/** The window's title bar, the same on every OS: its name, centered, on a strip the window is
 * dragged by. The OS's own controls sit over it (see main/index.ts): macOS's traffic lights at
 * the left, Windows' and Linux's minimize/maximize/close at the right. The Logs and Debug buttons
 * (Settings → Interface) share one row, so whichever are on sit together against the right edge,
 * clear of those controls. */
export function TitleBar(): React.JSX.Element {
  const showLogs = useAppStore((store) => store.showLogs)
  const showDebug = useAppStore((store) => store.showDebug)
  const debug = showDebug && window.lightning.initialState.labEnabled
  return (
    <div
      style={{ height: TITLE_BAR_HEIGHT }}
      className="relative flex shrink-0 items-center justify-center border-b-[0.5px] border-border bg-card [-webkit-app-region:drag]"
    >
      <div className="pointer-events-none whitespace-nowrap font-sans text-[13px] leading-none font-semibold text-[var(--text-secondary)]">
        {window.lightning.initialState.appName ?? 'Lightning'}
      </div>
      {(showLogs || debug) && (
        <div
          className={`absolute top-1/2 flex -translate-y-1/2 items-center gap-1 [-webkit-app-region:no-drag] ${
            isMac ? 'right-3' : 'right-[148px]'
          }`}
        >
          {showLogs && <Logs />}
          {debug && <Debug />}
        </div>
      )}
    </div>
  )
}
