import { summarizeActivity } from '@shared/trayModel'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../store/useAppStore'

export interface ActivityTotals {
  /** Speed of everything downloading now, in bytes a second. */
  speed: number
  /** Downloads running now. */
  active: number
  /** Downloads waiting in the queue. */
  waiting: number
  /** Every download in the list, finished or not. */
  total: number
}

/** The totals of the downloads as plain numbers: a component that shows them is not re-rendered
 * for changes to the downloads' other fields, and nothing is re-rendered when no total moves. */
export function useActivityTotals(): ActivityTotals {
  return useAppStore(
    useShallow((store) => {
      const activity = summarizeActivity(Object.values(store.downloads), {})
      return {
        speed: activity.speed,
        active: activity.running.length,
        waiting: activity.queued,
        total: Object.keys(store.downloads).length
      }
    })
  )
}

/** The speed now over each network (VPNs left out), keyed by network id. */
export function useNetworkSpeeds(): Record<string, number> {
  return useAppStore(
    useShallow((store) => {
      const { networks } = summarizeActivity(Object.values(store.downloads), {})
      return Object.fromEntries(networks.map((network) => [network.id, network.speed]))
    })
  )
}
