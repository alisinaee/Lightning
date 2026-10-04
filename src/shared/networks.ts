import type { NetworkInterfaceInfo, NetworkPreferences } from './types'

/** Off by the user's saved choice for that network. */
export function isNetworkOff(
  iface: Pick<NetworkInterfaceInfo, 'id'>,
  preferences: NetworkPreferences
): boolean {
  return preferences[iface.id]?.off === true
}

/** The networks a download may use. VPN tunnels are left out unless "Use VPN for downloads" is
 * on. If that would leave none (say, only a VPN is connected), all of them, so a download can
 * still start. */
export function selectableNetworks<T extends Pick<NetworkInterfaceInfo, 'kind'>>(
  interfaces: T[],
  useVpn: boolean
): T[] {
  if (useVpn) return interfaces
  const real = interfaces.filter((iface) => iface.kind !== 'vpn')
  return real.length > 0 ? real : interfaces
}

/** The networks on by default: those the user hasn't switched off. If every one is off, all of
 * them, so a download can still start. */
export function defaultNetworkIds(
  interfaces: Pick<NetworkInterfaceInfo, 'id' | 'kind'>[],
  preferences: NetworkPreferences,
  useVpn: boolean
): string[] {
  const usable = selectableNetworks(interfaces, useVpn)
  const on = usable.filter((iface) => !isNetworkOff(iface, preferences))
  return (on.length > 0 ? on : usable).map((iface) => iface.id)
}
