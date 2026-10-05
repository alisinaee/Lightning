import type { ScheduleStatus } from '@shared/schedule'
import { useEffect, useState } from 'react'
import { formatSpeed } from '../utils/format'

/** The status bar's word about the schedule: downloads held until a time, or held to a speed. */
export function ScheduleChip(): React.JSX.Element | null {
  const [status, setStatus] = useState<ScheduleStatus>(window.lightning.initialState.scheduleStatus)
  useEffect(() => window.lightning.onScheduleChanged(setStatus), [])
  if (status.allow && status.cap === null) return null
  const until = status.nextChange
    ? new Date(status.nextChange).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null
  return (
    <span className="shrink-0 text-foreground">
      {status.allow
        ? `schedule: ${formatSpeed(status.cap!)} until ${until}`
        : `held by schedule${until ? ` until ${until}` : ''}`}
    </span>
  )
}
