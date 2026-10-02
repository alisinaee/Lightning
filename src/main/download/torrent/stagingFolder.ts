import { mkdir, open, readdir, rm, stat } from 'node:fs/promises'
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

  /** `path` is the top entry inside the staging folder, as saved in the manifest. */
  constructor(
    path: string,
    private readonly totalBytes: number
  ) {
    super(path)
    this.folder = dirname(path)
  }

  /** Turns the `.plexo` claim reserveDestinationPath made for `destinationPath` into the folder. */
  static async create(
    destinationPath: string,
    top: string,
    totalBytes: number
  ): Promise<StagingFolder> {
    const folder = `${destinationPath}.plexo`
    await rm(folder)
    await mkdir(folder)
    return new StagingFolder(join(folder, basename(top)), totalBytes)
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
