/** The mount point or drive a path lives on: when that is gone (an unplugged disk), the files on
 * it are not deleted, only out of reach. */
export function volumeRootOf(path: string): string {
  const mac = /^\/Volumes\/[^/]+/.exec(path)
  if (mac) return mac[0]
  const linux = /^\/(?:mnt\/[^/]+|media\/[^/]+\/[^/]+)/.exec(path)
  if (linux) return linux[0]
  const drive = /^[A-Za-z]:[\\/]/.exec(path)
  if (drive) return drive[0]
  return '/'
}
