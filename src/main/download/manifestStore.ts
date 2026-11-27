import { lstat } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import type {
  HttpDownloadState,
  StartDownloadRequest,
  TorrentDownloadState
} from '../../shared/types'
import type { SavedBlocks } from './savedProgress'

interface PersistedDownloadBase {
  savedAt: number
  partialPath: string
  publicationPath?: string
  publicationIdentity?: { dev: number; ino: number }
  requestPayload: StartDownloadRequest
}

export type PersistedState =
  Omit<HttpDownloadState, 'blocks' | 'streams'> | Omit<TorrentDownloadState, 'pieces' | 'peers'>

export type PersistedDownload = PersistedDownloadBase & {
  version: 7
  state: PersistedState
} & SavedBlocks

export const isNotFound = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'

/** A manifest this version writes, for the download in folder `id`. */
export function isCurrentManifest(value: unknown, id: string): value is PersistedDownload {
  const manifest = value as Partial<PersistedDownload> | null
  return manifest?.version === 7 && manifest.state?.id === id
}

/**
 * Where a saved download that can't be restored kept its partial data beside its destination:
 * only what is unmistakably Lightning's, so that a damaged manifest can never point it at a real file.
 * - A `<name>.lightning` staging file, or a torrent's `<name>.lightning/` staging folder.
 * - rc.1–rc.9 (manifest version 2) claimed the final name itself as an empty file, until the
 *   download's parts were joined into it: taken while it is still empty and the download
 *   unfinished, never once it holds anything.
 */
export async function partialLeftovers(persisted: unknown): Promise<string[]> {
  const manifest = persisted as {
    version?: unknown
    partialPath?: unknown
    state?: { status?: unknown; destinationPath?: unknown }
  } | null
  const leftovers: string[] = []
  const partial = manifest?.partialPath
  if (typeof partial === 'string' && isAbsolute(partial)) {
    if (partial.endsWith('.lightning')) leftovers.push(partial)
    else if (dirname(partial).endsWith('.lightning')) leftovers.push(dirname(partial))
  }
  const placeholder = manifest?.state?.destinationPath
  if (
    manifest?.version === 2 &&
    manifest.state?.status !== 'completed' &&
    typeof placeholder === 'string' &&
    isAbsolute(placeholder)
  ) {
    const found = await lstat(placeholder).catch(() => null)
    if (found?.isFile() && found.size === 0) leftovers.push(placeholder)
  }
  return leftovers
}
