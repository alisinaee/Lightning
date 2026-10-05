import { execFile } from 'node:child_process'
import { app, BrowserWindow, dialog } from 'electron'
import { log } from './logger'
import { testKnobs } from './testKnobs'

export type FinishedAction = 'nothing' | 'quit' | 'sleep' | 'shutdown'

/** How long a sleep or shutdown can be called off for. */
const COUNTDOWN_SECONDS = 60

/** The OS command for each power action; execFile, with fixed arguments, so no text of ours or the
 * user's ever reaches a shell. */
function powerCommand(action: 'sleep' | 'shutdown'): [string, string[]] | null {
  switch (process.platform) {
    case 'darwin':
      return action === 'sleep'
        ? ['pmset', ['sleepnow']]
        : ['osascript', ['-e', 'tell application "System Events" to shut down']]
    case 'win32':
      return action === 'sleep'
        ? ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']]
        : ['shutdown', ['/s', '/t', '0']]
    case 'linux':
      return ['systemctl', [action === 'sleep' ? 'suspend' : 'poweroff']]
    default:
      return null
  }
}

function runPower(action: 'sleep' | 'shutdown'): void {
  const command = powerCommand(action)
  if (!command) return
  log.info('app', `queue finished: ${action}`)
  execFile(command[0], command[1], (error) => {
    if (error) log.error('app', `${action} failed`, error)
  })
}

/** Carries out what the user chose when the downloads finished. Sleep and shutdown wait
 * COUNTDOWN_SECONDS behind a dialog that cancels them: nobody comes back to a computer that
 * switched itself off for a click they didn't mean. */
export async function runFinishedAction(
  action: FinishedAction,
  window: BrowserWindow | null
): Promise<void> {
  if (action === 'nothing') return
  if (action === 'quit') {
    app.quit()
    return
  }
  const verb = action === 'sleep' ? 'go to sleep' : 'shut down'
  const abort = new AbortController()
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<'time'>((resolve) => {
    timer = setTimeout(() => resolve('time'), COUNTDOWN_SECONDS * 1000)
  })
  const options = {
    type: 'warning' as const,
    message: `The computer will ${verb} in ${COUNTDOWN_SECONDS} seconds`,
    detail: 'Downloads are finished. Cancel to keep working.',
    buttons: ['Cancel'],
    defaultId: 0,
    cancelId: 0,
    signal: abort.signal
  }
  const answered = (
    window && !window.isDestroyed()
      ? dialog.showMessageBox(window, options)
      : dialog.showMessageBox(options)
  )
    .then(() => 'answered' as const)
    .catch(() => 'answered' as const)
  const first = await Promise.race([expired, answered])
  clearTimeout(timer)
  // The dialog closes by itself where the OS lets it (not on macOS); either way the time is up.
  abort.abort()
  if (first === 'time') runPower(action)
}

/** The "downloads finished" question: what to do now. Asked in a dialog of the OS's own, since the
 * window is often hidden in the tray by then. */
export async function askWhatNext(
  window: BrowserWindow | null,
  finished: number
): Promise<FinishedAction> {
  log.info('app', `queue finished: ${finished} completed`)
  if (testKnobs.finishedAction === 'nothing') return 'nothing'
  const options = {
    type: 'info' as const,
    message: 'All downloads have finished',
    detail: `${finished} ${finished === 1 ? 'download' : 'downloads'} completed. What now?`,
    buttons: ['Do nothing', 'Quit Lightning', 'Sleep', 'Shut down'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  }
  const { response } = await (window && !window.isDestroyed() && window.isVisible()
    ? dialog.showMessageBox(window, options)
    : dialog.showMessageBox(options))
  return (['nothing', 'quit', 'sleep', 'shutdown'] as const)[response] ?? 'nothing'
}
