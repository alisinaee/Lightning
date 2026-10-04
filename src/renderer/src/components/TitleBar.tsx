import { BugIcon } from 'lucide-react'
import { useLabStore } from '../store/useLabStore'
import { TITLE_BAR_HEIGHT } from '../theme'
import { Button } from './ui/button'

const isMac = window.plexo.platform === 'darwin'

/** Opens the Test lab (see components/lab). Always shown in this local build. */
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
      // Clear of the OS window controls; the strip itself drags the window.
      className={`absolute top-1/2 -translate-y-1/2 [-webkit-app-region:no-drag] ${
        isMac ? 'right-3' : 'right-[148px]'
      }`}
    >
      <BugIcon data-icon="inline-start" className={running ? 'animate-pulse text-sky-500' : ''} />
      Debug
    </Button>
  )
}

/** The window's title bar, the same on every OS: its name, centered, on a strip the window is
 * dragged by. The OS's own controls sit over it (see main/index.ts): macOS's traffic lights at
 * the left, Windows' and Linux's minimize/maximize/close at the right. */
export function TitleBar(): React.JSX.Element {
  return (
    <div
      style={{ height: TITLE_BAR_HEIGHT }}
      className={`relative flex shrink-0 items-center justify-center border-b-[0.5px] border-border bg-card [-webkit-app-region:drag] ${
        // Clear of the controls on either side, so the name stays centered between them.
        isMac ? 'px-[94px]' : 'px-[140px]'
      }`}
    >
      <div className="truncate font-sans text-[13px] leading-none font-semibold text-[var(--text-secondary)]">
        Plexo
      </div>
      <Debug />
    </div>
  )
}
