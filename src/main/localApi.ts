import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { RequestExtras } from '../shared/types'
import { sanitizeExtras } from '../shared/requestHeaders'
import { redactUrl } from '../shared/urlTools'
import { log } from './logger'

/** The ports Lightning tries, in order; the extension looks for it on the same ones. */
export const API_PORTS = [17891, 17892, 17893, 17894, 17895, 17896, 17897, 17898, 17899, 17900]
const MAX_BODY_BYTES = 256 * 1024
const ADDS_PER_WINDOW = 20
const WINDOW_MS = 10_000

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i
const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension|safari-web-extension):\/\/[^/]+$/i

export interface LocalApiDeps {
  version: string
  /** The pairing key every call but ping must carry. */
  token: () => Promise<string>
  /** A link (and what its requests need) the browser sent: for the New download dialog. */
  onAdd: (url: string, extras: RequestExtras) => void
}

function digest(text: string): Buffer {
  return createHash('sha256').update(text).digest()
}

/** A server on this computer's loopback for the browser extension: it hands a link, with the page
 * and cookies the browser had, over to Lightning. It listens on 127.0.0.1 only, answers only a page
 * of an extension (a web page's Origin is refused), checks Host against DNS rebinding, and needs the
 * pairing key for anything but "is anyone there". */
export class LocalApi {
  private server: Server | null = null
  /** The port in use, or null while off. */
  port: number | null = null
  private addTimes: number[] = []

  constructor(private deps: LocalApiDeps) {}

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled === (this.server !== null)) return
    if (!enabled) return this.stop()
    for (const port of API_PORTS) {
      const server = createServer((req, res) => void this.handle(req, res))
      server.on('error', () => {})
      const listening = await new Promise<boolean>((resolve) => {
        server.once('error', () => resolve(false))
        server.listen(port, '127.0.0.1', () => resolve(true))
      })
      if (listening) {
        this.server = server
        this.port = port
        log.info('app', `browser integration listening on 127.0.0.1:${port}`)
        return
      }
      server.close()
    }
    log.warn('app', 'browser integration: no free port')
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.port = null
    if (!server) return
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private send(res: ServerResponse, status: number, body: unknown, origin?: string): void {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin
      headers['Vary'] = 'Origin'
    }
    res.writeHead(status, headers).end(JSON.stringify(body))
  }

  private async authorized(req: IncomingMessage): Promise<boolean> {
    const header = req.headers.authorization ?? ''
    const given = /^Bearer (.+)$/.exec(header)?.[1]
    if (!given) return false
    return timingSafeEqual(digest(given), digest(await this.deps.token()))
  }

  private readBody(req: IncomingMessage): Promise<string | null> {
    return new Promise((resolve) => {
      let size = 0
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          resolve(null)
          req.destroy()
        } else chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', () => resolve(null))
    })
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin
    // A web page can't be told apart from the user by anything but its Origin, and the page's
    // Host, if a name was made to point here, is not ours.
    if (!LOOPBACK_HOST.test(req.headers.host ?? '')) return this.send(res, 403, { error: 'host' })
    if (origin !== undefined && !EXTENSION_ORIGIN.test(origin)) {
      return this.send(res, 403, { error: 'origin' })
    }
    if (req.method === 'OPTIONS') {
      res
        .writeHead(204, {
          'Access-Control-Allow-Origin': origin ?? '',
          'Access-Control-Allow-Headers': 'authorization, content-type',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Max-Age': '600',
          Vary: 'Origin'
        })
        .end()
      return
    }
    const path = (req.url ?? '').split('?')[0]
    if (req.method === 'GET' && path === '/v1/ping') {
      return this.send(res, 200, { app: 'Lightning', version: this.deps.version, api: 1 }, origin)
    }
    if (!(await this.authorized(req))) return this.send(res, 401, { error: 'key' }, origin)

    // A harmless call that says whether the key is right: the extension's popup uses it.
    if (req.method === 'GET' && path === '/v1/auth')
      return this.send(res, 200, { ok: true }, origin)

    if (req.method === 'POST' && path === '/v1/add') {
      const now = Date.now()
      this.addTimes = this.addTimes.filter((time) => now - time < WINDOW_MS)
      if (this.addTimes.length >= ADDS_PER_WINDOW) return this.send(res, 429, {}, origin)
      this.addTimes.push(now)

      const text = await this.readBody(req)
      let body: Record<string, unknown> | null = null
      try {
        const parsed: unknown = text === null ? null : JSON.parse(text)
        body =
          typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
      } catch {
        body = null
      }
      const url = typeof body?.url === 'string' ? body.url.trim() : ''
      if (!body || !/^(https?:\/\/[^\s]+|magnet:\?[^\s]+)$/i.test(url) || url.length > 8192) {
        return this.send(res, 400, { error: 'url' }, origin)
      }
      log.info('action', 'link from the browser', { url: redactUrl(url) })
      this.deps.onAdd(url, sanitizeExtras(body))
      return this.send(res, 200, { ok: true }, origin)
    }
    return this.send(res, 404, { error: 'not found' }, origin)
  }
}
