import type { NetworkInterfaceInfo } from '@shared/types'
import { useAppStore } from '../store/useAppStore'

/** The connections to list: Wi-Fi, USB, Ethernet and so on. Never a VPN tunnel — a VPN is one
 * layer over the connections (see useVpnLayer), not another connection. Every list of networks
 * reads from here (or the store's `interfaces`, which is the same thing). */
export function useConnections(): NetworkInterfaceInfo[] {
  return useAppStore((store) => store.interfaces)
}

/** The VPN layer: whether a tunnel is detected, whether downloads may use it, and its names. */
export function useVpnLayer(): {
  detected: boolean
  on: boolean
  tunnels: NetworkInterfaceInfo[]
  setOn: (on: boolean) => void
} {
  const tunnels = useAppStore((store) => store.vpnInterfaces)
  const on = useAppStore((store) => store.useVpn)
  const setOn = useAppStore((store) => store.setUseVpn)
  return { detected: tunnels.length > 0, on, tunnels, setOn }
}

/** What the VPN layer is doing, in a sentence. */
export function describeVpn(on: boolean, tunnels: string[]): string {
  return on ? `On — via ${tunnels.join(', ')}` : 'Off — downloads use your real connections'
}
