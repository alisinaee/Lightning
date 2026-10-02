import type WebTorrent from 'webtorrent'
import type { ClientOptions } from 'webtorrent'
import { testKnobs } from '../../testKnobs'

// The only file that loads webtorrent. It's ESM-only and main is bundled as CommonJS, so it comes
// in through import(), once, and only when a torrent is first looked at.
let loaded: Promise<typeof WebTorrent> | null = null

function loadWebTorrent(): Promise<typeof WebTorrent> {
  loaded ??= import('webtorrent').then((module) => module.default)
  return loaded
}

/**
 * A webtorrent client set up for Plexo:
 * - uTP is off: its UDP sockets can't be pinned to a network the way `connect` pins TCP ones.
 * - Web seeds are off: webtorrent fetches them over HTTP itself, again past `connect`.
 * - No port mapping (UPnP, NAT-PMP) and no local peer discovery: nothing beyond the peers.
 */
export async function createClient(
  options: Pick<ClientOptions, 'connect' | 'maxConns'> = {}
): Promise<WebTorrent> {
  const Client = await loadWebTorrent()
  return new Client({
    utp: false,
    webSeeds: false,
    natUpnp: false,
    natPmp: false,
    lsd: false,
    dht: testKnobs.torrentDht,
    ...options
  })
}
