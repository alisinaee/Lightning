import { createReadStream } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

// An embedded download server for the Test lab: the features of scripts/fake-server.mjs (speed
// shared per network, named by the X-Lightning-Network header), driven by direct method calls, with
// counters per network and per file, a file whose every byte can be checked, and the faults a
// real server shows: busy answers, cut and stalled connections, a wrong Content-Range.
//
// A file's content is a pattern of its path and offset, so any saved file can be checked without
// keeping a copy: see patternByte and verifyFile.
//
// Link options: mb=<size in MB, may be fractional> or bytes=<n>, kbps=<cap per connection>,
// norange=1 (no range support), slowstart=<ms before answering>, and these faults, each for the
// first `times` requests of that exact link (and only within the first `forMs` ms of it, if given):
//   fail=N                       answer 500 to the first N requests (same as status=500&times=N)
//   status=<code>[&retryAfter=S] answer with that status (429, 503, ...), asking for S seconds
//   cut=<bytes>                  send that many body bytes, then drop the connection
//   stall=1                      send the headers, then nothing
//   wrongrange=1                 answer a range with the wrong start in Content-Range
// `times` defaults to 1 (wrongrange: every request).

const CHUNK = 64 * 1024
const TICK_MS = 50
const MAX_PER_TICK = 2 * 1024 * 1024
const MIX = 0x9e3779b1
/** A slow reader gets no more than this much ahead of it: bytes are counted as sent only when
 * the connection can take them, so the counters show what the client could really read. */
const MAX_BUFFERED = 1024 * 1024

export type Speed = number | 'block' | 'unlimited'

function hashOf(path: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** The byte at `offset` of the file at `path`: depends on both, and on every 256-byte group
 * differently, so a block written at the wrong place never matches by accident. */
export function patternByte(path: string, offset: number): number {
  return patternByteH(hashOf(path), offset)
}

function groupBase(h: number, group: number): number {
  return (h + (Math.imul((group % 4294967296) | 0, MIX) >>> 24)) & 255
}

function patternByteH(h: number, offset: number): number {
  return (groupBase(h, Math.floor(offset / 256)) + (offset % 256) * 131) & 255
}

/** Writes bytes `offset` .. `offset + length` of the file with hash `h` into `target`. */
function fillPattern(target: Buffer, h: number, offset: number, length: number): void {
  let group = Math.floor(offset / 256)
  let base = groupBase(h, group)
  let within = offset % 256
  for (let i = 0; i < length; i++) {
    target[i] = (base + within * 131) & 255
    if (++within === 256) {
      within = 0
      base = groupBase(h, ++group)
    }
  }
}

export interface NetCount {
  requests: number
  bytes: number
}

interface Conn {
  res: ServerResponse
  hash: number
  /** Next byte to send, and the last one to send. */
  sent: number
  end: number
  kbps: number
  carry: number
  allow: number
  /** Drop the connection once `sent` passes this (a cut). */
  dropAt: number | null
  path: string
}

interface Network {
  cap: number // KB/s; 0 unlimited; -1 blocked
  carry: number
  conns: Set<Conn>
  count: NetCount
}

export interface NetworkSnapshot extends NetCount {
  key: string
  capKBps: number
  connections: number
}

export interface VerifyResult {
  ok: boolean
  /** The first byte that is wrong; null when the file is right (or only the size is). */
  firstMismatch: number | null
  actualSize: number
}

export class FakeServer {
  port = 0
  private server: Server | null = null
  private nets = new Map<string, Network>()
  /** path -> network -> counts */
  private files = new Map<string, Map<string, NetCount>>()
  private hits = new Map<string, { seen: number; first: number }>()
  private sockets = new Set<Socket>()
  private ticker: NodeJS.Timeout | null = null
  private events: string[] = []

  /** `defaultKbps`: the speed a network not set yet gets. */
  constructor(private defaultKbps = 4000) {}

  /** Starts listening on 127.0.0.1: `preferredPort` if it is free, else the first free port from 18000. */
  async start(preferredPort?: number): Promise<number> {
    if (this.server) return this.port
    const tries = preferredPort ? [preferredPort] : []
    for (let p = 18000; p < 18200; p++) tries.push(p)
    for (const candidate of tries) {
      const server = createServer((req, res) => this.handle(req, res))
      server.on('connection', (socket) => {
        this.sockets.add(socket)
        socket.on('close', () => this.sockets.delete(socket))
      })
      const ok = await new Promise<boolean>((resolve) => {
        server.once('error', () => resolve(false))
        server.listen(candidate, '127.0.0.1', () => resolve(true))
      })
      if (!ok) {
        server.close()
        continue
      }
      this.server = server
      this.port = (server.address() as AddressInfo).port
      this.ticker = setInterval(() => this.tick(), TICK_MS)
      this.ticker.unref()
      return this.port
    }
    throw new Error('No free port for the lab server (tried 18000-18199)')
  }

  async stop(): Promise<void> {
    if (this.ticker) clearInterval(this.ticker)
    this.ticker = null
    const server = this.server
    this.server = null
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  get running(): boolean {
    return this.server !== null
  }

  /** A link to `path` (with `query`, e.g. `mb=20&fail=2`). */
  url(path: string, query = ''): string {
    return `http://127.0.0.1:${this.port}${path}${query ? `?${query}` : ''}`
  }

  private net(key: string): Network {
    let n = this.nets.get(key)
    if (!n) {
      n = { cap: this.defaultKbps, carry: 0, conns: new Set(), count: { requests: 0, bytes: 0 } }
      this.nets.set(key, n)
    }
    return n
  }

  private note(message: string): void {
    this.events.push(message)
    if (this.events.length > 100) this.events.shift()
  }

  /** Sets what `network` may take, in KB/s, 'unlimited', or 'block' (answers 503, drops what runs). */
  setSpeed(network: string, speed: Speed): void {
    const n = this.net(network)
    n.cap = speed === 'block' ? -1 : speed === 'unlimited' ? 0 : speed
    this.note(`${network} -> ${speed}`)
    if (n.cap < 0) for (const conn of [...n.conns]) conn.res.destroy()
  }

  speedOf(network: string): Speed {
    const cap = this.nets.get(network)?.cap ?? this.defaultKbps
    return cap < 0 ? 'block' : cap === 0 ? 'unlimited' : cap
  }

  /** Every network's speed back to the default, and the counts and fault memory cleared. */
  reset(): void {
    for (const n of this.nets.values()) {
      n.cap = this.defaultKbps
      n.carry = 0
      n.count = { requests: 0, bytes: 0 }
    }
    this.files.clear()
    this.hits.clear()
    this.events = []
  }

  /** Clears only the counts (and the fault memory), keeping speeds. */
  resetCounters(): void {
    for (const n of this.nets.values()) n.count = { requests: 0, bytes: 0 }
    this.files.clear()
    this.hits.clear()
  }

  /** What each network has asked for and been sent, by network key. */
  counters(): Record<string, NetCount> {
    const out: Record<string, NetCount> = {}
    for (const [key, n] of this.nets) out[key] = { ...n.count }
    return out
  }

  /** The same for one file (a link's path), by network key. */
  fileCounters(path: string): Record<string, NetCount> {
    const out: Record<string, NetCount> = {}
    for (const [key, count] of this.files.get(path) ?? []) out[key] = { ...count }
    return out
  }

  networks(): NetworkSnapshot[] {
    return [...this.nets].map(([key, n]) => ({
      key,
      capKBps: n.cap,
      connections: n.conns.size,
      ...n.count
    }))
  }

  recentEvents(): string[] {
    return [...this.events]
  }

  /** Streams the file at `filePath` and compares it with what the link `urlPath` serves. */
  async verifyFile(urlPath: string, filePath: string, size: number): Promise<VerifyResult> {
    const h = hashOf(urlPath)
    let position = 0
    let firstMismatch: number | null = null
    const expected = Buffer.alloc(CHUNK)
    try {
      for await (const part of createReadStream(filePath, { highWaterMark: CHUNK })) {
        const data = part as Buffer
        if (firstMismatch === null) {
          const want = expected.subarray(0, data.length)
          fillPattern(want, h, position, data.length)
          if (!want.equals(data)) {
            let i = 0
            while (want[i] === data[i]) i++
            firstMismatch = position + i
          }
        }
        position += data.length
      }
    } catch {
      return { ok: false, firstMismatch: 0, actualSize: -1 }
    }
    if (position !== size && firstMismatch === null) firstMismatch = Math.min(position, size)
    return { ok: firstMismatch === null && position === size, firstMismatch, actualSize: position }
  }

  /** One shared clock hands out each network's byte budget to its connections, round-robin. */
  private tick(): void {
    for (const n of this.nets.values()) {
      if (n.cap < 0) continue
      const perTick = n.cap === 0 ? MAX_PER_TICK : (n.cap * 1024 * TICK_MS) / 1000
      let budget = n.carry + perTick
      const live = [...n.conns].filter(
        (c) => c.sent <= c.end && c.res.writableLength < MAX_BUFFERED
      )
      for (const c of live) {
        const own = c.kbps > 0 ? (c.kbps * 1024 * TICK_MS) / 1000 : Infinity
        c.allow = Math.min(MAX_PER_TICK, c.carry + own)
      }
      let progress = true
      while (budget > 0 && progress) {
        progress = false
        for (const c of live) {
          const limit = c.dropAt === null ? c.end : Math.min(c.end, c.dropAt)
          const k = Math.floor(Math.min(CHUNK, budget, c.allow, limit - c.sent + 1))
          if (k <= 0 || c.res.writableLength >= MAX_BUFFERED) continue
          const body = Buffer.allocUnsafe(k)
          fillPattern(body, c.hash, c.sent, body.length)
          c.res.write(body)
          c.sent += body.length
          c.allow -= body.length
          budget -= body.length
          n.count.bytes += body.length
          this.addFileBytes(c.path, this.keyOf(n), body.length)
          progress = true
        }
      }
      n.carry = live.length ? Math.min(budget, perTick) : 0
      for (const c of live) {
        c.carry = c.kbps > 0 ? Math.min(c.allow, (c.kbps * 1024 * TICK_MS) / 1000) : 0
        if (c.dropAt !== null && c.sent > c.dropAt) {
          n.conns.delete(c)
          c.res.destroy()
        } else if (c.sent > c.end) {
          n.conns.delete(c)
          c.res.end()
        }
      }
    }
  }

  private keyOf(network: Network): string {
    for (const [key, n] of this.nets) if (n === network) return key
    return '?'
  }

  private fileNet(path: string, key: string): NetCount {
    let byNet = this.files.get(path)
    if (!byNet) this.files.set(path, (byNet = new Map()))
    let count = byNet.get(key)
    if (!count) byNet.set(key, (count = { requests: 0, bytes: 0 }))
    return count
  }

  private addFileBytes(path: string, key: string, bytes: number): void {
    this.fileNet(path, key).bytes += bytes
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://x')
    const q = url.searchParams
    const path = url.pathname
    const key = String(
      req.headers['x-lightning-network'] ||
        (req.socket.remoteAddress ?? '?').replace(/^::ffff:/, '')
    )
    const n = this.net(key)
    n.count.requests++
    this.fileNet(path, key).requests++

    const size = Math.round(
      q.has('bytes') ? Number(q.get('bytes')) : Number(q.get('mb') ?? 10) * 1024 * 1024
    )
    const kbps = Number(q.get('kbps') ?? 0)
    const name = decodeURIComponent(path.split('/').pop() || 'file.bin')
    if (n.cap < 0) {
      res.writeHead(503, { 'Retry-After': '5' })
      return void res.end()
    }

    const hit = this.hits.get(req.url ?? '') ?? { seen: 0, first: Date.now() }
    this.hits.set(req.url ?? '', { seen: hit.seen + 1, first: hit.first })
    const forMs = q.has('forMs') ? Number(q.get('forMs')) : null
    const times = Number(q.get('times') ?? (q.has('fail') ? q.get('fail') : 1))
    const faulty = (always = false): boolean =>
      (always && !q.has('times') ? true : hit.seen < times) &&
      (forMs === null || Date.now() - hit.first < forMs)

    const status = q.has('fail') ? 500 : Number(q.get('status') ?? 0)
    if (status > 0 && faulty()) {
      this.note(`${status} for ${path} (${key})`)
      const retryAfter = q.get('retryAfter')
      res.writeHead(status, retryAfter ? { 'Retry-After': retryAfter } : {})
      return void res.end()
    }

    const ranged = q.get('norange') !== '1'
    const headers = {
      ...(ranged ? { 'Accept-Ranges': 'bytes' } : {}),
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name}"`,
      ETag: `"lab-${name}-${size}"`
    }
    let start = 0
    let end = size - 1
    const range = ranged ? /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? '')) : null
    if (range) {
      if (range[1] !== '') start = Number(range[1])
      if (range[2] !== '') end = Math.min(Number(range[2]), size - 1)
      if (range[1] === '' && range[2] !== '') {
        start = Math.max(0, size - Number(range[2]))
        end = size - 1
      }
    }
    const wrong = range && q.get('wrongrange') === '1' && faulty(true)
    const respond = (): void => {
      if (range) {
        res.writeHead(206, {
          ...headers,
          'Content-Range': `bytes ${wrong ? start + 1 : start}-${wrong ? end + 1 : end}/${size}`,
          'Content-Length': end - start + 1
        })
      } else {
        res.writeHead(200, { ...headers, 'Content-Length': size })
      }
      if (req.method === 'HEAD') return void res.end()
      if (q.get('stall') === '1' && faulty()) {
        this.note(`stall for ${path} (${key})`)
        return // headers sent, then silence: the client gives up on it
      }
      const cut = q.has('cut') && faulty() ? Number(q.get('cut')) : null
      if (cut !== null) this.note(`cut after ${cut} bytes for ${path} (${key})`)
      const conn: Conn = {
        res,
        hash: hashOf(path),
        sent: start,
        end,
        kbps,
        carry: 0,
        allow: 0,
        dropAt: cut === null ? null : start + cut - 1,
        path
      }
      n.conns.add(conn)
      res.on('close', () => n.conns.delete(conn))
    }
    const slow = Number(q.get('slowstart') ?? 0)
    if (slow > 0) setTimeout(() => !res.destroyed && respond(), slow)
    else respond()
  }
}
