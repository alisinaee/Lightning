import { rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { app, nativeTheme } from 'electron'
import {
  DEFAULT_PREFS,
  DOWNLOADS_AT_ONCE,
  type AppPrefs,
  type AppSettings,
  type NetworkPreference,
  type NetworkPreferences,
  type ThemeSource
} from '../shared/types'
import { isProxyAddress } from '../shared/networks'
import { sanitizeSchedule } from '../shared/schedule'
import { readJson, updateJson } from './jsonFile'

function settingsPath(): string {
  return join(app.getPath('userData'), 'app-settings.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A rate or an amount of bytes: a positive whole number, or nothing. */
function byteCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined
}

/** Keeps only fields of the right type (what every reader downstream assumes, e.g.
 * NetworkEditPopover's `customName?.trim()`), entry by entry, rather than discarding every
 * network over one bad entry. An entry left with no field is dropped, so resetting a network
 * removes it from the file. */
function sanitizeNetworkPreferences(parsed: unknown): NetworkPreferences {
  if (!isRecord(parsed)) return {}

  const result: NetworkPreferences = {}
  for (const [id, value] of Object.entries(parsed)) {
    if (!isRecord(value)) continue
    const preference: NetworkPreference = {}
    if (typeof value.customName === 'string') preference.customName = value.customName
    if (typeof value.colorId === 'string') preference.colorId = value.colorId
    if (typeof value.off === 'boolean') preference.off = value.off
    preference.speedLimit = byteCount(value.speedLimit)
    preference.dataLimit = byteCount(value.dataLimit)
    if (
      value.dataLimitPeriod === 'day' ||
      value.dataLimitPeriod === 'week' ||
      value.dataLimitPeriod === 'month'
    ) {
      preference.dataLimitPeriod = value.dataLimitPeriod
    }
    for (const key of Object.keys(preference) as (keyof NetworkPreference)[]) {
      if (preference[key] === undefined) delete preference[key]
    }
    if (Object.keys(preference).length > 0) result[id] = preference
  }
  return result
}

/** Trusts nothing past "this is valid JSON" — the file may be hand-edited or from an older
 * version, and a patch comes from the renderer. Every field is checked on its own, so one bad
 * value only loses that value. An `undefined` field in a patch clears it. */
function sanitizeSettings(parsed: unknown): AppSettings {
  if (!isRecord(parsed)) return {}

  const { themeSource, dismissedUpdateVersion, destinationDir, downloadsAtOnce } = parsed
  const settings: AppSettings = {}
  // 'system' was once an option — dropping it falls back to the OS appearance (loadThemeSource).
  if (themeSource === 'light' || themeSource === 'dark') settings.themeSource = themeSource
  if (typeof dismissedUpdateVersion === 'string') {
    settings.dismissedUpdateVersion = dismissedUpdateVersion
  }
  if (typeof destinationDir === 'string' && isAbsolute(destinationDir)) {
    settings.destinationDir = destinationDir
  }
  if (
    Number.isInteger(downloadsAtOnce) &&
    (downloadsAtOnce as number) >= DOWNLOADS_AT_ONCE.min &&
    (downloadsAtOnce as number) <= DOWNLOADS_AT_ONCE.max
  ) {
    settings.downloadsAtOnce = downloadsAtOnce as number
  }
  if (parsed.networkPreferences !== undefined) {
    settings.networkPreferences = sanitizeNetworkPreferences(parsed.networkPreferences)
  }
  const speedLimit = byteCount(parsed.speedLimit)
  if (speedLimit !== undefined) settings.speedLimit = speedLimit
  const slowModeSpeed = byteCount(parsed.slowModeSpeed)
  if (slowModeSpeed !== undefined) settings.slowModeSpeed = slowModeSpeed
  if (parsed.slowMode === true) settings.slowMode = true
  if (parsed.useVpn === true) settings.useVpn = true
  if (parsed.prefs !== undefined) settings.prefs = sanitizePrefs(parsed.prefs)
  if (
    typeof parsed.integrationToken === 'string' &&
    /^[0-9a-f]{64}$/.test(parsed.integrationToken)
  ) {
    settings.integrationToken = parsed.integrationToken
  }
  if (parsed.schedule !== undefined) settings.schedule = sanitizeSchedule(parsed.schedule)
  return settings
}

const PROXY_MODES = ['system', 'direct', 'manual'] as const

function flag(value: unknown): boolean | undefined {
  return value === true ? true : value === false ? false : undefined
}

function shortText(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim().slice(0, 200) : undefined
}

/** Keeps a saved Settings page. Readers apply DEFAULT_PREFS for anything left out. */
export function sanitizePrefs(parsed: unknown): AppPrefs {
  if (!isRecord(parsed)) return {}
  const prefs: AppPrefs = {}
  const scale = parsed.uiScale
  if (typeof scale === 'number' && scale >= 0.8 && scale <= 1.4) prefs.uiScale = scale
  if (['amber', 'blue', 'teal', 'green', 'violet', 'rose'].includes(parsed.accent as string)) {
    prefs.accent = parsed.accent as AppPrefs['accent']
  }
  for (const key of [
    'notifyAdded',
    'notifyCompleted',
    'notifyFailed',
    'notifyWhenInactive',
    'preventSleep',
    'closeToBackground',
    'hideDock',
    'openAtLogin',
    'watchClipboard',
    'askWhenFinished',
    'browserIntegration',
    'showLogs',
    'showDebug'
  ] as const) {
    const value = flag(parsed[key])
    if (value !== undefined) prefs[key] = value
  }
  if ((PROXY_MODES as readonly string[]).includes(parsed.proxyMode as string)) {
    prefs.proxyMode = parsed.proxyMode as AppPrefs['proxyMode']
  }
  for (const key of ['proxyHttp', 'proxyHttps', 'proxyFtp', 'proxySocks'] as const) {
    // Kept only if it is a proxy address: the text goes into Chromium's proxy rules.
    const value = shortText(parsed[key])
    if (value !== undefined && (value === '' || isProxyAddress(value))) prefs[key] = value
  }
  return prefs
}

/** Saved prefs over the defaults, so a missing field is the default. */
export function prefsOf(settings: AppSettings): Required<AppPrefs> {
  return { ...DEFAULT_PREFS, ...sanitizePrefs(settings.prefs) }
}

export async function loadSettings(): Promise<AppSettings> {
  // Reading can fall back to defaults; only a save must not act on a failed read.
  try {
    return sanitizeSettings(await readJson(settingsPath()))
  } catch {
    return {}
  }
}

/** Merges `patch` over what's saved. */
export function saveSettings(patch: unknown): Promise<void> {
  return updateJson(settingsPath(), (current) =>
    sanitizeSettings({ ...sanitizeSettings(current), ...(isRecord(patch) ? patch : {}) })
  )
}

export async function loadThemeSource(): Promise<ThemeSource> {
  const { themeSource } = await loadSettings()
  // First run — follow whatever the OS appearance is right now rather than a fixed theme.
  return themeSource ?? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
}

/** Network names/colors lived in their own network-preferences.json up to 1.0.0-rc.8. Folds
 * that file into app-settings.json once, then deletes it (a corrupt one is just deleted). */
export async function migrateLegacyNetworkPreferences(): Promise<void> {
  const legacyPath = join(app.getPath('userData'), 'network-preferences.json')
  const legacy = await readJson(legacyPath)
  if (legacy !== undefined) {
    await updateJson(settingsPath(), (current) => {
      const settings = sanitizeSettings(current)
      return settings.networkPreferences
        ? settings
        : { ...settings, networkPreferences: sanitizeNetworkPreferences(legacy) }
    })
  }
  await rm(legacyPath, { force: true })
}
