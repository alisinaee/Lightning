import { FlaskConicalIcon } from 'lucide-react'
import { useLabStore } from '../../store/useLabStore'
import { Button } from '../ui/button'

/** Shown over the whole window while the Test lab's pretend networks stand in for the real ones. */
export function SimBanner(): React.JSX.Element | null {
  const active = useLabStore((store) => store.state?.simActive === true)
  const stop = useLabStore((store) => store.stop)
  const setOpen = useLabStore((store) => store.setOpen)
  if (!active) return null
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-[13px] text-amber-900 dark:text-amber-100"
    >
      <FlaskConicalIcon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate font-medium">
        Test lab: simulated networks are active
      </span>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        Open lab
      </Button>
      <Button size="xs" variant="outline" onClick={stop}>
        Stop / Restore
      </Button>
    </div>
  )
}
