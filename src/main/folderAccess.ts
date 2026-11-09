import { t } from '../shared/i18n'
import { app, dialog, shell, type BrowserWindow } from 'electron'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getDefaultDownloadsDir } from './download/paths'
import { loadSettings } from './settings'
import { readJson, updateJson } from './jsonFile'
import { log } from './logger'

const PRIVACY_FILES_AND_FOLDERS =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders'

/**
 * On macOS, a folder Lightning saves to can be blocked by the system's privacy protection. Listing
 * the folder is what makes macOS ask the person; if they said no before, the listing fails and
 * this dialog points them to the setting where they can allow it.
 */
export async function askForFolderAccess(window: BrowserWindow | null): Promise<void> {
  if (process.platform !== 'darwin') return
  const settings = await loadSettings().catch(() => null)
  const folder = settings?.destinationDir ?? getDefaultDownloadsDir()
  try {
    await readdir(folder)
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EPERM' && code !== 'EACCES') return
    log.info('app', `no access to ${folder} (${code}); asking the person`)
  }
  // Asked once, not on every launch: after that the person allows it in System Settings themselves.
  const markerPath = join(app.getPath('userData'), 'folder-access.json')
  if (
    await readJson(markerPath).then(
      (value) => (value as { asked?: boolean })?.asked === true,
      () => false
    )
  )
    return
  await updateJson(markerPath, () => ({ asked: true })).catch(() => {})
  const options = {
    type: 'warning' as const,
    message: t('Lightning needs access to your folder'),
    detail: t(
      "Lightning can't save to {folder} until you allow it. Turn on Lightning under Files and Folders in System Settings.",
      { folder }
    ),
    buttons: [t('Open System Settings'), t('Later')],
    defaultId: 0,
    cancelId: 1
  }
  const { response } = await (window && !window.isDestroyed()
    ? dialog.showMessageBox(window, options)
    : dialog.showMessageBox(options))
  if (response === 0) await shell.openExternal(PRIVACY_FILES_AND_FOLDERS)
}
