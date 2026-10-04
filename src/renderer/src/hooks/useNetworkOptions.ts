import { useAppStore } from '../store/useAppStore'
import { useNetworkVisuals } from './useNetworkVisuals'

export interface NetworkOption {
  id: string
  name: string
  solid: string
  vpn: boolean
}

/** The networks detected now, named and colored as everywhere else. */
export function useNetworkOptions(): NetworkOption[] {
  const interfaces = useAppStore((store) => store.interfaces)
  const networkVisual = useNetworkVisuals()
  return interfaces.map((iface) => {
    const visual = networkVisual(iface.id, iface.kind, iface.displayName)
    return { id: iface.id, name: visual.name, solid: visual.solid, vpn: iface.kind === 'vpn' }
  })
}
