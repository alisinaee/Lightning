import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { ResolvedPrefs } from '../../shared/types'
import { stripAnsi } from './tdlProgress'

// The bundled tdl program (iyear/tdl, AGPL-3.0), run as a separate executable and never linked.
// Every call names Lightning's own namespace and storage, so it never touches ~/.tdl.

const NAMESPACE = 'lightning'

export interface TdlRun {
  code: number | null
  stdout: string
  stderr: string
}

export function tdlExecutable(): string {
  const name = process.platform === 'win32' ? 'tdl.exe' : 'tdl'
  return app.isPackaged
    ? join(process.resourcesPath, 'tdl', name)
    : join(app.getAppPath(), 'vendor', 'tdl', `${process.platform}-${process.arch}`, name)
}

export function tdlDataDir(): string {
  return join(app.getPath('userData'), 'tdl')
}

export function tdlStorageDir(): string {
  return join(tdlDataDir(), 'storage')
}

export function tdlExportsDir(): string {
  return join(tdlDataDir(), 'exports')
}

/** Only name/@user-style text is kept here, never a session: tdl's own storage holds that. */
function accountFile(): string {
  return join(tdlDataDir(), 'account.json')
}

export async function readAccount(): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(accountFile(), 'utf-8')) as { account?: unknown }
    return typeof parsed.account === 'string' ? parsed.account : null
  } catch {
    return null
  }
}

export async function writeAccount(account: string): Promise<void> {
  await mkdir(tdlDataDir(), { recursive: true })
  await writeFile(accountFile(), JSON.stringify({ account }), 'utf-8')
}

/** Signing out: tdl has no logout command, so its stored session is deleted. */
export async function deleteSession(): Promise<void> {
  await rm(tdlStorageDir(), { recursive: true, force: true })
  await rm(accountFile(), { force: true })
}

/** The arguments every tdl call starts with. */
export function baseArgs(proxy?: string): string[] {
  const args = ['-n', NAMESPACE, '--storage', `type=bolt,path=${tdlStorageDir()}`]
  if (proxy) args.push('--proxy', proxy)
  return args
}

/** The manual proxy of the app's settings as a tdl --proxy value, or undefined. */
export function proxyArg(prefs: ResolvedPrefs): string | undefined {
  if (!prefs.telegramUseProxy || prefs.proxyMode !== 'manual') return undefined
  const withScheme = (value: string | undefined, scheme: string): string | undefined => {
    const text = value?.trim()
    if (!text) return undefined
    return /^[a-z0-9+.-]+:\/\//i.test(text) ? text : `${scheme}://${text}`
  }
  return (
    withScheme(prefs.proxySocks, 'socks5') ??
    withScheme(prefs.proxyHttps, 'http') ??
    withScheme(prefs.proxyHttp, 'http')
  )
}

export function tdlEnv(): NodeJS.ProcessEnv {
  return { ...process.env, NO_COLOR: '1', COLUMNS: '200', LINES: '50', TERM: 'dumb' }
}

export function spawnTdl(args: string[]): ChildProcess {
  return spawn(tdlExecutable(), args, { env: tdlEnv(), windowsHide: true })
}

// tdl's bolt storage allows one process at a time, so the short commands (login, chat ls, export)
// wait for each other here. A download in progress holds it for hours, so those commands fail
// with a message instead (see busyMessage).
let chain: Promise<unknown> = Promise.resolve()

export function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const next = chain.catch(() => {}).then(job)
  chain = next
  return next
}

/** Runs tdl to the end and collects its output. */
export function runTdl(args: string[], timeoutMs = 60_000): Promise<TdlRun> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawnTdl(args)
    } catch (error) {
      reject(error)
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (data) => (stdout += data))
    child.stderr?.on('data', (data) => (stderr += data))
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

let cachedVersion: string | null | undefined

/** The tdl version, or null when the program is missing or does not run. */
export async function tdlVersion(): Promise<string | null> {
  if (cachedVersion !== undefined) return cachedVersion
  if (!existsSync(tdlExecutable())) return null
  try {
    const { stdout } = await runTdl(['version'], 10_000)
    cachedVersion = /Version:\s*(\S+)/i.exec(stdout)?.[1] ?? null
  } catch {
    cachedVersion = null
  }
  return cachedVersion
}

/** A failed tdl call's output, cut down to the part that says why. */
export function failureReason(output: string): string {
  const text = stripAnsi(output)
  const flood = /FLOOD_WAIT[_ (]*(\d+)/i.exec(text)
  if (flood) return `Telegram asked to wait ${flood[1]} seconds (FLOOD_WAIT). Try again later.`
  if (
    /timeout|locked|resource temporarily unavailable/i.test(text) &&
    /bolt|storage|flock|lock/i.test(text)
  ) {
    return 'Telegram is busy with a download. Pause it first.'
  }
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^(WARN|at |github\.com|\S+\.go:\d+)/.test(line))
  const rpc = lines.find((line) => /rpc error|AUTH_KEY|PHONE_|SESSION_/i.test(line))
  return (
    rpc ??
    lines.filter((line) => line !== 'Error: callback:').slice(-1)[0] ??
    'tdl failed'
  ).slice(0, 300)
}
