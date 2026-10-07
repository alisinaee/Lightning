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
  if (id === 'auto') return 'Auto'
  const profile = profiles.find((one) => one.id === id)
  if (profile) return profile.name
  if (id) return 'System DNS'
  if (defaultId === 'auto') return 'Default (Auto)'
  const fallback = profiles.find((one) => one.id === defaultId)
  return fallback ? `Default (${fallback.name})` : 'Default (system)'
}
