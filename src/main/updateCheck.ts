import { net } from 'electron'
import type { UpdateInfo } from '../shared/types'

type ReleaseInfo = Omit<UpdateInfo, 'dismissed'>

const REPO = 'alisinaee/Lightning'
export const UPDATE_PAGE_URL = 'https://github.com/alisinaee/Lightning/releases'

/** One pre-release identifier, ordered as semver orders them: numbers compare as numbers, text
 * compares as text, and a number sorts before text. */
function comparePart(a: string, b: string): number {
  const aNum = /^\d+$/.test(a)
  const bNum = /^\d+$/.test(b)
  if (aNum && bNum) return Math.sign(parseInt(a, 10) - parseInt(b, 10))
  if (aNum !== bNum) return aNum ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Compares two versions by semver precedence, returning -1, 0 or 1. Pre-release numbers compare
 * as numbers (`rc.9` < `rc.33`), and a release is newer than its own pre-releases
 * (`1.0.0` > `1.0.0-rc.33`). */
export function compareVersions(left: string, right: string): number {
  const split = (version: string): { core: number[]; pre: string[] } => {
    const [main, ...rest] = version.replace(/^v/, '').split('-')
    const pre = rest.join('-')
    return {
      core: main.split('.').map((part) => parseInt(part, 10) || 0),
      pre: pre ? pre.split('.') : []
    }
  }
  const a = split(left)
  const b = split(right)
  for (let i = 0; i < Math.max(a.core.length, b.core.length); i++) {
    const diff = (a.core[i] ?? 0) - (b.core[i] ?? 0)
    if (diff !== 0) return Math.sign(diff)
  }
  // Same core: the version without a pre-release tag is the release, so it ranks higher.
  if (a.pre.length === 0 || b.pre.length === 0) {
    return Math.sign(b.pre.length - a.pre.length)
  }
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === undefined) return -1
    if (b.pre[i] === undefined) return 1
    const diff = comparePart(a.pre[i], b.pre[i])
    if (diff !== 0) return diff
  }
  return 0
}

function isNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0
}

/** Checks the repo's latest GitHub release against the running app version. Same data source the
 * landing page's downloads list already reads, so there's no separate update feed to stand up.
 *
 * Uses the releases list rather than the `/releases/latest` endpoint: every release here ships
 * as a pre-release, and GitHub's "latest" endpoint only ever considers non-prerelease releases —
 * it 404s when there isn't one, so it would never surface an update. */
export async function checkForUpdate(
  currentVersion: string,
  strict = false
): Promise<ReleaseInfo | null> {
  try {
    const response = await net.fetch(`https://api.github.com/repos/${REPO}/releases?per_page=1`)
    if (!response.ok) {
      if (strict) throw new Error(`GitHub answered ${response.status}`)
      return null
    }
    const [data] = (await response.json()) as { tag_name?: string }[]
    if (!data?.tag_name) return null
    const version = data.tag_name.replace(/^v/, '')
    if (!isNewer(version, currentVersion)) return null
    return { version, url: UPDATE_PAGE_URL }
  } catch (error) {
    // A check the user asked for says why it failed; the startup one stays quiet.
    if (strict) throw error
    // Offline, rate-limited, or GitHub is down — silently skip the notification rather than
    // surface a startup error for a non-essential check.
    return null
  }
}
