import type { Checksum, ChecksumAlgo } from './types'

export const CHECKSUM_ALGOS: readonly ChecksumAlgo[] = ['md5', 'sha1', 'sha256', 'sha512']

/** Hex length of each digest, to tell a bare hash's algorithm. */
const HEX_LENGTH: Record<number, ChecksumAlgo> = {
  32: 'md5',
  40: 'sha1',
  64: 'sha256',
  128: 'sha512'
}

const NAMES: Record<string, ChecksumAlgo> = {
  md5: 'md5',
  sha1: 'sha1',
  'sha-1': 'sha1',
  sha256: 'sha256',
  'sha-256': 'sha256',
  sha512: 'sha512',
  'sha-512': 'sha512'
}

/** A checksum as people paste it: `sha256:abc…`, `SHA-256 abc…`, `abc… *file.iso` (what
 * sha256sum prints), or a bare hash, whose algorithm is told by its length. null when it isn't one. */
export function parseChecksum(text: string): Checksum | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const labelled = /^([A-Za-z0-9-]+)\s*[:=\s]\s*([0-9a-fA-F]+)\b/.exec(trimmed)
  if (labelled) {
    const algo = NAMES[labelled[1].toLowerCase()]
    if (algo && HEX_LENGTH[labelled[2].length] === algo) {
      return { algo, value: labelled[2].toLowerCase() }
    }
  }
  const bare = /^([0-9a-fA-F]+)(?:\s+[* ]?\S.*)?$/.exec(trimmed)
  if (bare) {
    const algo = HEX_LENGTH[bare[1].length]
    if (algo) return { algo, value: bare[1].toLowerCase() }
  }
  return null
}

/** True for a value main may trust to compare against: a known algorithm and the right number of hex digits. */
export function isChecksum(value: unknown): value is Checksum {
  if (typeof value !== 'object' || value === null) return false
  const { algo, value: digest } = value as Record<string, unknown>
  return (
    typeof algo === 'string' &&
    (CHECKSUM_ALGOS as readonly string[]).includes(algo) &&
    typeof digest === 'string' &&
    /^[0-9a-f]+$/.test(digest) &&
    HEX_LENGTH[digest.length] === algo
  )
}

export const checksumLabel = (checksum: Checksum): string => checksum.algo.toUpperCase()
