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
      void window.lightning
        .listHistory()
        .then((history) => {
          if (!disposed) receiveHistory(history)
        })
        .catch(() => {})
    }
    // Subscribed before the snapshots are asked for, so nothing sent in between is missed; each
    // update carries a count, so whichever arrives late can't undo the other.
    const loadGroups = (): void => {
      void window.lightning
        .listGroups()
        .then((groups) => {
          if (!disposed) receiveGroups(groups)
        })
        .catch(() => {})
    }
    const unsubscribe = window.lightning.onDownloadUpdated(receiveDownloadUpdate)
    // A bulk removal changes history once per download: list it once they've settled, rather
    // than re-checking every entry's file after each one. The rows already went from the store.
    let reload: ReturnType<typeof setTimeout> | undefined
    const unsubscribeHistory = window.lightning.onHistoryChanged(() => {
      clearTimeout(reload)
      reload = setTimeout(loadHistory, 150)
    })
    // A finished file can only be moved or deleted while Lightning is in the background: listing
    // again on coming back keeps "moved or deleted" true to the disk, as browsers do when their
    // downloads list is opened.
    window.addEventListener('focus', loadHistory)

    const unsubscribeGroups = window.lightning.onGroupsChanged(loadGroups)

    void window.lightning
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
      window.removeEventListener('focus', loadHistory)
      unsubscribe()
      unsubscribeHistory()
      unsubscribeGroups()
    }
  }, [receiveDownloadUpdate, receiveHistory, receiveGroups])
}
