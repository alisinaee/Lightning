export type WithNetworks = { networks: { id: string; bytesDownloaded: number }[] }

/** What each connection has delivered so far, finished files included. */
export function bytesByNetwork(items: WithNetworks[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const item of items) {
    for (const network of item.networks) {
      totals.set(network.id, (totals.get(network.id) ?? 0) + network.bytesDownloaded)
    }
  }
  return totals
}
