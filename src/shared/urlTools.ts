/** A link as it is compared for duplicates: no `#fragment`, a lowercase scheme and host, no
 * default port. The path and query stay exact. Anything that isn't a URL (a magnet link, a
 * .torrent path) is only trimmed. */
export function normalizeUrl(link: string): string {
  const trimmed = link.trim()
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return trimmed.replace(/#.*$/, '')
    url.hash = ''
    return url.href
  } catch {
    return trimmed
  }
}

/** A link made safe to write to a log: no sign-in details and no query string (they often carry
 * tokens). A magnet link keeps only its info hash. */
export function redactUrl(link: string): string {
  const trimmed = link.trim()
  if (/^magnet:/i.test(trimmed)) {
    const hash = /xt=urn:btih:([^&]+)/i.exec(trimmed)?.[1]
    return hash ? `magnet:?xt=urn:btih:${hash}` : 'magnet:?…'
  }
  try {
    const url = new URL(trimmed)
    url.username = ''
    url.password = ''
    url.hash = ''
    const hadQuery = url.search !== ''
    url.search = ''
    return url.href + (hadQuery ? '?…' : '')
  } catch {
    return trimmed.replace(/\/\/[^/@\s]*@/, '//').replace(/[?#].*$/, '')
  }
}

/** Every http(s) link inside a piece of text (an error message, say) made safe to log. */
export function redactUrlsIn(text: string): string {
  return text.replace(/(?:https?|magnet):[^\s"'<>)]+/gi, (match) => redactUrl(match))
}
