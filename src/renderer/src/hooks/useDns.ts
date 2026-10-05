import type { DnsConfig, DnsProfile } from '@shared/types'
import { useEffect } from 'react'
import { create } from 'zustand'

interface DnsStore {
  config: DnsConfig
  loaded: boolean
  set: (config: DnsConfig) => void
}

const useDnsStore = create<DnsStore>((set) => ({
  config: { profiles: [] },
  loaded: false,
  set: (config) => set({ config, loaded: true })
}))

/** What the Cloudflare, Google and other well-known DNS servers are, offered until saved. */
export const DNS_SUGGESTIONS: { name: string; servers: string[] }[] = [
  { name: 'Cloudflare', servers: ['1.1.1.1', '1.0.0.1'] },
  { name: 'Google', servers: ['8.8.8.8', '8.8.4.4'] },
  { name: 'Quad9', servers: ['9.9.9.9', '149.112.112.112'] },
  { name: 'AdGuard', servers: ['94.140.14.14', '94.140.15.15'] },
  { name: 'OpenDNS', servers: ['208.67.222.222', '208.67.220.220'] }
]

/** The saved DNS profiles, kept current: main says whenever they change. Most recently used first. */
export function useDns(): {
  profiles: DnsProfile[]
  defaultId: string | undefined
  loaded: boolean
} {
  const config = useDnsStore((store) => store.config)
  const loaded = useDnsStore((store) => store.loaded)
  const set = useDnsStore((store) => store.set)
  useEffect(() => {
    void window.lightning.getDns().then(set)
    return window.lightning.onDnsChanged(set)
  }, [set])
  const profiles = [...config.profiles].sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0))
  return { profiles, defaultId: config.defaultId, loaded }
}

/** A short name for what a download, group or the app resolves with. */
export function dnsLabel(
  id: string | null | undefined,
  profiles: DnsProfile[],
  defaultId?: string
): string {
  if (id === 'system') return 'System DNS'
  const profile = profiles.find((one) => one.id === id)
  if (profile) return profile.name
  if (id) return 'System DNS'
  const fallback = profiles.find((one) => one.id === defaultId)
  return fallback ? `Default (${fallback.name})` : 'Default (system)'
}
