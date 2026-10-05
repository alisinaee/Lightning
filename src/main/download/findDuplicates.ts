import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  findMatches,
  type DuplicateMatch,
  type DuplicateOptions,
  type KnownDownload
} from '../../shared/duplicates'
import type { GroupInfo } from '../../shared/types'

/** A file name worth checking for in a folder, guessed from a link's path. */
function nameFromLink(link: string): string | undefined {
  try {
    const url = new URL(link)
    const last = decodeURIComponent(url.pathname.split('/').pop() ?? '')
    return /\.[A-Za-z0-9]{1,8}$/.test(last) ? last : undefined
  } catch {
    return undefined
  }
}

/** Every existing copy of these links: in the download list, queued, paused, waiting in a group,
 * finished (even when its file is gone) or already a file in the folder. One implementation for
 * every way in (New download, several links, a group, links opened from outside). */
export async function findDuplicates(
  known: KnownDownload[],
  groups: GroupInfo[],
  urls: string[],
  destinationDir: string | undefined,
  options: DuplicateOptions = {}
): Promise<DuplicateMatch[]> {
  const waiting: KnownDownload[] = groups.flatMap((group) =>
    group.pending.map((item) => ({
      id: item.id,
      url: item.request.url,
      kind: 'group-waiting' as const,
      fileName: item.request.suggestedFileName,
      destinationPath: join(group.destinationDir, item.request.suggestedFileName),
      totalBytes: item.request.totalBytes
    }))
  )
  const probes = urls.map((url) => {
    const given = options.probes?.find((probe) => probe.url === url)
    return { ...given, url, fileName: given?.fileName ?? nameFromLink(url) }
  })
  let filesInFolder = new Set<string>()
  if (destinationDir) {
    filesInFolder = new Set(await readdir(destinationDir).catch(() => [] as string[]))
  }
  return findMatches(urls, [...known, ...waiting], {
    ...options,
    probes,
    destinationDir,
    filesInFolder
  })
}
