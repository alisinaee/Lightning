/** Extensions that mean "a file to download" when a copied link ends in one. Images and plain web
 * documents are left out: copying a picture's link is rarely a wish to download it. */
const DOWNLOADABLE = new Set([
  ...['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'cab'],
  ...['iso', 'img', 'dmg', 'vhd', 'vhdx', 'qcow2'],
  ...['exe', 'msi', 'pkg', 'deb', 'rpm', 'appimage', 'apk', 'msix', 'xip', 'jar'],
  ...['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', 'm2ts'],
  ...['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'opus'],
  ...['pdf', 'epub', 'docx', 'xlsx', 'pptx'],
  'torrent'
])

/** The one link a piece of copied text is, if it is one worth offering to download: a magnet link,
 * or an http(s) link whose file name ends in a downloadable extension. Text that is more than a link
 * (a sentence, several lines) is not. */
export function downloadableLink(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 4096 || /\s/.test(trimmed)) return null
  if (/^magnet:\?xt=urn:btih:/i.test(trimmed)) return trimmed
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  let name = url.pathname.split('/').pop() ?? ''
  try {
    name = decodeURIComponent(name)
  } catch {
    // The raw name still carries the extension.
  }
  const dot = name.lastIndexOf('.')
  return dot > 0 && DOWNLOADABLE.has(name.slice(dot + 1).toLowerCase()) ? trimmed : null
}
