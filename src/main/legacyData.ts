import { cpSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app } from 'electron'

/** The app was once called Plexo (and "Plexo Custom" as a build beside the original). Its
 * settings, groups, downloads and history live in a folder of that name; the first launch under
 * the new name copies them over, so nothing started is lost. The old folder is left untouched. */
export function migrateLegacyUserData(): void {
  try {
    const target = app.getPath('userData')
    const hasData = (dir: string): boolean =>
      existsSync(dir) &&
      ['app-settings.json', 'groups.json', 'history.json', 'downloads'].some((name) =>
        existsSync(join(dir, name))
      )
    if (hasData(target)) return
    for (const name of ['Plexo Custom', 'Plexo']) {
      const source = join(app.getPath('appData'), name)
      if (!hasData(source)) continue
      cpSync(source, target, {
        recursive: true,
        filter: (path) => !basename(path).startsWith('Singleton') && basename(path) !== 'Cache'
      })
      return
    }
  } catch {
    // Nothing to bring over, or it could not be read: start fresh rather than fail to launch.
  }
}
