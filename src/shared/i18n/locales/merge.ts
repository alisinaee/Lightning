import type { Dict } from '../types'

const isDev = (): boolean => {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } }
  const meta = import.meta as ImportMeta & { env?: { DEV?: boolean } }
  return g.process?.env?.NODE_ENV === 'development' || meta.env?.DEV === true
}

/** Merge per-area partials; in dev, warn when a key appears twice with different values. */
export function mergeDicts(lang: string, parts: Record<string, Dict>): Dict {
  const out: Dict = {}
  const owner: Record<string, string> = {}
  const warn = isDev()
  for (const [area, dict] of Object.entries(parts)) {
    for (const [key, val] of Object.entries(dict)) {
      if (warn && key in out && JSON.stringify(out[key]) !== JSON.stringify(val)) {
        console.warn(
          `[i18n:${lang}] duplicate key "${key}" in "${area}" conflicts with "${owner[key]}"`
        )
      }
      out[key] = val
      owner[key] = area
    }
  }
  return out
}
