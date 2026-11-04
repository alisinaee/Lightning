import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { ResolvedPrefs } from '../../shared/types'
import type { YoutubeStatus } from '../../shared/youtube'

export function ytDlpExecutable(): string {
  const name = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  return app.isPackaged
    ? join(process.resourcesPath, 'yt-dlp', name)
    : join(app.getAppPath(), 'vendor', 'yt-dlp', `${process.platform}-${process.arch}`, name)
}

export function ffmpegExecutable(): string | undefined {
  // 1. Packaged ffmpeg
  if (app.isPackaged) {
    const packaged = join(
      process.resourcesPath,
      'ffmpeg',
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    )
    if (existsSync(packaged)) return packaged
  }

  // 2. ffmpeg-static from node_modules
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require('ffmpeg-static')
    if (typeof ffmpegStatic === 'string' && existsSync(ffmpegStatic)) {
      return ffmpegStatic
    }
  } catch {
    // ignore
  }

  return undefined
}

export function youtubeDataDir(): string {
  return join(app.getPath('userData'), 'youtube')
}

export function proxyArg(prefs: ResolvedPrefs): string | undefined {
  if (prefs.proxyMode !== 'manual') return undefined
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

export function ytDlpEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    NO_COLOR: '1'
  }
  const ffmpeg = ffmpegExecutable()
  if (ffmpeg) {
    env.PATH = `${join(ffmpeg, '..')}:${process.env.PATH ?? ''}`
  }
  return env
}

export function spawnYtDlp(args: string[], options: SpawnOptions = {}): ChildProcess {
  const ffmpeg = ffmpegExecutable()
  const finalArgs = [...args]
  if (ffmpeg && !finalArgs.includes('--ffmpeg-location')) {
    finalArgs.unshift('--ffmpeg-location', ffmpeg)
  }
  return spawn(ytDlpExecutable(), finalArgs, {
    ...options,
    env: { ...ytDlpEnv(), ...options.env },
    windowsHide: true
  })
}

export function runYtDlp(
  args: string[],
  timeoutMs = 60_000
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawnYtDlp(args)
    } catch (error) {
      reject(error)
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => (stdout += d))
    child.stderr?.on('data', (d) => (stderr += d))
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`yt-dlp timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

let cachedStatus: YoutubeStatus | undefined

export async function getYoutubeStatus(): Promise<YoutubeStatus> {
  const exe = ytDlpExecutable()
  const exists = existsSync(exe)
  if (!exists) {
    return { binary: false, ffmpeg: false }
  }
  if (cachedStatus && cachedStatus.binary) {
    return cachedStatus
  }
  try {
    const { code, stdout } = await runYtDlp(['--version'], 10_000)
    const version = code === 0 ? stdout.trim() : undefined
    cachedStatus = {
      binary: code === 0,
      version,
      ffmpeg: ffmpegExecutable() !== undefined
    }
    return cachedStatus
  } catch {
    return { binary: false, ffmpeg: ffmpegExecutable() !== undefined }
  }
}
