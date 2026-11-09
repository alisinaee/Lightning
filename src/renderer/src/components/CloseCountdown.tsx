import { useEffect, useState } from 'react'
import { CLIPBOARD_OFFER_MS } from '@shared/clipboardLinks'
import { t } from '@shared/i18n/react'

const RADIUS = 12
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** The countdown of a dialog a copied link opened: a ring that empties, with the seconds left, shown
 * in the dialog's bottom bar. A click or key in the dialog stops it (the dialog clears its close time). */
export function CloseCountdown({
  closeAt,
  onExpire
}: {
  closeAt: number
  onExpire: () => void
}): React.JSX.Element {
  const [left, setLeft] = useState(() => Math.max(0, closeAt - Date.now()))

  useEffect(() => {
    const tick = (): void => {
      const remaining = Math.max(0, closeAt - Date.now())
      setLeft(remaining)
      if (remaining === 0) onExpire()
    }
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [closeAt, onExpire])

  const seconds = Math.ceil(left / 1000)
  const share = left / CLIPBOARD_OFFER_MS
  return (
    <div
      role="timer"
      aria-label={t('Closes in {seconds} s unless you use it', { seconds })}
      title={t('Closes by itself')}
      className="relative grid size-8 shrink-0 place-items-center"
    >
      <svg viewBox="0 0 32 32" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="16" cy="16" r={RADIUS} fill="none" strokeWidth="2.5" className="stroke-muted" />
        <circle
          cx="16"
          cy="16"
          r={RADIUS}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="stroke-primary transition-[stroke-dashoffset] duration-300"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - share)}
        />
      </svg>
      <span className="text-[11px] font-semibold tabular-nums">{seconds}</span>
    </div>
  )
}
