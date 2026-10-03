import { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'

const LATENCY_POLL_MS = 5000

/** Keeps the network list current for the lifetime of the app: the main process watches the
 * networks and says whenever one comes, goes or changes. */
export function useNetworkEvents(): void {
  const loadInterfaces = useAppStore((store) => store.loadInterfaces)
  const receiveInterfaces = useAppStore((store) => store.receiveInterfaces)

  useEffect(() => {
    const unsubscribe = window.plexo.onNetworksChanged(receiveInterfaces)
    void loadInterfaces()
    return unsubscribe
  }, [loadInterfaces, receiveInterfaces])
}

/** Keeps each network's latency readout fresh while `active` (something showing it is open). */
export function useLatencyPolling(active: boolean): void {
  const refreshLatencies = useAppStore((store) => store.refreshLatencies)

  useEffect(() => {
    if (!active) return
    void refreshLatencies()
    const interval = setInterval(refreshLatencies, LATENCY_POLL_MS)
    return () => clearInterval(interval)
  }, [active, refreshLatencies])
}

const USAGE_POLL_MS = 2000

/** What each network has received this month, by id, kept fresh while `active` (a screen that
 * shows data limits is open). */
export function useNetworkUsage(active: boolean): Record<string, number> {
  const [usage, setUsage] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!active) return
    let disposed = false
    const load = (): void => {
      void window.plexo
        .networkUsage()
        .then((next) => !disposed && setUsage(next))
        .catch(() => {})
    }
    load()
    const interval = setInterval(load, USAGE_POLL_MS)
    return () => {
      disposed = true
      clearInterval(interval)
    }
  }, [active])

  return usage
}
