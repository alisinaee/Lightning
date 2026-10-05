import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// A build can be a separate variant that lives beside the normal app ("Plexo Custom"): its
// package.json says so (electron-builder's extraMetadata puts `plexoVariant` there). The normal
// build, and dev, have no such field.
let cached: { custom: boolean; name: string } | null = null

export function appVariant(): { custom: boolean; name: string } {
  if (cached) return cached
  let custom = false
  try {
    const meta = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as {
      plexoVariant?: unknown
    }
    custom = meta.plexoVariant === 'custom'
  } catch {
    // No readable package.json: the normal app.
  }
  cached = { custom, name: custom ? 'Plexo Custom' : 'Plexo' }
  return cached
}
