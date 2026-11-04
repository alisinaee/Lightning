import { useEffect } from 'react'
import { useYoutubeStore } from '../store/useYoutubeStore'

export function useYoutubeEvents(): void {
  useEffect(() => {
    const store = useYoutubeStore.getState()
    void store.refreshStatus()
    void store.loadJobs()
    return window.lightning.onYoutubeJobUpdated((job) => useYoutubeStore.getState().setJob(job))
  }, [])
}
