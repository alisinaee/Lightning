/** How long a dialog opened by a copied link stays open when the person leaves it alone. */
export const CLIPBOARD_OFFER_MS = 20_000

/** The one link a piece of copied text is: a magnet link, or an http(s) link. Any file type counts,
 * so the extension is not checked. Text that is more than a link (a sentence, several lines) is not. */
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
  return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : null
}
