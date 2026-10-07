import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'

export const HISTORY_POINTS = 60

/** The total speed, once a second for the last minute: what the graph in the status menu draws.
 * Kept while the bar is on screen, so the graph already has a past when the menu is opened. */
export function useSpeedHistory(on: boolean): number[] {
  const [points, setPoints] = useState<number[]>([])
  const latest = useRef(0)
  const total = useAppStore((store) =>
    Object.values(store.downloads).reduce(
      (sum, download) => sum + (download.status === 'downloading' ? download.speedBytesPerSec : 0),
      0
    )
  )
  useEffect(() => {
    latest.current = total
  }, [total])
  useEffect(() => {
    if (!on) return
    const interval = setInterval(
      () => setPoints((before) => [...before, latest.current].slice(-HISTORY_POINTS)),
      1000
    )
    return () => clearInterval(interval)
  }, [on])
  return points
}
