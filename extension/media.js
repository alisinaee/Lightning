// Lightning's video finder: pure functions that decide, from what a page's responses say, whether an
// address is a video worth offering. No browser API is used here, so the same file loads in a Chromium
// service worker (importScripts), a Firefox background script (the manifest's scripts list) and a node
// check (module.exports).
;(function (root) {
  /** Pieces of a video that are never offered on their own. */
  const SEGMENT_EXT = /\.(ts|m4s|m4f|cmfv|cmfa)$/i
  const SEGMENT_TYPES = new Set(['video/mp2t', 'video/iso.segment'])
  const HLS_TYPES = new Set([
    'application/vnd.apple.mpegurl',
    'application/x-mpegurl',
    'audio/mpegurl',
    'audio/x-mpegurl'
  ])
  const DASH_TYPES = new Set(['application/dash+xml'])
  /** The file types a page's video can be, by extension, and the label the popup shows. */
  const FILE_FORMATS = {
    mp4: 'MP4',
    m4v: 'MP4',
    webm: 'WEBM',
    mkv: 'MKV',
    mov: 'MOV',
    flv: 'FLV'
  }
  /** A media file smaller than this (when its size is known) is an icon, an ad or a sound, not a video. */
  const MIN_BYTES = 1048576
  /** How many videos one tab keeps: the rest are not offered. */
  const CAP = 30
  /** The video sites Lightning already handles through its own downloader. */
  const SKIP_HOST = /(^|\.)(youtube\.com|youtu\.be|googlevideo\.com)$/i

  /** The media type of a response, lower case and without its parameters. */
  function mimeOf(contentType) {
    return String(contentType || '')
      .split(';')[0]
      .trim()
      .toLowerCase()
  }

  /** The size of the whole file: Content-Length, or the total after the slash in Content-Range. */
  function sizeOf(info) {
    const range = /\/(\d+)\s*$/.exec(String(info.contentRange || ''))
    if (range) return Number(range[1])
    const length = Number(info.contentLength)
    return Number.isFinite(length) && length > 0 ? length : null
  }

  /** A name for the file the popup shows: its last path part, or the host when there is none. */
  function nameOf(url) {
    const last = url.pathname.split('/').filter(Boolean).pop()
    if (!last) return url.hostname
    try {
      return decodeURIComponent(last).slice(0, 200)
    } catch {
      return last.slice(0, 200)
    }
  }

  /** Whether an address is a playlist or a stream (HLS, DASH) the video dialog takes. */
  function isStreamLink(link) {
    try {
      const url = new URL(link)
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        /\.(m3u8|mpd)$/i.test(url.pathname)
      )
    } catch {
      return false
    }
  }

  /** The video a response is, or null. `info` holds the response's url, tabId, statusCode,
   * contentType, contentLength, contentRange. A stream is listed as its playlist (HLS or DASH). */
  function classify(info) {
    if (!info || typeof info.tabId !== 'number' || info.tabId < 0) return null
    if (
      info.statusCode &&
      info.statusCode !== 206 &&
      (info.statusCode < 200 || info.statusCode >= 300)
    ) {
      return null
    }
    let url
    try {
      url = new URL(info.url)
    } catch {
      return null
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (SKIP_HOST.test(url.hostname)) return null

    const path = url.pathname.toLowerCase()
    const mime = mimeOf(info.contentType)
    if (SEGMENT_EXT.test(path) || SEGMENT_TYPES.has(mime)) return null

    const size = sizeOf(info)
    const ext = (/\.([a-z0-9]{2,5})$/.exec(path) || [])[1]
    let format
    if (HLS_TYPES.has(mime) || /\.m3u8$/.test(path)) format = 'HLS'
    else if (DASH_TYPES.has(mime) || /\.mpd$/.test(path)) format = 'DASH'
    else if (FILE_FORMATS[ext]) format = FILE_FORMATS[ext]
    else if (mime.startsWith('video/')) format = 'VIDEO'
    else if (mime.startsWith('audio/')) {
      // Sound is a video's audio only when it is big enough to be a whole recording.
      if (size === null || size < MIN_BYTES) return null
      format = 'AUDIO'
    } else return null

    const stream = format === 'HLS' || format === 'DASH'
    if (!stream && size !== null && size < MIN_BYTES) return null

    return {
      url: url.href,
      key: `${url.origin}${url.pathname}`,
      format,
      stream,
      name: nameOf(url),
      size
    }
  }

  /** Adds a video to a tab's list: the same address (without its query) is kept once, and a tab keeps
   * at most CAP. Returns the new list; the list given is not changed. */
  function addEntry(list, entry, cap = CAP) {
    const found = list.findIndex((item) => item.key === entry.key)
    if (found >= 0) {
      const next = list.slice()
      // A size learned later is kept; the first answer's name and format stand.
      if (next[found].size === null && entry.size !== null)
        next[found] = { ...next[found], size: entry.size }
      return next
    }
    if (list.length >= cap) return list
    return [...list, entry]
  }

  /** The list in the order the popup shows it: streams first (a playlist before its parts), then files. */
  function sortEntries(list) {
    const rank = (entry) => {
      if (entry.stream) return /master/i.test(entry.name) ? 0 : 1
      return 2
    }
    return list.slice().sort((a, b) => rank(a) - rank(b))
  }

  const LightningMedia = {
    MIN_BYTES,
    CAP,
    mimeOf,
    isStreamLink,
    classify,
    addEntry,
    sortEntries
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = LightningMedia
  else root.LightningMedia = LightningMedia
})(typeof self !== 'undefined' ? self : globalThis)
