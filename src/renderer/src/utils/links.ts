import type { ProbeResult, RequestExtras, StartDownloadRequest } from '@shared/types'
import { acceptedLink } from './format'

/** Links checked at the same moment: enough to be quick, few enough not to hammer one host. */
export const PROBE_PARALLEL = 3

/** The links in pasted text: one per line or separated by spaces, repeats dropped. */
export function linksIn(text: string): { links: string[]; skipped: number } {
  const seen = new Set<string>()
  const links: string[] = []
  let skipped = 0
  for (const piece of text.split(/\s+/)) {
    if (!piece) continue
    const link = acceptedLink(piece)
    if (!link || seen.has(link)) {
      skipped++
      continue
    }
    seen.add(link)
    links.push(link)
  }
  return { links, skipped }
}

/** A folder name that is one folder: no separators or characters a path can't hold. */
export function folderNameOf(text: string): string {
  return text
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim()
    .replace(/^\.+$/, '')
}

/** Whether a file can be fetched over several networks at once. */
export const isSplittable = (result: ProbeResult): boolean =>
  result.supportsRanges && result.totalBytes !== null

/** The request that starts a checked link on `interfaceIds` (just the first, if the file can't
 * be split across networks). */
export function requestFor(
  result: ProbeResult,
  destinationDir: string,
  interfaceIds: string[],
  extras: RequestExtras = {}
): StartDownloadRequest {
  const supportsRanges = isSplittable(result)
  const common = {
    url: result.finalUrl,
    destinationDir,
    suggestedFileName: result.suggestedFileName,
    totalBytes: result.totalBytes ?? 0,
    supportsRanges,
    interfaceIds: supportsRanges ? interfaceIds : interfaceIds.slice(0, 1),
    etag: result.etag,
    lastModified: result.lastModified
  }
  return result.kind === 'torrent'
    ? { kind: 'torrent', ...common, infoHash: result.torrent.infoHash }
    : { kind: 'http', ...common, ...extras }
}

/** Checks the links a few at a time, telling `onResult` about each as it is known. */
export function probeLinks(
  links: string[],
  probe: (url: string) => Promise<ProbeResult>,
  onResult: (url: string, outcome: { result: ProbeResult } | { error: unknown }) => void
): void {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < links.length) {
      const url = links[next++]
      try {
        onResult(url, { result: await probe(url) })
      } catch (error) {
        onResult(url, { error })
      }
    }
  }
  for (let i = 0; i < Math.min(PROBE_PARALLEL, links.length); i++) void worker()
}
