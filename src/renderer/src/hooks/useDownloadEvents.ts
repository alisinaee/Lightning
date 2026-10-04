import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'

/** Subscribes once to main-process download pushes for the lifetime of the app. */
export function useDownloadEvents(): void {
  const receiveDownloadUpdate = useAppStore((store) => store.receiveDownloadUpdate)
  const receiveHistory = useAppStore((store) => store.receiveHistory)
  const receiveGroups = useAppStore((store) => store.receiveGroups)

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
    const loadGroups = (): void => {
      void window.plexo
        .listGroups()
        .then((groups) => {
          if (!disposed) receiveGroups(groups)
        })
        .catch(() => {})
    }
    const unsubscribe = window.plexo.onDownloadUpdated(receiveDownloadUpdate)
    // A bulk removal changes history once per download: list it once they've settled, rather
    // than re-checking every entry's file after each one. The rows already went from the store.
    let reload: ReturnType<typeof setTimeout> | undefined
    const unsubscribeHistory = window.plexo.onHistoryChanged(() => {
      clearTimeout(reload)
      reload = setTimeout(loadHistory, 150)
    })

    const unsubscribeGroups = window.plexo.onGroupsChanged(loadGroups)

    void window.plexo
      .listDownloads()
      .then((snapshots) => {
        if (!disposed) for (const snapshot of snapshots) receiveDownloadUpdate(snapshot)
      })
      .catch(() => {})
    loadHistory()
    loadGroups()

    return () => {
      disposed = true
      clearTimeout(reload)
      unsubscribe()
      unsubscribeHistory()
      unsubscribeGroups()
    }
  }, [receiveDownloadUpdate, receiveHistory, receiveGroups])
}
