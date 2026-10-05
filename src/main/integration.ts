import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import { loadSettings, saveSettings } from './settings'

const TOKEN_FORMAT = /^[0-9a-f]{64}$/

/** The pairing key of the browser extension, made on first use and kept in the settings file. */
export async function integrationToken(): Promise<string> {
  const saved = (await loadSettings()).integrationToken
  if (saved && TOKEN_FORMAT.test(saved)) return saved
  return regenerateToken()
}

/** A new key: the extension paired with the old one is unpaired. */
export async function regenerateToken(): Promise<string> {
  const token = randomBytes(32).toString('hex')
  await saveSettings({ integrationToken: token })
  return token
}

export function isTokenFormat(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_FORMAT.test(value)
}

/** Where the extension's files are: beside the app's resources when packaged, in the project
 * folder in development. */
export function extensionFolder(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'extension')
    : join(app.getAppPath(), 'extension')
}
