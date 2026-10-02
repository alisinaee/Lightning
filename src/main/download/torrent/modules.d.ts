// webtorrent and parse-torrent ship no types. These cover only what Plexo (and its e2e tests) use.

declare module 'webtorrent' {
  import type { EventEmitter } from 'node:events'
  import type { Socket } from 'node:net'

  export interface ClientOptions {
    dht?: boolean
    lsd?: boolean
    utp?: boolean
    natUpnp?: boolean
    natPmp?: boolean
    webSeeds?: boolean
    tracker?: boolean | object
    maxConns?: number
    /** Added by Plexo's patch (patches/webtorrent+3.0.21.patch): opens every outgoing TCP peer
     * connection. */
    connect?: (options: { host: string; port: number }) => Socket
  }

  export interface AddOptions {
    path?: string
    deselect?: boolean
    announce?: string[]
    skipVerify?: boolean
    bitfield?: Uint8Array
  }

  export interface SeedOptions {
    name?: string
    pieceLength?: number
    announce?: string[]
  }

  export interface Torrent extends EventEmitter {
    infoHash: string
    magnetURI: string
    torrentFile: Uint8Array
    name: string
    length: number
    destroy(options?: { destroyStore?: boolean }, callback?: (error?: Error) => void): void
    addPeer(address: string): boolean
  }

  export default class WebTorrent extends EventEmitter {
    constructor(options?: ClientOptions)
    maxConns: number
    torrents: Torrent[]
    add(torrentId: string | Uint8Array, options?: AddOptions): Torrent
    seed(
      input: Buffer | string | (Buffer | string)[],
      options: SeedOptions,
      onSeed: (torrent: Torrent) => void
    ): Torrent
    address(): { address: string; family: string; port: number }
    destroy(callback?: (error?: Error) => void): void
  }
}

declare module 'parse-torrent' {
  export interface ParsedTorrent {
    infoHash: string
    name?: string
    length?: number
    pieceLength?: number
    files?: { path: string; name: string; length: number; offset: number }[]
  }
  export default function parseTorrent(torrentId: string | Uint8Array): Promise<ParsedTorrent>
}
