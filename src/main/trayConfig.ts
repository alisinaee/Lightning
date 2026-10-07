import { DEFAULT_STATUS_BAR, type NetworkPreferences, type StatusBarPrefs } from '../shared/types'

/** What the menu-bar icon's menu and panel show: Settings → Status bar, and the names and colours
 * the person gave their networks. Read by both, changed from settings. */
export interface TrayConfig {
  prefs: StatusBarPrefs
  names: Record<string, string>
  networkPreferences: NetworkPreferences
  accent: string
}

let config: TrayConfig = {
  prefs: DEFAULT_STATUS_BAR,
  names: {},
  networkPreferences: {},
  accent: 'amber'
}
const listeners = new Set<() => void>()

export const getTrayConfig = (): TrayConfig => config

export function setTrayConfig(
  prefs: StatusBarPrefs,
  networkPreferences: NetworkPreferences | undefined,
  accent: string
): void {
  const names: Record<string, string> = {}
  for (const [id, preference] of Object.entries(networkPreferences ?? {})) {
    if (preference.customName) names[id] = preference.customName
  }
  config = { prefs, names, networkPreferences: networkPreferences ?? {}, accent }
  for (const listener of listeners) listener()
}

/** Told whenever the choices change; returns how to stop. */
export function onTrayConfig(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
