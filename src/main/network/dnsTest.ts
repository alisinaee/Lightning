import { Resolver } from 'node:dns/promises'
import { isIP } from 'node:net'
import { buildHeaders } from '../../shared/requestHeaders'
import {
  recommend,
  SYSTEM_NAME,
  type DnsTestEntry,
  type DnsTestResult
} from '../../shared/dnsRecommend'
import type { IpFamily, NetworkInterfaceInfo, RequestExtras } from '../../shared/types'
import { StreamConnection, systemResolve } from './routes'

/** Enough of the file to tell how fast a server sends it, little enough to cost almost nothing. */
const SAMPLE_BYTES = 1024 * 1024
/** A sample ends after this long, however little arrived: a slow server is not worth waiting for. */
const SAMPLE_MS = 4000
const LOOKUP_TIMEOUT_MS = 2500
const MAX_SERVERS = 8
/** Under this a sample says too little about speed to be used as one. */
const MIN_SAMPLE_BYTES = 256 * 1024

export interface DnsCandidate {
  name: string
  /** Empty: the system's own DNS. */
  servers: string[]
}

async function lookup(
  candidate: DnsCandidate,
  host: string
): Promise<{ ip: string | null; ms: number | null; error?: string }> {
  const started = Date.now()
  try {
    if (candidate.servers.length === 0) {
      const found = (await systemResolve(host)).find((one) => one.family === 4)
      if (!found) return { ip: null, ms: null, error: 'No IPv4 address' }
      return { ip: found.address, ms: Date.now() - started }
    }
    const resolver = new Resolver({ timeout: LOOKUP_TIMEOUT_MS, tries: 1 })
    resolver.setServers(candidate.servers)
    const [first] = await resolver.resolve4(host)
    if (!first) return { ip: null, ms: null, error: 'No answer' }
    return { ip: first, ms: Date.now() - started }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return {
      ip: null,
      ms: null,
      error: code === 'ETIMEOUT' ? 'No answer in time' : (code ?? 'Failed')
    }
  }
}

/** How a server at `ip` serves `target`: how soon it answers, and how fast it sends a sample. The
 * request is the real one (its link, its headers), sent to that IP on the given network. */
async function measure(
  ip: string,
  target: URL,
  network: NetworkInterfaceInfo,
  headers: Record<string, string>
): Promise<{ connectMs: number | null; bytesPerSec: number | null; error?: string }> {
  const connection = new StreamConnection(() => network, {
    timeoutMs: SAMPLE_MS + 2000,
    resolveHost: async () => [{ address: ip, family: 4 as IpFamily }]
  })
  const abort = new AbortController()
  try {
    const sent = Date.now()
    const { res } = await connection.request(
      target,
      { ...headers, Range: `bytes=0-${SAMPLE_BYTES - 1}` },
      abort.signal
    )
    const connectMs = Date.now() - sent
    if ((res.statusCode ?? 0) >= 400) {
      res.destroy()
      return { connectMs: null, bytesPerSec: null, error: `Status ${res.statusCode}` }
    }
    const began = Date.now()
    let bytes = 0
    // Whether the response finished by itself: a small file says little about speed, but a
    // sample cut short by the time limit says how slow the server is.
    let finished = false
    await new Promise<void>((resolve) => {
      const stop = (): void => {
        clearTimeout(timer)
        res.destroy()
        resolve()
      }
      const timer = setTimeout(stop, SAMPLE_MS)
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes >= SAMPLE_BYTES) stop()
      })
      res.on('end', () => {
        finished = true
        stop()
      })
      res.on('close', stop)
      res.on('error', stop)
    })
    const seconds = Math.max(0.001, (Date.now() - began) / 1000)
    return {
      connectMs,
      bytesPerSec: !finished || bytes >= MIN_SAMPLE_BYTES ? Math.round(bytes / seconds) : null
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed'
    // A DNS that sends the name to some other server fails the site's own certificate. It is
    // refused, and said plainly: that server is not the site.
    const untrusted = /certificate|CERT_|altnames|self.signed/i.test(message)
    return {
      connectMs: null,
      bytesPerSec: null,
      error: untrusted
        ? 'Untrusted certificate: this DNS leads to a different server'
        : message.slice(0, 80)
    }
  } finally {
    abort.abort()
    connection.close()
  }
}

/** Looks `url`'s host up with every candidate DNS, then measures each distinct server they lead to
 * (one sample each, one at a time so they do not compete), and says which DNS to use. */
export async function testDnsForUrl(
  url: string,
  candidates: DnsCandidate[],
  network: NetworkInterfaceInfo | undefined,
  extras?: RequestExtras,
  current = SYSTEM_NAME
): Promise<DnsTestResult> {
  const target = new URL(url)
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('Only links to files on the web can be tested')
  }
  if (!network) throw new Error('No network is connected to test with')
  const host = target.hostname.replace(/^\[|\]$/g, '')
  const literal = isIP(host) === 4
  const found = await Promise.all(
    candidates.map((candidate) =>
      literal ? Promise.resolve({ ip: host, ms: 0 }) : lookup(candidate, host)
    )
  )
  const ips = [...new Set(found.flatMap((one) => (one.ip ? [one.ip] : [])))].slice(0, MAX_SERVERS)
  const headers = buildHeaders(extras)
  const measured = new Map<string, Awaited<ReturnType<typeof measure>>>()
  for (const ip of ips) measured.set(ip, await measure(ip, target, network, headers))

  const entries: DnsTestEntry[] = candidates.map((candidate, index) => {
    const answer = found[index]
    const result = answer.ip ? measured.get(answer.ip) : undefined
    return {
      name: candidate.name,
      servers: candidate.servers,
      lookupMs: answer.ms,
      ip: answer.ip,
      connectMs: result?.connectMs ?? null,
      bytesPerSec: result?.bytesPerSec ?? null,
      error: 'error' in answer && answer.error ? answer.error : result?.error
    }
  })
  return { host, entries, recommendation: recommend(entries, current) }
}
