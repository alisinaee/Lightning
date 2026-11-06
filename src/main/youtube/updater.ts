import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clearYoutubeStatusCache, youtubeDataDir } from './binary'
import { log } from '../logger'

// Matches the release assets scripts/fetch-yt-dlp.mjs knows how to install.
const ASSETS: Record<string, string> = {
  'darwin-arm64': 'yt-dlp_macos',
  'darwin-x64': 'yt-dlp_macos',
  'win32-x64': 'yt-dlp.exe',
  'win32-arm64': 'yt-dlp_arm64.exe',
  'linux-x64': 'yt-dlp_linux',
  'linux-arm64': 'yt-dlp_linux_aarch64'
}

const RELEASES = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 30_000

async function getBytes(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Lightning-yt-dlp-updater' }
  })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/** Fetch the newest yt-dlp release into the app data folder when it differs from the installed one.
 * The download must match the release's SHA2-256SUMS, or it is dropped. */
export async function updateYtDlp(installedVersion: string | undefined): Promise<boolean> {
  const target = `${process.platform}-${process.arch}`
  const asset = ASSETS[target]
  if (!asset) return false

  const release = JSON.parse((await getBytes(RELEASES)).toString('utf-8')) as {
    tag_name?: string
    assets?: { name: string; browser_download_url: string }[]
  }
  const tag = release.tag_name
  if (!tag || tag === installedVersion) return false

  const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${tag}`
  const sums = (await getBytes(`${base}/SHA2-256SUMS`)).toString('utf-8')
  const expected = sums
    .split('\n')
    .map((line) => /^([0-9a-f]{64})\s+(.+)$/i.exec(line.trim()))
    .find((match) => match && match[2].trim() === asset)?.[1]
    ?.toLowerCase()
  if (!expected) throw new Error(`${asset} is not listed in ${tag} SHA2-256SUMS`)

  const bytes = await getBytes(`${base}/${asset}`)
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expected) throw new Error(`${asset}: sha256 mismatch for ${tag}`)

  const isWin = process.platform === 'win32'
  const dir = join(youtubeDataDir(), 'bin')
  const exe = join(dir, isWin ? 'yt-dlp.exe' : 'yt-dlp')
  const tmp = `${exe}.download`
  await mkdir(dir, { recursive: true })
  await writeFile(tmp, bytes)
  if (!isWin) await chmod(tmp, 0o755)
  await rm(exe, { force: true })
  await rename(tmp, exe)
  await writeFile(join(dir, '.version'), `${tag}\n`, 'utf-8')
  clearYoutubeStatusCache()
  log.info('app', `yt-dlp updated to ${tag}`)
  return true
}

/** Check for a newer yt-dlp shortly after start and then once a day. Failures are logged, never thrown. */
export function startYtDlpUpdater(
  readInstalledVersion: () => Promise<string | undefined>
): () => void {
  const check = async (): Promise<void> => {
    try {
      const stamp = join(youtubeDataDir(), 'bin', '.version')
      const installed =
        (await readFile(stamp, 'utf-8').catch(() => undefined))?.trim() ||
        (await readInstalledVersion())
      await updateYtDlp(installed)
    } catch (error) {
      log.warn('app', 'yt-dlp update check failed', { error: String(error) })
    }
  }
  const first = setTimeout(() => void check(), FIRST_CHECK_DELAY_MS)
  const timer = setInterval(() => void check(), CHECK_EVERY_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
