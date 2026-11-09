import { formatTime, t } from '@shared/i18n/react'
import type { ScheduleStatus } from '@shared/schedule'
import { useEffect, useState } from 'react'
import { formatSpeed } from '../utils/format'

/** The status bar's word about the schedule: downloads held until a time, or held to a speed. */
export function ScheduleChip(): React.JSX.Element | null {
  const [status, setStatus] = useState<ScheduleStatus>(window.lightning.initialState.scheduleStatus)
  useEffect(() => window.lightning.onScheduleChanged(setStatus), [])
  if (status.allow && status.cap === null) return null
  const until = status.nextChange
    ? formatTime(status.nextChange, { hour: '2-digit', minute: '2-digit' })
    : null
  return (
    <span className="shrink-0 text-foreground">
      {status.allow
        ? t('schedule: {speed} until {time}', {
            speed: formatSpeed(status.cap!),
            time: until ?? ''
          })
        : until
          ? t('held by schedule until {time}', { time: until })
          : t('held by schedule')}
    </span>
  )
}
