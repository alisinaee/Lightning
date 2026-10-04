import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useLabStore } from '../store/useLabStore'

/** Keeps the Test lab's state current for the lifetime of the app. */
export function useLabEvents(): void {
  const receive = useLabStore((store) => store.receive)
  const load = useLabStore((store) => store.load)
  const receiveSettings = useAppStore((store) => store.receiveSettings)
  useEffect(() => {
    const unsubscribe = window.plexo.onLabEvent((event) => receive(event.state))
    const unsubscribeSettings = window.plexo.onSettingsChanged(receiveSettings)
    void load()
    return () => {
      unsubscribe()
      unsubscribeSettings()
    }
  }, [receive, load, receiveSettings])
}
