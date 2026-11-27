import type { NetworkInterfaceInfo, NetworkInterfaceKind } from '@shared/types'
import { useMemo } from 'react'
import { useAppStore } from '../store/useAppStore'
import { assignNetworkColors, resolveNetworkVisual, type NetworkVisual } from '../theme'

export type ResolveNetworkVisual = (
  id: string,
  kind: NetworkInterfaceKind,
  osName: string
) => NetworkVisual

/** Every known network and its kind, as JSON: a string, so a progress update that brings no
 * new network leaves it equal and doesn't re-render whoever asks. */
function knownNetworks(
  allInterfaces: NetworkInterfaceInfo[],
  downloads: AppState['downloads'],
  history: AppState['history']
): string {
  const networks = new Map<string, NetworkInterfaceKind>()
  for (const iface of allInterfaces) networks.set(iface.id, iface.kind)
  for (const download of Object.values(downloads)) {
    for (const network of download.networks) {
      if (!networks.has(network.id)) networks.set(network.id, network.kind)
    }
  }
  for (const download of history) {
    for (const network of download.networks) {
      if (!networks.has(network.id)) networks.set(network.id, network.kind)
    }
  }
  return JSON.stringify([...networks])
}

/** Colors are assigned across every known network at once (detected interfaces plus any a
 * download, running or finished, used), so each screen agrees on which network is which color.
 * The function returned stays the same until a network or a preference changes, so it can be
 * handed to memoized rows. */
type AppState = ReturnType<typeof useAppStore.getState>

/** One computation per store change for every caller: the result is cached on the inputs'
 * identities, and as a string it stays equal when no network was added, so nobody re-renders. */
let cached: { interfaces: unknown; downloads: unknown; history: unknown; key: string } | null = null
function selectKnownNetworks(store: AppState): string {
  if (
    cached &&
    cached.interfaces === store.allInterfaces &&
    cached.downloads === store.downloads &&
    cached.history === store.history
  )
    return cached.key
  const key = knownNetworks(store.allInterfaces, store.downloads, store.history)
  cached = {
    interfaces: store.allInterfaces,
    downloads: store.downloads,
    history: store.history,
    key
  }
  return key
}

export function useNetworkVisuals(): ResolveNetworkVisual {
  const known = useAppStore(selectKnownNetworks)
  const preferences = useAppStore((store) => store.networkPreferences)

  return useMemo(() => {
    const networks = new Map<string, NetworkInterfaceKind>(JSON.parse(known))
    const colors = assignNetworkColors(networks, preferences)
    return (id, kind, osName) =>
      resolveNetworkVisual(kind, osName, preferences[id], colors.get(id) ?? 'teal')
  }, [known, preferences])
}
