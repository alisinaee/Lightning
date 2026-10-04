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

/** A VPN tunnel is not a connection. It is one layer over the real connections, switched by
 * "Use VPN for downloads", so it never appears in a list of connections. */
export function isVpn(item: { kind: NetworkInterfaceInfo['kind'] }): boolean {
  return item.kind === 'vpn'
}

/** The real connections: everything but VPN tunnels. Every list of connections goes through this
 * (the store keeps it as `interfaces`). */
export function connectionsOnly<T extends { kind: NetworkInterfaceInfo['kind'] }>(
  interfaces: T[]
): T[] {
  return interfaces.filter((item) => !isVpn(item))
}

/** The ids a download is started on: the chosen connections, plus the VPN tunnels when the VPN
 * layer is on (or when a VPN is all there is, so a download can still start). */
export function withVpnLayer(
  connectionIds: string[],
  all: Pick<NetworkInterfaceInfo, 'id' | 'kind'>[],
  useVpn: boolean
): string[] {
  const tunnels = all.filter(isVpn).map((item) => item.id)
  if (tunnels.length === 0) return connectionIds
  if (useVpn || connectionIds.length === 0) return [...connectionIds, ...tunnels]
  return connectionIds
}
