import { useSyncExternalStore } from 'react'

/** The first-run intro and tour hold the screen for a while. Anything else that would pop up (a
 * warning dialog, say) waits until both are finished, so it never lands on top of them. */
const busy = new Set<string>()
const listeners = new Set<() => void>()

export function setFirstRunBusy(key: string, on: boolean): void {
  if (on === busy.has(key)) return
  if (on) busy.add(key)
  else busy.delete(key)
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useFirstRunBusy = (): boolean => useSyncExternalStore(subscribe, () => busy.size > 0)
