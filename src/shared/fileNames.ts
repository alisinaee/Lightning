// Longer than any real extension. Past this, what follows the last dot is part of a title
// ("St. Louis Cardinals vs Chicago Cubs full game replay…"), shortened along with the rest.
const MAX_EXTENSION_BYTES = 32

// A file name's component limit on the platforms Lightning runs on.
const MAX_COMPONENT_BYTES = 255

const byteLength = (text: string): number => new TextEncoder().encode(text).length

/**
 * Splits an already-sanitized `name` into the base and the extension that stays last, so that
 * `base + ext + " (9999)" + suffix` fits the 255-byte component limit. `suffix` is what claiming
 * adds to a name; `extension` is false for a folder, which has no extension to keep last.
 * A long "extension" (anything past the last dot longer than 32 bytes) is part of the name and
 * gets shortened with it, so a title with an early dot is shortened instead of refused. The base
 * is cut by whole characters.
 */
export function fitFileName(
  name: string,
  { suffix, extension }: { suffix: string; extension: boolean }
): { base: string; ext: string } {
  const dot = name.lastIndexOf('.')
  let ext = extension && dot > 0 ? name.slice(dot) : ''
  if (byteLength(ext) > MAX_EXTENSION_BYTES) ext = ''
  const maxBaseBytes = MAX_COMPONENT_BYTES - byteLength(` (9999)${suffix}`) - byteLength(ext)
  const baseCharacters = Array.from(ext ? name.slice(0, dot) : name)
  while (byteLength(baseCharacters.join('')) > maxBaseBytes) baseCharacters.pop()
  return { base: baseCharacters.join(''), ext }
}
