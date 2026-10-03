import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'

/** Subscribes once to main-process download pushes for the lifetime of the app. */
export function useDownloadEvents(): void {
  const receiveDownloadUpdate = useAppStore((store) => store.receiveDownloadUpdate)
  const receiveHistory = useAppStore((store) => store.receiveHistory)

  useEffect(() => {
    let disposed = false
    const loadHistory = (): void => {
      void window.plexo
        .listHistory()
        .then((history) => {
          if (!disposed) receiveHistory(history)
        })
        .catch(() => {})
    }
    // Subscribed before the snapshots are asked for, so nothing sent in between is missed; each
    // update carries a count, so whichever arrives late can't undo the other.
    const unsubscribe = window.plexo.onDownloadUpdated(receiveDownloadUpdate)
    const unsubscribeHistory = window.plexo.onHistoryChanged(loadHistory)

    void window.plexo
      .listDownloads()
      .then((snapshots) => {
        if (!disposed) for (const snapshot of snapshots) receiveDownloadUpdate(snapshot)
      })
      .catch(() => {})
    loadHistory()

    return () => {
      disposed = true
      unsubscribe()
      unsubscribeHistory()
    }
  }, [receiveDownloadUpdate, receiveHistory])
}
