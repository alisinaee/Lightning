import { safeStorage } from 'electron'
import type { RequestAuth, RequestExtras } from '../shared/types'

/** What a sealed request keeps out of the clear: sign-in details and cookies. */
interface Secret {
  auth?: RequestAuth
  cookie?: string
}

/** A copy of `request` with its sign-in details and cookie encrypted by the OS keychain (Keychain,
 * DPAPI, libsecret) into `sealed`, for writing to disk. Where the OS has no keychain they stay as
 * they are. */
export function sealRequest<T extends RequestExtras>(request: T): T {
  if (!request.auth && !request.cookie) return request
  if (!safeStorage.isEncryptionAvailable()) return request
  const secret: Secret = { auth: request.auth, cookie: request.cookie }
  const sealed = safeStorage.encryptString(JSON.stringify(secret)).toString('base64')
  const copy: T = { ...request, sealed }
  delete copy.auth
  delete copy.cookie
  return copy
}

/** The reverse of sealRequest; a request that was never sealed, or whose secret can no longer be
 * decrypted (another user or machine), comes back without it. */
export function openRequest<T extends RequestExtras>(request: T): T {
  if (!request.sealed) return request
  const copy: T = { ...request }
  delete copy.sealed
  try {
    const secret = JSON.parse(
      safeStorage.decryptString(Buffer.from(request.sealed, 'base64'))
    ) as Secret
    if (secret.auth) copy.auth = secret.auth
    if (secret.cookie) copy.cookie = secret.cookie
  } catch {
    // The download goes on without them and fails with the server's own answer.
  }
  return copy
}
