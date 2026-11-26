import { useEffect } from 'react'
import { useTelegramStore } from '../store/useTelegramStore'

/** Keeps the Telegram jobs and the sign-in status current for the whole window, so the side
 * panel's count is right before the section is ever opened. */
export function useTelegramEvents(): void {
  useEffect(() => {
    const store = useTelegramStore.getState()
    void store.refreshStatus()
    void store.loadJobs()
    const offJob = window.lightning.onTdlJobUpdated((job) =>
      useTelegramStore.getState().setJob(job)
    )
    // Auto sync takes finished jobs whose files are gone out of the list: read the list again.
    const offHistory = window.lightning.onHistoryChanged(() => {
      void useTelegramStore.getState().loadJobs()
    })
    return () => {
      offJob()
      offHistory()
    }
  }, [])
}
