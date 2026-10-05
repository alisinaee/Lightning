import { app } from 'electron'
import { statSync } from 'node:fs'
import { isVpn } from '../shared/networks'
import type { DownloadStatus, FinishedDownload, NetworkInterfaceInfo } from '../shared/types'
import { log, logFilePath, readLog } from './logger'
import { loadSettings } from './settings'
import { appVariant } from './variant'

function buildDate(): string {
  try {
    return statSync(__filename).mtime.toISOString()
  } catch {
    return 'unknown'
  }
}

/** One text report to hand over when something goes wrong: what is running, on what, how it is
 * set up, what the downloads are doing and the log's tail. Links never carry their query. */
export async function diagnosticReport(input: {
  networks: NetworkInterfaceInfo[]
  statuses: DownloadStatus[]
  history: FinishedDownload[]
}): Promise<string> {
  const settings = await loadSettings().catch(
    () => ({}) as Awaited<ReturnType<typeof loadSettings>>
  )
  const counts: Record<string, number> = {}
  for (const status of input.statuses) counts[status] = (counts[status] ?? 0) + 1
  counts.finished = input.history.length
  counts.finishedMissing = input.history.filter((entry) => entry.missing).length
  const all = readLog(2000)
  const errors = all.filter((line) => / ERROR /.test(line)).slice(-20)
  const { networkPreferences, ...rest } = settings
  const lines = [
    `${appVariant().name} ${app.getVersion()} (built ${buildDate()})`,
    `Generated ${new Date().toISOString()}`,
    `Platform ${process.platform} ${process.arch}, Electron ${process.versions.electron}, Node ${process.versions.node}`,
    `Packaged: ${app.isPackaged}`,
    `User data: ${app.getPath('userData')}`,
    `Log file: ${logFilePath()}`,
    '',
    '== Networks ==',
    ...(input.networks.length === 0 ? ['none detected'] : []),
    ...input.networks.map(
      (n) =>
        `${n.id}  ${n.kind}${isVpn(n) ? ' (VPN)' : ''}  ${n.displayName}  ${n.addresses.map((a) => a.address).join(', ')}`
    ),
    `VPN detected: ${input.networks.some(isVpn)}   Use VPN setting: ${settings.useVpn ?? false}`,
    '',
    '== Settings ==',
    JSON.stringify(rest, null, 2),
    `Network preferences for: ${Object.keys(networkPreferences ?? {}).join(', ') || 'none'}`,
    '',
    '== Downloads by status ==',
    JSON.stringify(counts),
    '',
    '== Last 20 errors ==',
    ...(errors.length ? errors : ['none']),
    '',
    '== Last 100 log lines ==',
    ...all.slice(-100)
  ]
  log.info('app', 'diagnostic report made')
  return lines.join('\n')
}
