import { useEffect } from 'react'
import { useLabStore } from '../store/useLabStore'

/** Keeps the Test lab's state current for the lifetime of the app. */
export function useLabEvents(): void {
  const receive = useLabStore((store) => store.receive)
  const load = useLabStore((store) => store.load)
  useEffect(() => {
    const unsubscribe = window.plexo.onLabEvent((event) => receive(event.state))
    void load()
    return unsubscribe
  }, [receive, load])
}
