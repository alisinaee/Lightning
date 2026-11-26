// Lightning's "links near this" helper, on every web page. It remembers the element the person last
// right-clicked and, when the extension asks, returns the links of the group that element belongs to
// (for example the list a "copy links" button sits on). It reads nothing until asked.
;(() => {
  if (window.__lightningContext) return
  window.__lightningContext = true

  const api = typeof browser !== 'undefined' ? browser : chrome
  let lastTarget = null

  document.addEventListener(
    'contextmenu',
    (event) => {
      lastTarget = event.target instanceof Element ? event.target : null
    },
    true
  )

  function hrefsIn(root) {
    const found = new Set()
    for (const anchor of root.querySelectorAll('a[href]')) {
      try {
        const url = new URL(anchor.getAttribute('href'), document.baseURI).href
        if (/^https?:/i.test(url)) found.add(url)
      } catch {
        // Not an address.
      }
      if (found.size >= 2000) break
    }
    return [...found]
  }

  /** The links of the nearest group around the element that holds at least two of them. */
  function linksNear(element) {
    if (!element) return []
    // A link itself: its own address is the only one wanted.
    if (element.tagName === 'A' && element.getAttribute('href')) {
      try {
        const url = new URL(element.getAttribute('href'), document.baseURI).href
        return /^https?:/i.test(url) ? [url] : []
      } catch {
        return []
      }
    }
    let node = element
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      if (node === document.body || node === document.documentElement) break
      const found = hrefsIn(node)
      if (found.length >= 2) return found
    }
    return []
  }

  /** On YouTube, the video right-clicked: the hover preview's or the card's link, else the page's own. */
  function videoNear(element) {
    if (!element) return null
    // The player itself; the preview over a card and the mini player show another page's video.
    if (
      element.closest('#movie_player, ytd-player, ytd-shorts') &&
      !element.closest('ytd-video-preview, ytd-miniplayer')
    )
      return location.href
    let node = element
    for (let depth = 0; node && depth < 12 && node !== document.body; depth += 1) {
      const link = node.matches?.('a[href]')
        ? node
        : node.querySelector?.('a[href*="/watch?v="], a[href*="/shorts/"]')
      const href = link?.getAttribute('href') || ''
      if (/\/watch\?|\/shorts\//.test(href)) return new URL(href, document.baseURI).href
      node = node.parentElement
    }
    return null
  }

  api.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'video-near') {
      respond({ url: videoNear(lastTarget) })
      return false
    }
    if (message?.type === 'links-near') {
      respond({ links: linksNear(lastTarget) })
      return false
    }
    return false
  })
})()
