import type { NetworkInterfaceInfo, NetworkPreferences } from './types'

/** Off by the user's saved choice, or else by default for a VPN. */
export function isNetworkOff(
  iface: Pick<NetworkInterfaceInfo, 'id' | 'kind'>,
  preferences: NetworkPreferences
): boolean {
  return preferences[iface.id]?.off ?? iface.kind === 'vpn'
}

/** The networks on by default. If every network is off (say, only a VPN is connected), all of
 * them, so a download can still start. */
export function defaultNetworkIds(
  interfaces: Pick<NetworkInterfaceInfo, 'id' | 'kind'>[],
  preferences: NetworkPreferences
): string[] {
  const on = interfaces.filter((iface) => !isNetworkOff(iface, preferences))
  return (on.length > 0 ? on : interfaces).map((iface) => iface.id)
}
