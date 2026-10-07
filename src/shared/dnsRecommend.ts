/** One DNS as the test saw it for a host: what it answered, and how that server performed. */
export interface DnsTestEntry {
  /** 'System DNS' or the name of a saved or well-known DNS. */
  name: string
  /** Empty for the system's own. */
  servers: string[]
  /** How long the answer took; null if it gave none. */
  lookupMs: number | null
  ip: string | null
  /** Time to the first byte of a ranged request to that IP. */
  connectMs: number | null
  /** Measured over a small ranged download from that IP; null when too little arrived. */
  bytesPerSec: number | null
  error?: string
}

export interface DnsRecommendation {
  /** `better`: another DNS is clearly faster. `keep`: the current one is as good. `same`: every
   * DNS leads to one server, so none can matter. `none`: nothing could be measured. */
  kind: 'better' | 'keep' | 'same' | 'none'
  /** The DNS to use, for `better`. */
  name: string | null
  servers: string[]
  /** How much faster, as a fraction (0.4 is 40% faster); null if unknown. */
  gain: number | null
  text: string
}

export interface DnsTestResult {
  host: string
  entries: DnsTestEntry[]
  recommendation: DnsRecommendation
}

export const SYSTEM_NAME = 'System DNS'
/** The least improvement worth changing a setting for. */
export const MIN_GAIN = 0.25
/** And not a gain that is only large next to a tiny number: this much more per second (a link
 * throttled to a trickle shows big percentages that are only noise), or this many milliseconds
 * quicker to connect. */
export const MIN_SPEED_GAIN = 100 * 1024
export const MIN_CONNECT_GAIN_MS = 40

const usable = (entry: DnsTestEntry): boolean =>
  entry.ip !== null && !entry.error && (entry.bytesPerSec !== null || entry.connectMs !== null)

/** Which DNS to suggest for a host, from what each one measured. Speed decides when every usable
 * DNS has a measured speed; otherwise how quickly its server answered does. A DNS that leads to
 * the same IP as a better one is as good as it, so the one needing no setup (the system's), or the
 * quickest to answer, stands for them. */
export function recommend(entries: DnsTestEntry[], current = SYSTEM_NAME): DnsRecommendation {
  const ok = entries.filter(usable)
  if (ok.length === 0) {
    return {
      kind: 'none',
      name: null,
      servers: [],
      gain: null,
      text: 'No DNS gave a server that could be measured.'
    }
  }
  if (new Set(ok.map((entry) => entry.ip)).size === 1) {
    return {
      kind: 'same',
      name: null,
      servers: [],
      gain: null,
      text: 'Every DNS leads to the same server for this site, so DNS will not change its speed.'
    }
  }
  const bySpeed = ok.every((entry) => entry.bytesPerSec !== null)
  // Higher is better for speed, so connect time is turned upside down to share one scale.
  const score = (entry: DnsTestEntry): number =>
    bySpeed ? entry.bytesPerSec! : 1000 / Math.max(1, entry.connectMs!)
  const top = ok.reduce((best, entry) => (score(entry) > score(best) ? entry : best))
  const sameServer = ok.filter((entry) => entry.ip === top.ip)
  const chosen =
    sameServer.find((entry) => entry.name === current) ??
    sameServer.find((entry) => entry.name === SYSTEM_NAME) ??
    sameServer.reduce((quickest, entry) =>
      (entry.lookupMs ?? Infinity) < (quickest.lookupMs ?? Infinity) ? entry : quickest
    )
  const baseline = ok.find((entry) => entry.name === current)
  const gain = baseline ? score(top) / score(baseline) - 1 : null
  if (chosen.name === current || (baseline && baseline.ip === top.ip)) {
    return {
      kind: 'keep',
      name: current,
      servers: baseline?.servers ?? [],
      gain: 0,
      text: `${current} already gives the best server found.`
    }
  }
  if (gain !== null && gain < MIN_GAIN) {
    return {
      kind: 'keep',
      name: current,
      servers: baseline?.servers ?? [],
      gain,
      text: `${current} is within ${Math.round(MIN_GAIN * 100)}% of the best, so it is fine.`
    }
  }
  if (baseline) {
    const small = bySpeed
      ? top.bytesPerSec! - baseline.bytesPerSec! < MIN_SPEED_GAIN
      : baseline.connectMs! - top.connectMs! < MIN_CONNECT_GAIN_MS
    if (small) {
      return {
        kind: 'keep',
        name: current,
        servers: baseline.servers,
        gain,
        text: `The best server is only slightly faster in absolute terms, so ${current} is fine.`
      }
    }
  }
  const how = bySpeed ? 'faster' : 'quicker to connect to'
  return {
    kind: 'better',
    name: chosen.name,
    servers: chosen.servers,
    gain,
    text:
      gain === null
        ? `${chosen.name} gives the ${bySpeed ? 'fastest' : 'quickest'} server for this site.`
        : `${chosen.name} is about ${Math.round(gain * 100)}% ${how} for this site.`
  }
}
