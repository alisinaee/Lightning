import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type { ChecksumAlgo } from '../../shared/types'

/** The hex digest of a file, read in a stream so a large one never sits in memory. */
export function hashFile(path: string, algo: ChecksumAlgo, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algo)
    const stream = createReadStream(path, { highWaterMark: 1024 * 1024, signal })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}
