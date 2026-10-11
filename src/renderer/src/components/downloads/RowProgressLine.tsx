import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { RowInfo } from '../../utils/status'
import { statusStyle } from '../../utils/status'
import { useAppStore } from '../../store/useAppStore'
import { SELECT_WIDTH } from './columns'

/** Where the row's title text starts, measured from the row's left edge: the element marked
 * `data-title` (after the file-kind icon, or after a group's chevron and folder icon). Until it
 * is measured, or when a row has no such element, the select column's width. Re-measured when
 * the row or the title resizes, and when the window does. Only while `active`. */
function useTitleLeft(anchor: RefObject<HTMLElement | null>, active: boolean): number {
  const [left, setLeft] = useState(SELECT_WIDTH)
  useLayoutEffect(() => {
    const row = anchor.current?.parentElement
    if (!active || !row) return
    const measure = (): void => {
      const title = row.querySelector<HTMLElement>('[data-title]')
      const next = title
        ? title.getBoundingClientRect().left - row.getBoundingClientRect().left - row.clientLeft
        : SELECT_WIDTH
      // Only a real move is worth a render.
      setLeft((prev) => (Math.abs(prev - next) > 0.5 ? next : prev))
    }
    // ResizeObserver reports once when it starts observing, before the next paint, so the first
    // measure lands without a visible jump.
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    const title = row.querySelector<HTMLElement>('[data-title]')
    if (title) observer.observe(title)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [anchor, active])
  return left
}

/** A thin line along the bottom of a row that fills as the download goes, in its status colour:
 * progress down a whole list at a glance. Not drawn for a finished row, one with nothing to
 * measure, or when Settings → Interface has it off. Laid over the row's own bottom edge, so it
 * never changes the row's height. It starts exactly where the row's title text starts and runs
 * to the row's right edge. */
export function RowProgressLine({ info }: { info: RowInfo }): React.JSX.Element | null {
  const on = useAppStore((store) => store.progressLine)
  const shown = Boolean(on && info.bar && info.status !== 'completed')
  const anchor = useRef<HTMLSpanElement>(null)
  const left = useTitleLeft(anchor, shown)
  if (!shown) return null
  const color = statusStyle(info.missing ? 'attention' : info.status).color
  const running = info.status === 'downloading'
  return (
    <span
      ref={anchor}
      role="progressbar"
      aria-label="Progress"
      aria-valuenow={Math.round(info.percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="pointer-events-none absolute bottom-0 right-0 z-[1] h-[2.5px] bg-[color-mix(in_srgb,var(--text-secondary)_14%,transparent)]"
      style={{ left }}
    >
      <span
        className="block h-full rounded-r-full transition-[width] duration-500"
        style={{
          width: `${Math.max(1, info.percent)}%`,
          background: color,
          opacity: running ? 1 : 0.6
        }}
      />
    </span>
  )
}
