import { open, readdir, rm, rmdir, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { DownloadFile } from '../downloadFile'
import { ownedTorrentFiles } from './ownedFiles'
import { claimDestinationPath } from '../paths'

/**
 * Where a torrent downloads: in place, under its own name, as torrent clients do. `path` is its
 * folder of files (or its one file) at the destination from the start; publishing leaves it
 * there, only dropping the files not chosen.
 */
export class TorrentDestination extends DownloadFile {
  /** `path` as claimed (see create). `unwanted`: the torrent's files not chosen for download, as
   * the torrent names them, its own folder first. */
  constructor(
    path: string,
    private readonly totalBytes: number,
    private readonly unwanted: readonly string[] = [],
    private readonly owned: readonly string[] = []
  ) {
    super(path)
  }

  /** Claims `name` in `directory`, or the first free `name (N)`, for a torrent's folder or file. */
  static async create(
    directory: string,
    name: string,
    folder: boolean,
    totalBytes: number,
    unwanted: readonly string[] = [],
    owned: readonly string[] = []
  ): Promise<TorrentDestination> {
    const path = await claimDestinationPath(directory, name, folder)
    return new TorrentDestination(path, totalBytes, unwanted, owned)
  }

  /** Already in place: it drops the files not chosen, and stays where it is. */
  async publish(
    _destinationPath: string,
    _expectedBytes: number,
    beforeAttempt: (candidate: string) => Promise<void>
  ): Promise<string> {
    await this.removeUnwanted()
    await this.sync()
    await beforeAttempt(this.path)
    return this.path
  }

  /** It is what was published: nothing is left over. */
  discardLeftover(): Promise<void> {
    return Promise.resolve()
  }

  /** The files not chosen — the pieces at a chosen file's edges wrote part of them — and any
   * folder that leaves empty. Only what was chosen stays. */
  private async removeUnwanted(): Promise<void> {
    if (this.unwanted.length === 0) return
    // Under this download's name for the torrent's folder, which may be "Name (1)".
    const inPlace = (path: string): string => join(this.path, ...path.split(sep).slice(1))
    await Promise.all(this.unwanted.map((path) => rm(inPlace(path), { force: true })))
    const folders = (await readdir(this.path, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(entry.parentPath, entry.name))
      // Deepest first, so a folder emptied by removing its subfolders goes too.
      .sort((a, b) => b.length - a.length)
    for (const folder of folders) await rmdir(folder).catch(() => {}) // only empty ones go
  }

  /** Its files are sparse: once it's there, every byte of the torrent has its place. Throws, like
   * DownloadFile's, when it's gone. */
  async size(): Promise<number> {
    await stat(this.path)
    return this.totalBytes
  }

  async sync(): Promise<void> {
    if (!(await stat(this.path)).isDirectory()) return super.sync()
    for (const entry of await readdir(this.path, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      const handle = await open(join(entry.parentPath, entry.name), 'r+')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
    }
  }

  /** Remove owned partial files and empty folders, preserving unrelated files. */
  async discard(): Promise<void> {
    const info = await stat(this.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (!info) return
    if (!info.isDirectory()) {
      await rm(this.path, { force: true })
      return
    }
    if (!this.owned.length)
      throw new Error('Plexo can’t identify this torrent’s files for removal.')
    const files = this.owned.map((path) => path.split(/[\\/]/).slice(1).join(sep))
    const { targets, folders } = await ownedTorrentFiles(this.path, files)
    for (const target of targets) await rm(target, { force: true })
    for (const folder of folders) await rmdir(folder).catch(() => {})
  }
}
