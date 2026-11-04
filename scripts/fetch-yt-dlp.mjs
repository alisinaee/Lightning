// Downloads the pinned yt-dlp release (https://github.com/yt-dlp/yt-dlp, Unlicense) for one platform into
// vendor/yt-dlp/<platform>-<arch>/, checking it against the release's SHA2-256SUMS.
//   node scripts/fetch-yt-dlp.mjs                 this machine
//   node scripts/fetch-yt-dlp.mjs darwin-arm64    one target
//   node scripts/fetch-yt-dlp.mjs all             every target Lightning ships
import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const YT_DLP_VERSION = '2026.10.26'
const BASE = `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}`
const ASSETS = {
  'darwin-arm64': 'yt-dlp_macos',
  'darwin-x64': 'yt-dlp_macos',
  'win32-x64': 'yt-dlp.exe',
  'win32-arm64': 'yt-dlp_arm64.exe',
  'linux-x64': 'yt-dlp_linux',
  'linux-arm64': 'yt-dlp_linux_aarch64'
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function fetchTarget(target, checksums) {
  const asset = ASSETS[target]
  if (!asset)
    throw new Error(`No yt-dlp build for ${target}. Known: ${Object.keys(ASSETS).join(', ')}`)
  const out = join(root, 'vendor', 'yt-dlp', target)
  const isWin = target.startsWith('win32')
  const exe = join(out, isWin ? 'yt-dlp.exe' : 'yt-dlp')
  const stamp = join(out, '.version')
  if (
    existsSync(exe) &&
    existsSync(stamp) &&
    (await readFile(stamp, 'utf-8')).trim() === YT_DLP_VERSION
  ) {
    console.log(`yt-dlp ${YT_DLP_VERSION} ${target}: already there`)
    return
  }
  const expected = checksums.get(asset)
  if (!expected) throw new Error(`${asset} is not in SHA2-256SUMS`)

  console.log(`downloading ${BASE}/${asset}...`)
  const bytes = await download(`${BASE}/${asset}`)
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expected) {
    throw new Error(`${asset}: sha256 mismatch (expected ${expected}, got ${actual})`)
  }

  const tmp = join(tmpdir(), `yt-dlp-fetch-${Date.now()}-${target}`)
  await mkdir(tmp, { recursive: true })
  const tmpExe = join(tmp, isWin ? 'yt-dlp.exe' : 'yt-dlp')
  await writeFile(tmpExe, bytes)
  if (!isWin) {
    await chmod(tmpExe, 0o755)
  }

  await rm(out, { recursive: true, force: true })
  await mkdir(dirname(out), { recursive: true })
  await rename(tmp, out)
  await writeFile(stamp, YT_DLP_VERSION + '\n', 'utf-8')
  console.log(`yt-dlp ${YT_DLP_VERSION} ${target}: installed`)
}

async function readChecksums() {
  const body = (await download(`${BASE}/SHA2-256SUMS`)).toString('utf-8')
  const map = new Map()
  for (const line of body.split('\n')) {
    const match = /^([0-9a-f]{64})\s+(.+)$/i.exec(line.trim())
    if (match) map.set(match[2].trim(), match[1].toLowerCase())
  }
  return map
}

async function main() {
  const arg = process.argv[2]
  const checksums = await readChecksums()
  if (arg === 'all') {
    for (const target of Object.keys(ASSETS)) {
      await fetchTarget(target, checksums)
    }
    return
  }
  const target = arg || `${process.platform}-${process.arch}`
  await fetchTarget(target, checksums)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
