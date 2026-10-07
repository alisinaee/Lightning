import { randomUUID } from 'node:crypto'
import { Resolver } from 'node:dns/promises'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { app } from 'electron'
import type { DnsBest, DnsConfig, DnsProfile, IpFamily } from '../../shared/types'
import { readJson, updateJson } from '../jsonFile'
import { log } from '../logger'
import { systemResolve, type RemoteAddress, type ResolveHost } from './routes'

/** What a profile id means when a download or group asks for the system's DNS outright. */
export const SYSTEM_DNS = 'system'
/** Picks, for each site, the DNS a test found best for it (see setBest); the system's until then. */
export const AUTO_DNS = 'auto'
const MAX_BEST = 300
/** A test result is trusted this long: CDNs and ISPs change what is best. */
const BEST_TTL_MS = 14 * 24 * 60 * 60 * 1000

const MAX_PROFILES = 24
const MAX_SERVERS = 4
const ANSWER_TTL_MS = 60_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Servers as the user typed them (commas, spaces or lines apart), kept if they are IP addresses. */
export function parseServers(text: string | string[]): string[] {
  const parts = Array.isArray(text) ? text : text.split(/[\s,;]+/)
  return [...new Set(parts.map((part) => part.trim()).filter((part) => isIP(part) !== 0))].slice(
    0,
    MAX_SERVERS
  )
}

function sanitize(raw: unknown): DnsConfig {
  if (!isRecord(raw)) return { profiles: [] }
  const profiles: DnsProfile[] = []
  if (Array.isArray(raw.profiles)) {
    for (const entry of raw.profiles) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string')
        continue
      const servers = parseServers(Array.isArray(entry.servers) ? (entry.servers as string[]) : [])
      const name = entry.name.trim().slice(0, 40)
      if (servers.length === 0 || !name || profiles.some((one) => one.id === entry.id)) continue
      profiles.push({
        id: entry.id,
        name,
        servers,
        ...(typeof entry.usedAt === 'number' ? { usedAt: entry.usedAt } : {})
      })
    }
  }
  const defaultId =
    typeof raw.defaultId === 'string' &&
    (raw.defaultId === AUTO_DNS || profiles.some((one) => one.id === raw.defaultId))
      ? raw.defaultId
      : undefined
  const best: Record<string, DnsBest> = {}
  if (isRecord(raw.best)) {
    for (const [host, value] of Object.entries(raw.best).slice(0, MAX_BEST)) {
      if (!isRecord(value) || typeof value.name !== 'string' || typeof value.at !== 'number')
        continue
      const servers = parseServers(Array.isArray(value.servers) ? (value.servers as string[]) : [])
      best[host] = { name: value.name.slice(0, 40), servers, at: value.at }
    }
  }
  return {
    profiles: profiles.slice(0, MAX_PROFILES),
    ...(defaultId ? { defaultId } : {}),
    ...(Object.keys(best).length > 0 ? { best } : {})
  }
}

/** Names looked up through chosen DNS servers instead of the system's: saved by name, picked for
 * the whole app, for a group, or for one download. */
export class DnsService {
  private config: DnsConfig = { profiles: [] }
  readonly loaded: Promise<void>
  private resolvers = new Map<string, Resolver>()
  private answers = new Map<string, { at: number; addresses: RemoteAddress[] }>()

  constructor(private readonly onChange: (config: DnsConfig) => void) {
    this.loaded = readJson(this.path())
      .then((raw) => {
        this.config = sanitize(raw)
      })
      .catch(() => {})
  }

  private path(): string {
    return join(app.getPath('userData'), 'dns.json')
  }

  get(): DnsConfig {
    return this.config
  }

  private async write(next: DnsConfig): Promise<void> {
    this.config = sanitize(next)
    this.resolvers.clear()
    this.answers.clear()
    await updateJson(this.path(), () => this.config)
    this.onChange(this.config)
  }

  /** Adds a profile, or replaces the one with the same id. */
  async save(input: {
    id?: string
    name: string
    servers: string[] | string
  }): Promise<DnsProfile> {
    const servers = parseServers(input.servers)
    const name = input.name.trim().slice(0, 40)
    if (!name) throw new Error('Give the DNS a name')
    if (servers.length === 0) throw new Error('Enter at least one valid DNS server address')
    const id = input.id ?? randomUUID()
    const profile: DnsProfile = { id, name, servers, usedAt: Date.now() }
    const others = this.config.profiles.filter((one) => one.id !== id)
    await this.write({ ...this.config, profiles: [profile, ...others] })
    log.info('dns', 'saved', { name, servers })
    return profile
  }

  async remove(id: string): Promise<void> {
    const defaultId = this.config.defaultId === id ? undefined : this.config.defaultId
    await this.write({
      ...this.config,
      profiles: this.config.profiles.filter((one) => one.id !== id),
      defaultId
    })
  }

  /** The app's DNS: a profile id, or null for the system's. */
  async setDefault(id: string | null): Promise<void> {
    if (id !== null && id !== AUTO_DNS && !this.config.profiles.some((one) => one.id === id)) return
    await this.write({ ...this.config, defaultId: id ?? undefined })
    log.info('dns', 'app default', { id })
  }

  /** Marks a profile as just used, so recent ones come first. */
  async touch(id: string): Promise<void> {
    const profile = this.config.profiles.find((one) => one.id === id)
    if (!profile) return
    profile.usedAt = Date.now()
    await updateJson(this.path(), () => this.config)
    this.onChange(this.config)
  }

  /** The id a download, group or the app ends up with: what the download asked, else its group,
   * else the app's default. */
  effectiveId(...ids: (string | undefined)[]): string | undefined {
    return ids.find((id) => id !== undefined) ?? this.config.defaultId
  }

  /** The best DNS a test found for `host`, while it is still recent. */
  bestFor(host: string): DnsBest | undefined {
    const found = this.config.best?.[host]
    return found && Date.now() - found.at < BEST_TTL_MS ? found : undefined
  }

  /** Remembers what a test found best for `host`, for the Auto choice to use. */
  async setBest(host: string, entry: { name: string; servers: string[] }): Promise<void> {
    const best = { ...(this.config.best ?? {}), [host]: { ...entry, at: Date.now() } }
    // The oldest go first when there are too many.
    const kept = Object.entries(best)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_BEST)
    this.config = { ...this.config, best: Object.fromEntries(kept) }
    await updateJson(this.path(), () => this.config)
    this.onChange(this.config)
    log.info('dns', 'best for a site', { host, name: entry.name })
  }

  /** The lookup for what a download asked, else its group, else the app: or the system's. */
  resolverFor(...ids: (string | undefined)[]): ResolveHost {
    const chosen = this.effectiveId(...ids)
    if (chosen === AUTO_DNS) {
      return (host) => {
        const best = this.bestFor(host)
        if (!best || best.servers.length === 0) return systemResolve(host)
        return this.lookup({ id: `auto ${host}`, name: best.name, servers: best.servers }, host)
      }
    }
    const profile =
      chosen && chosen !== SYSTEM_DNS
        ? this.config.profiles.find((one) => one.id === chosen)
        : undefined
    if (!profile) return systemResolve
    return (host) => this.lookup(profile, host)
  }

  private resolverOf(profile: DnsProfile): Resolver {
    const key = `${profile.id} ${profile.servers.join(',')}`
    let resolver = this.resolvers.get(key)
    if (!resolver) {
      resolver = new Resolver({ timeout: 2500, tries: 2 })
      resolver.setServers(profile.servers)
      this.resolvers.set(key, resolver)
    }
    return resolver
  }

  private async lookup(profile: DnsProfile, host: string): Promise<RemoteAddress[]> {
    const key = `${profile.id} ${host}`
    const cached = this.answers.get(key)
    if (cached && Date.now() - cached.at < ANSWER_TTL_MS) return cached.addresses
    const resolver = this.resolverOf(profile)
    const [v4, v6] = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)])
    const addresses: RemoteAddress[] = [
      ...(v4.status === 'fulfilled' ? v4.value : []),
      ...(v6.status === 'fulfilled' ? v6.value : [])
    ].map((address) => ({ address, family: (address.includes(':') ? 6 : 4) as IpFamily }))
    if (addresses.length > 0) {
      this.answers.set(key, { at: Date.now(), addresses })
      return addresses
    }
    // Servers that did not answer at all (down, blocked, no route) must not take the download
    // with them: the system's lookup stands in, and the log says so. A name they answered
    // "does not exist" for stays unresolved.
    const reasons = [v4, v6].flatMap((result) =>
      result.status === 'rejected' ? [(result.reason as NodeJS.ErrnoException).code] : []
    )
    if (reasons.some((code) => code === 'ENOTFOUND' || code === 'ENODATA')) {
      throw Object.assign(new Error(`${profile.name} could not find ${host}`), {
        code: 'ENOTFOUND'
      })
    }
    log.warn('dns', `${profile.name} did not answer; using the system DNS`, { host, reasons })
    return systemResolve(host)
  }
}
