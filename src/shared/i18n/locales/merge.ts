import type { Dict } from '../types'

const isDev = (): boolean => {
  // No import.meta here: the e2e specs load this file as CommonJS. Duplicate keys are also
  // caught by scripts/i18n-check.mjs.
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } }
  return g.process?.env?.NODE_ENV === 'development'
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
