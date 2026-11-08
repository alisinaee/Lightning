import { loadSettings } from './settings'
import type { AppSettings } from '../shared/types'

type Apply = (patch: AppSettings) => Promise<void>
let apply: Apply | null = null

/** Set once the IPC handlers exist: how a saved setting is applied everywhere. */
export function setSettingsApplier(next: Apply): void {
  apply = next
}

/** Flips one switch from outside the window (the menu-bar panel's buttons). */
export async function toggleSetting(key: 'useVpn' | 'slowMode'): Promise<void> {
  if (!apply) return
  const saved = await loadSettings()
  const now = key === 'useVpn' ? (saved.useVpn ?? true) : (saved.slowMode ?? false)
  await apply({ [key]: !now })
}

/** The buttons the menu-bar panel holds, as the person arranged them there. What is saved is
 * checked again (known buttons, once each, at most six) before it is kept. */
export async function saveTrayButtons(list: unknown[]): Promise<void> {
  if (!apply) return
  const saved = await loadSettings()
  const prefs = saved.prefs ?? {}
  await apply({
    prefs: { ...prefs, statusBar: { ...(prefs.statusBar ?? {}), trayButtons: list } }
  } as AppSettings)
}
