import { normalizeUrl } from './urlTools'

/** Where an existing copy of a link was found. */
export type DuplicateKind =
  'downloading' | 'queued' | 'paused' | 'group-waiting' | 'history' | 'file-on-disk'

export interface DuplicateMatch {
  /** The link that was asked about, as given. */
  url: string
  kind: DuplicateKind
  /** Why it matched. */
  reason: 'url' | 'final-url' | 'file-name'
  /** The download or group item it matched, when there is one. */
  id?: string
  fileName: string
  /** Where the file is, or was meant to go. */
  path?: string
  folder?: string
  percent?: number
  completedAt?: number
  /** A finished download whose file has gone, or an unfinished one. */
  missing?: boolean
}

/** What the matcher knows of one existing download, finished or not. */
export interface KnownDownload {
  id: string
  url: string
  kind: 'downloading' | 'queued' | 'paused' | 'group-waiting' | 'history'
  fileName: string
  destinationPath: string
  totalBytes: number
  percent?: number
  completedAt?: number
  missing?: boolean
}

/** What was learned about a link by probing it. */
export interface DuplicateProbe {
  url: string
  finalUrl?: string
  fileName?: string
  totalBytes?: number | null
}

export interface DuplicateOptions {
  probes?: DuplicateProbe[]
  /** Downloads that don't count (one being replaced). */
  ignoreIds?: string[]
}

const folderOf = (path: string): string => path.replace(/[\\/][^\\/]*$/, '')
const lastPart = (path: string): string => path.split(/[\\/]/).pop() ?? path

/**
 * The existing downloads each link repeats. A link matches by its normalised address (also after
 * redirects, from a probe), or by file name: the same name and size among the downloads, or the
 * same name already in the folder (`filesInFolder`).
 */
export function findMatches(
  urls: string[],
  known: KnownDownload[],
  options: DuplicateOptions & { destinationDir?: string; filesInFolder?: Set<string> } = {}
): DuplicateMatch[] {
  const ignored = new Set(options.ignoreIds ?? [])
  const pool = known.filter((entry) => !ignored.has(entry.id))
  const matches: DuplicateMatch[] = []
  for (const url of urls) {
    const probe = options.probes?.find((entry) => entry.url === url)
    const wanted = new Set([normalizeUrl(url)])
    if (probe?.finalUrl) wanted.add(normalizeUrl(probe.finalUrl))
    const seen = new Set<string>()
    const add = (match: DuplicateMatch): void => {
      const key = `${match.id ?? match.path}`
      if (seen.has(key)) return
      seen.add(key)
      matches.push(match)
    }
    for (const entry of pool) {
      const entryUrl = normalizeUrl(entry.url)
      let reason: DuplicateMatch['reason'] | null = null
      if (entryUrl === normalizeUrl(url)) reason = 'url'
      else if (wanted.has(entryUrl)) reason = 'final-url'
      else if (
        probe?.fileName &&
        lastPart(entry.destinationPath) === probe.fileName &&
        probe.totalBytes &&
        entry.totalBytes === probe.totalBytes
      ) {
        reason = 'file-name'
      }
      if (!reason) continue
      add({
        url,
        kind: entry.kind,
        reason,
        id: entry.id,
        fileName: entry.fileName,
        path: entry.destinationPath,
        folder: folderOf(entry.destinationPath),
        percent: entry.percent,
        completedAt: entry.completedAt,
        missing: entry.missing
      })
    }
    if (
      probe?.fileName &&
      options.destinationDir &&
      options.filesInFolder?.has(probe.fileName) &&
      matches.every((match) => match.url !== url)
    ) {
      add({
        url,
        kind: 'file-on-disk',
        reason: 'file-name',
        fileName: probe.fileName,
        path: `${options.destinationDir.replace(/[\\/]+$/, '')}/${probe.fileName}`,
        folder: options.destinationDir
      })
    }
  }
  return matches
}
