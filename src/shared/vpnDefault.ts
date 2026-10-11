import type { AppSettings } from './types'

/** "Use VPN for downloads" is on by default now. Someone who already had settings (and so had been
 * running with it off, as it used to be) keeps it off, saved as a choice they can change; a new
 * install starts with it on. Done once, marked by `vpnDefaultMigrated`. Returns what to save, or
 * null when there is nothing to do. */
export function vpnMigration(saved: AppSettings): Partial<AppSettings> | null {
  if (saved.vpnDefaultMigrated) return null
  const hadSettings = Object.keys(saved).length > 0
  return {
    vpnDefaultMigrated: true,
    ...(hadSettings && saved.useVpn === undefined ? { useVpn: false } : {})
  }
}
