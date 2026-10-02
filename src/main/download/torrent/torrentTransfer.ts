import { isIP, Socket } from 'node:net'
import type WebTorrent from 'webtorrent'
import type { Torrent, Wire } from 'webtorrent'
import type { ChunkState, DownloadNetwork } from '../../../shared/types'
import { connectRoute } from '../../network/deviceBinding'
import { routesFor, type NetworkRoute } from '../../network/routes'
import {
  calculateCurrentSpeed,
  pushSpeedSample,
  recomputeAggregates,
  type SpeedSample,
  type Transfer,
  type TransferHost,
  type TransferTarget
} from '../transfer'
import { createClient } from './engine'
import { bitfieldOf, creditPiece, pickNetwork } from './peers'

/** Peers each network in use may have at once (webtorrent's maxConns is this times the networks). */
const PEERS_PER_NETWORK = 30
// A network that has dialled this many peers with none answering, for this long, while another
// network has peers, can't reach the swarm. It keeps one dial going, to see when it can again.
const UNREACHABLE_AFTER_ATTEMPTS = 5
const UNREACHABLE_AFTER_MS = 60_000

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** webtorrent's name for a peer: what it hands the hook as host and port, and the 'wire' event as
 * an address. */
const addressOf = (host: string, port: number): string =>
  isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`

interface Peer {
  chunk: ChunkState
  /** Everything it has sent, what its speed is measured from. */
  received: number
}

/**
 * Fetches a torrent with webtorrent, every peer pinned to one network. webtorrent finds the peers
 * and runs the protocol; each time it dials one, its `connect` hook (see engine.ts and
 * patches/webtorrent+3.0.21.patch) asks this transfer which network to use, and the socket comes
 * from connectRoute, as HTTP's do. Peers are the download's streams, and a piece is credited to
 * the networks that delivered it once webtorrent has verified it and written it to disk.
 *
 * One webtorrent client per run: a pause destroys it, files kept, and a resume starts a new one
 * from the pieces already done.
 */
export class TorrentTransfer implements Transfer {
  private client: WebTorrent | null = null
  /** Destroys this run's client; safe to repeat. */
  private closeClient: (() => void) | null = null
  /** Settles once this run's client is gone. Null between runs. */
  private ended: Promise<void> | null = null
  private peers = new Map<Wire, Peer>()
  private nextPeerId = 0
  /** The network each peer was dialled through, by webtorrent's address for it. */
  private chosen = new Map<string, string>()
  /** Dials in flight, by network. */
  private dialling = new Map<string, number>()
  /** By network: dials since a peer last answered, and when one last did. */
  private reach = new Map<string, { dials: number; answeredAt: number }>()
  /** Bytes of each piece not verified yet, by network. */
  private unverified = new Map<number, Record<string, number>>()
  /** By network: what it has sent to peers, sampled for its upload speed. */
  private uploadSamples = new Map<string, SpeedSample[]>()

  constructor(
    private readonly runtime: TransferTarget,
    private readonly host: TransferHost,
    private readonly torrentFile: Uint8Array,
    /** Where webtorrent writes the torrent (StagingFolder.folder). */
    private readonly folder: string
  ) {}

  reconcile(): void {
    const usable = this.usable()
    if (!this.ended) this.ended = this.run()
    if (this.client) this.client.maxConns = PEERS_PER_NETWORK * usable.length
    // A network switched off, or gone, takes its peers with it.
    for (const [wire, peer] of this.peers) {
      if (!usable.some((network) => network.id === peer.chunk.interfaceId)) wire.destroy()
    }
  }

  tick(now: number): void {
    const withPeers = new Set([...this.peers.values()].map((peer) => peer.chunk.interfaceId))
    for (const network of this.usable()) {
      const reach = this.reachOf(network.id, now)
      if (
        network.status === 'on' &&
        reach.dials >= UNREACHABLE_AFTER_ATTEMPTS &&
        now - reach.answeredAt >= UNREACHABLE_AFTER_MS &&
        !withPeers.has(network.id) &&
        withPeers.size > 0
      ) {
        network.status = 'unreachable'
        this.host.scheduleUpdate()
      }
    }
    // Uploads come in bursts; between them the speeds fall back to 0 here.
    this.updateUploadSpeeds(now)
    this.host.reconcile()
  }

  running(): Iterable<Promise<void>> {
    return this.ended ? [this.ended] : []
  }

  abort(): void {
    this.closeClient?.()
  }

  reset(): void {
    this.chosen.clear()
    this.dialling.clear()
    this.reach.clear()
    // webtorrent drops what it had of unfinished pieces with its client.
    this.unverified.clear()
  }

  wake(_pick: (networkId: string) => boolean, reconnect: (networkId: string) => boolean): void {
    // Peers on a network whose address changed are on dead sockets; webtorrent dials new ones.
    for (const [wire, peer] of this.peers) if (reconnect(peer.chunk.interfaceId)) wire.destroy()
  }

  systemResumed(now: number): void {
    // Time asleep says nothing about whether a network can reach the swarm.
    for (const reach of this.reach.values()) reach.answeredAt = now
  }

  /** One run: a client added to the torrent, until the run stops (pause, cancel, error, done).
   * Settles once the client is destroyed and its files closed. */
  private async run(): Promise<void> {
    const stop = this.runtime.stop.signal
    try {
      const client = await createClient({
        connect: (options) => this.connect(options),
        maxConns: PEERS_PER_NETWORK * Math.max(1, this.usable().length)
      })
      await new Promise<void>((resolve) => {
        let closing = false
        const close = (): void => {
          if (closing) return
          closing = true
          this.client = null
          this.closeClient = null
          // After a fatal error webtorrent has already torn itself down.
          if (client.destroyed) resolve()
          else client.destroy(() => resolve())
        }
        if (stop.aborted) return close()
        this.client = client
        this.closeClient = close
        stop.addEventListener('abort', close, { once: true })
        client.on('error', (error: unknown) => {
          this.host.failDownload(message(error))
          close()
        })
        this.add(client)
      })
    } catch (error) {
      this.host.failDownload(message(error))
    } finally {
      for (const peer of this.peers.values()) this.removePeer(peer)
      this.peers.clear()
      this.uploadSamples.clear()
      this.updateUploadSpeeds(Date.now())
      this.ended = null
    }
  }

  /** A peer took `bytes` of a piece from this download, over `network`. */
  private onUpload(network: DownloadNetwork, bytes: number): void {
    const { state } = this.runtime
    network.bytesUploaded = (network.bytesUploaded ?? 0) + bytes
    state.bytesUploaded = (state.bytesUploaded ?? 0) + bytes
    let samples = this.uploadSamples.get(network.id)
    if (!samples) this.uploadSamples.set(network.id, (samples = []))
    pushSpeedSample(samples, network.bytesUploaded, Date.now())
    this.updateUploadSpeeds(Date.now())
  }

  /** Each network's upload speed, and the download's, as of `now`: one that has stopped sending
   * reads 0 once its samples are older than the speed window. */
  private updateUploadSpeeds(now: number): void {
    const { state } = this.runtime
    let total = 0
    for (const network of state.networks) {
      const speed = calculateCurrentSpeed(this.uploadSamples.get(network.id), now)
      network.uploadSpeedBytesPerSec = speed
      total += speed
    }
    if (total !== state.uploadSpeedBytesPerSec) this.host.scheduleUpdate()
    state.uploadSpeedBytesPerSec = total
  }

  private add(client: WebTorrent): void {
    const chosen = this.runtime.requestPayload.selectedFiles
    const torrent = client.add(this.torrentFile, {
      path: this.folder,
      // Trusted as done, bar a hash check of a piece or two per file (more if one fails).
      bitfield: bitfieldOf(this.runtime.blocks.map((block) => block.status === 'completed')),
      // Only the chosen files, once webtorrent is ready to be told which (below).
      deselect: chosen !== undefined
    })
    torrent.on('wire', (wire: Wire, address: string) => this.onWire(wire, address))
    torrent.on('verified', (index: number) => this.onVerified(index))
    torrent.once('ready', () => {
      torrent.files.forEach((file, index) => {
        if (chosen?.includes(index)) file.select()
      })
      this.followEngine(torrent)
    })
    torrent.on('error', (error: unknown) => this.host.failDownload(message(error)))
  }

  /** The networks peers may use now. One that can't reach the swarm stays, for its one dial. */
  private usable(): DownloadNetwork[] {
    return this.runtime.state.networks.filter(
      (network) => network.status === 'on' || network.status === 'unreachable'
    )
  }

  private reachOf(networkId: string, now = Date.now()): { dials: number; answeredAt: number } {
    let reach = this.reach.get(networkId)
    if (!reach) this.reach.set(networkId, (reach = { dials: 0, answeredAt: now }))
    return reach
  }

  /** webtorrent's `connect` hook: every outgoing peer comes through here. */
  private connect({ host: address, port }: { host: string; port: number }): Socket {
    // A peer named by hostname (a magnet's x.pe can be) has no family: no network takes it.
    const family = isIP(address) as 0 | 4 | 6
    const peersOn = (id: string): number =>
      (this.dialling.get(id) ?? 0) +
      [...this.peers.values()].filter((peer) => peer.chunk.interfaceId === id).length
    const routes = new Map<string, NetworkRoute>()
    for (const network of this.usable()) {
      const iface = this.host.networks.find(network.id)
      const route = family ? iface && routesFor(iface, [{ address, family }])[0] : undefined
      if (!route) continue
      // An unreachable network gets one dial at a time, to find out when it's back.
      if (network.status === 'unreachable' && peersOn(network.id) > 0) continue
      routes.set(network.id, route)
    }
    const networkId = pickNetwork([...routes.keys()].map((id) => ({ id, peers: peersOn(id) })))
    if (!networkId) {
      const socket = new Socket()
      process.nextTick(() => socket.destroy(new Error('No network in use can reach this peer')))
      return socket
    }

    this.chosen.set(addressOf(address, port), networkId)
    this.dialling.set(networkId, (this.dialling.get(networkId) ?? 0) + 1)
    this.reachOf(networkId).dials += 1
    const socket = connectRoute(routes.get(networkId)!, port)
    let settled = false
    const settle = (): void => {
      if (settled) return
      settled = true
      this.dialling.set(networkId, (this.dialling.get(networkId) ?? 1) - 1)
    }
    socket.once('connect', settle)
    socket.once('close', settle)
    return socket
  }

  private onWire(wire: Wire, address: string): void {
    const networkId = this.chosen.get(address)
    const network = this.runtime.state.networks.find((entry) => entry.id === networkId)
    // A peer that dialled in came through whichever network the OS chose, which nothing here can
    // tell: only peers this transfer dialled, each through its network, are kept.
    if (!network) {
      wire.destroy()
      return
    }
    // Every network uploads, whatever its kind: each has an address of its own, and webtorrent's
    // tit-for-tat gives a network's peers back what they send it.

    const reach = this.reachOf(network.id)
    reach.dials = 0
    reach.answeredAt = Date.now()
    if (network.status === 'unreachable') network.status = 'on'

    const chunk: ChunkState = {
      id: this.nextPeerId++,
      interfaceId: network.id,
      rangeStart: 0,
      rangeEnd: null,
      bytesDownloaded: 0,
      speedBytesPerSec: 0,
      status: 'downloading'
    }
    const peer: Peer = { chunk, received: 0 }
    this.peers.set(wire, peer)
    const { state } = this.runtime
    state.chunks.push(chunk)
    state.peakStreams = Math.max(state.peakStreams ?? 0, state.chunks.length)

    wire.on('piece', (index: number, _offset: number, buffer: Uint8Array) => {
      const now = Date.now()
      peer.received += buffer.length
      chunk.bytesDownloaded += buffer.length
      const pending = this.unverified.get(index) ?? {}
      pending[network.id] = (pending[network.id] ?? 0) + buffer.length
      this.unverified.set(index, pending)
      const block = this.runtime.blocks[index]
      if (block) {
        // In flight now; it counts once verified (onVerified).
        if (block.status === 'pending') {
          block.status = 'downloading'
          block.interfaceId = network.id
        }
        chunk.currentBlockIndex = index
        chunk.rangeStart = block.rangeStart
        chunk.rangeEnd = block.rangeEnd
      }
      let samples = this.runtime.speedSamplesByChunk.get(chunk.id)
      if (!samples) this.runtime.speedSamplesByChunk.set(chunk.id, (samples = []))
      chunk.speedBytesPerSec = pushSpeedSample(samples, peer.received, now)
      this.host.scheduleUpdate()
    })
    wire.on('upload', (bytes: number) => this.onUpload(network, bytes))
    wire.once('close', () => {
      if (this.peers.delete(wire)) this.removePeer(peer)
    })
    this.host.scheduleUpdate()
  }

  private removePeer(peer: Peer): void {
    const { chunks } = this.runtime.state
    const index = chunks.indexOf(peer.chunk)
    if (index >= 0) chunks.splice(index, 1)
    this.runtime.speedSamplesByChunk.delete(peer.chunk.id)
    this.host.scheduleUpdate()
  }

  /** A piece verified and written: it counts now, credited to the networks that delivered it. */
  private onVerified(index: number): void {
    const block = this.runtime.blocks[index]
    const received = this.unverified.get(index) ?? {}
    this.unverified.delete(index)
    // A skipped piece fetched anyway isn't this download's: nothing chosen needs it.
    if (!block || block.status === 'completed' || block.status === 'skipped') return
    if (block.rangeEnd === null) return
    const { state } = this.runtime
    const length = block.rangeEnd - block.rangeStart + 1
    // Found on disk rather than received: whoever held it last, else the first network in use.
    const fallback = block.interfaceId ?? this.usable()[0]?.id ?? state.networks[0].id
    const shares = creditPiece(received, length, fallback)
    state.bytesDownloaded += length - block.bytesDownloaded
    for (const [id, bytes] of Object.entries(block.bytesByInterface)) {
      const network = state.networks.find((entry) => entry.id === id)
      if (network) network.bytesDownloaded -= bytes
    }
    for (const [id, bytes] of Object.entries(shares)) {
      const network = state.networks.find((entry) => entry.id === id)
      if (network) network.bytesDownloaded += bytes
    }
    block.bytesByInterface = shares
    block.bytesDownloaded = length
    block.interfaceId = Object.entries(shares).sort((a, b) => b[1] - a[1])[0][0]
    block.status = 'completed'
    this.host.scheduleUpdate()
  }

  /**
   * Once webtorrent has checked what is on disk: a piece it found wanting, though this download
   * had it as done, is fetched again — and isn't done here either, or the download would be
   * published without it.
   */
  private followEngine(torrent: Torrent): void {
    let changed = false
    for (const block of this.runtime.blocks) {
      if (block.status === 'completed' && !torrent.bitfield.get(block.index)) {
        block.status = 'pending'
        block.bytesDownloaded = 0
        block.bytesByInterface = {}
        changed = true
      }
    }
    if (changed) {
      recomputeAggregates(this.runtime)
      this.host.scheduleUpdate()
    }
  }
}
