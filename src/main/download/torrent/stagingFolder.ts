import { mkdir, open, readdir, rm, rmdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { DownloadFile } from '../downloadFile'

/**
 * A torrent's staging area: the folder `<destination>.plexo/`, where webtorrent lays the torrent
 * out as it will end up. What gets published is its one top entry — the torrent's file, or its
 * folder of files — so that entry is `path`, and publishing renames it into place exactly as
 * DownloadFile does a file: no copying, and never twice the disk space.
 */
export class StagingFolder extends DownloadFile {
  readonly folder: string

  /** `path` is the top entry inside the staging folder, as saved in the manifest. `unwanted`:
   * the torrent's files not chosen for download, relative to the folder. */
  constructor(
    path: string,
    private readonly totalBytes: number,
    private readonly unwanted: readonly string[] = []
  ) {
    super(path)
    this.folder = dirname(path)
  }

  /** Turns the `.plexo` claim reserveDestinationPath made for `destinationPath` into the folder. */
  static async create(
    destinationPath: string,
    top: string,
    totalBytes: number,
    unwanted: readonly string[] = []
  ): Promise<StagingFolder> {
    const folder = `${destinationPath}.plexo`
    await rm(folder)
    await mkdir(folder)
    return new StagingFolder(join(folder, basename(top)), totalBytes, unwanted)
  }

  async publish(
    destinationPath: string,
    expectedBytes: number,
    beforeAttempt: (candidate: string) => Promise<void>
  ): Promise<string> {
    await this.removeUnwanted()
    return super.publish(destinationPath, expectedBytes, beforeAttempt)
  }

  /** The files not chosen — the pieces at a chosen file's edges wrote part of them — and any
   * folder that leaves empty. Only what was chosen is published. */
  private async removeUnwanted(): Promise<void> {
    if (this.unwanted.length === 0) return
    await Promise.all(this.unwanted.map((path) => rm(join(this.folder, path), { force: true })))
    const folders = (await readdir(this.folder, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(entry.parentPath, entry.name))
      // Deepest first, so a folder emptied by removing its subfolders goes too.
      .sort((a, b) => b.length - a.length)
    for (const folder of folders) await rmdir(folder).catch(() => {}) // only empty ones go
  }

  /** Its files are sparse: once the folder is there, every byte of the torrent has its place.
   * Throws, like DownloadFile's, when it's gone. */
  async size(): Promise<number> {
    await stat(this.folder)
    return this.totalBytes
  }

  async sync(): Promise<void> {
    for (const entry of await readdir(this.folder, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      const handle = await open(join(entry.parentPath, entry.name), 'r+')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
    }
  }

  /** The whole folder: what is left of it once its top entry is published, or all of it. */
  async discard(): Promise<void> {
    await rm(this.folder, { recursive: true, force: true })
  }
}
