import { t } from '@shared/i18n/react'
import type { DnsConfig, DnsProfile } from '@shared/types'
import { useEffect, useMemo } from 'react'
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
    // Counts the pushes: a reply to the first read that arrives after a push is older, so dropped.
    let pushes = 0
    const stop = window.lightning.onDnsChanged((next) => {
      pushes += 1
      set(next)
    })
    const asked = pushes
    void window.lightning
      .getDns()
      .then((next) => {
        if (pushes === asked) set(next)
      })
      .catch(() => {})
    return stop
  }, [set])
  const profiles = useMemo(
    () => [...config.profiles].sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0)),
    [config.profiles]
  )
  return { profiles, defaultId: config.defaultId, loaded }
}

/** A short name for what a download, group or the app resolves with. */
export function dnsLabel(
  id: string | null | undefined,
  profiles: DnsProfile[],
  defaultId?: string
): string {
  if (id === 'system') return t('System DNS')
  if (id === 'auto') return t('Auto')
  const profile = profiles.find((one) => one.id === id)
  if (profile) return profile.name
  if (id) return t('System DNS')
  if (defaultId === 'auto') return t('Default (Auto)')
  const fallback = profiles.find((one) => one.id === defaultId)
  return fallback ? t('Default ({name})', { name: fallback.name }) : t('Default (system)')
}
