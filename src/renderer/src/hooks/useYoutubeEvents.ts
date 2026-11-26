import { useEffect } from 'react'
import { useYoutubeStore } from '../store/useYoutubeStore'

export function useYoutubeEvents(): void {
  useEffect(() => {
    const store = useYoutubeStore.getState()
    void store.refreshStatus()
    void store.loadJobs()
    const offJob = window.lightning.onYoutubeJobUpdated((job) =>
      useYoutubeStore.getState().setJob(job)
    )
    // Auto sync takes finished videos whose file is gone out of the list: read the list again.
    const offHistory = window.lightning.onHistoryChanged(() => {
      void useYoutubeStore.getState().loadJobs()
    })
    return () => {
      offJob()
      offHistory()
    }
  }, [])
}
