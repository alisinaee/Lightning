// Downloads the pinned tdl release (https://github.com/iyear/tdl, AGPL-3.0) for one platform into
// vendor/tdl/<platform>-<arch>/, checking it against the release's tdl_checksums.txt.
//   node scripts/fetch-tdl.mjs                 this machine
//   node scripts/fetch-tdl.mjs darwin-arm64    one target
//   node scripts/fetch-tdl.mjs all             every target Lightning ships
import { createHash } from 'node:crypto'
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export const TDL_VERSION = 'v0.20.4'
const BASE = `https://github.com/iyear/tdl/releases/download/${TDL_VERSION}`
const ASSETS = {
  'darwin-arm64': 'tdl_MacOS_arm64.tar.gz',
  'darwin-x64': 'tdl_MacOS_64bit.tar.gz',
  'win32-x64': 'tdl_Windows_64bit.zip',
  'win32-arm64': 'tdl_Windows_arm64.zip',
  'linux-x64': 'tdl_Linux_64bit.tar.gz',
  'linux-arm64': 'tdl_Linux_arm64.tar.gz'
}
// electron-builder's ${os} is mac|win|linux; the folders are named by Node's platform, so
// electron-builder.yml maps them with one extraResources entry per OS.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function fetchTarget(target, checksums) {
  const asset = ASSETS[target]
  if (!asset)
    throw new Error(`No tdl build for ${target}. Known: ${Object.keys(ASSETS).join(', ')}`)
  const out = join(root, 'vendor', 'tdl', target)
  const exe = join(out, target.startsWith('win32') ? 'tdl.exe' : 'tdl')
  const stamp = join(out, '.version')
  if (
    existsSync(exe) &&
    existsSync(stamp) &&
    (await readFile(stamp, 'utf-8')).trim() === TDL_VERSION
  ) {
    console.log(`tdl ${TDL_VERSION} ${target}: already there`)
    return
  }
  const expected = checksums.get(asset)
  if (!expected) throw new Error(`${asset} is not in tdl_checksums.txt`)
  console.log(`tdl ${TDL_VERSION} ${target}: downloading ${asset}`)
  const data = await download(`${BASE}/${asset}`)
  const actual = createHash('sha256').update(data).digest('hex')
  if (actual !== expected) throw new Error(`${asset}: sha256 ${actual} does not match ${expected}`)

  const work = join(tmpdir(), `lightning-tdl-${process.pid}-${target}`)
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  const archive = join(work, asset)
  await writeFile(archive, data)
  // bsdtar (macOS, Windows 10+) reads both formats; GNU tar on Linux reads the tarballs.
  execFileSync('tar', ['-xf', archive, '-C', work], { stdio: 'inherit' })
  const names = await readdir(work)
  const binary = names.find((n) => n === 'tdl' || n === 'tdl.exe')
  if (!binary) throw new Error(`${asset} held no tdl program (${names.join(', ')})`)

  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  await rename(join(work, binary), exe).catch(async () => {
    await copyFile(join(work, binary), exe)
  })
  if (!target.startsWith('win32')) await chmod(exe, 0o755)
  const license = names.find((n) => /^license/i.test(n))
  if (license) await copyFile(join(work, license), join(out, 'LICENSE')).catch(() => {})
  await writeFile(stamp, TDL_VERSION + '\n')
  await rm(work, { recursive: true, force: true })
  console.log(`tdl ${TDL_VERSION} ${target}: ready at ${exe}`)
}

async function main() {
  const arg = process.argv[2]
  const here = `${process.platform}-${process.arch}`
  const targets = arg === 'all' ? Object.keys(ASSETS) : [arg ?? here]
  const text = (await download(`${BASE}/tdl_checksums.txt`)).toString('utf-8')
  const checksums = new Map()
  for (const line of text.split('\n')) {
    const [hash, name] = line.trim().split(/\s+/)
    if (hash && name) checksums.set(name, hash)
  }
  for (const target of targets) await fetchTarget(target, checksums)
}

main().catch((error) => {
  console.error(error.message ?? error)
  process.exit(1)
})
