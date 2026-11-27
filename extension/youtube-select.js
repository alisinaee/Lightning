// Lightning's YouTube select mode: a checkbox on each video card, and one button that sends
// every ticked video to the desktop app's YouTube downloader. Runs only on YouTube pages.
;(() => {
  if (window.__lightningSelect) return
  window.__lightningSelect = true

  const api = typeof browser !== 'undefined' ? browser : chrome

  // Texts in Lightning's language (kept in storage by the background script), else the browser's.
  const I18N = self.LightningI18n
  let lang = I18N.pick('', api.i18n?.getUILanguage?.() || navigator.language)
  const t = (key, vars) => I18N.t(lang, key, vars)
  const relang = (saved) => {
    lang = I18N.pick(saved, api.i18n?.getUILanguage?.() || navigator.language)
    if (bar || toggleButton) {
      syncToggle()
      relabelBar()
    }
  }
  api.storage.local
    .get({ lang: '' })
    .then((v) => relang(v.lang))
    .catch(() => {})
  api.storage.onChanged?.addListener((changes) => {
    if (changes.lang) relang(changes.lang.newValue)
  })

  const STYLE = `
    .lightning-box {
      position: absolute; top: 8px; left: 8px; z-index: 2000; box-sizing: border-box;
      display: flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; margin: 0; padding: 0; cursor: pointer; border-radius: 8px;
      border: 2px solid #fff; background: rgba(0,0,0,.6); color: #fff;
      font: 700 17px/1 system-ui, sans-serif; box-shadow: 0 1px 6px rgba(0,0,0,.5);
    }
    .lightning-box:hover { border-color: #fbbf24; }
    .lightning-box[aria-checked="true"] { background: #d97706; }
    .lightning-box[aria-checked="true"]::before { content: '✓'; }
    .lightning-select-on [data-lightning-card] { cursor: pointer; }
    /* The preview that plays on hover is laid over the card, outside it, and would take the click. */
    .lightning-select-on ytd-video-preview, .lightning-select-on #video-preview {
      display: none !important;
    }
    .lightning-picked { outline: 3px solid #d97706; outline-offset: 2px; border-radius: 10px; }
    [hidden].lightning-toggle, #lightning-select-bar [hidden] { display: none !important; }
    #lightning-select-bar button:focus-visible, #lightning-select-toggle:focus-visible,
    .lightning-box:focus-visible {
      outline: 2px solid #fbbf24; outline-offset: 2px;
    }
    #lightning-select-bar {
      position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 99999;
      display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 16px;
      background: #1f1f1f; color: #fff; border-radius: 999px; font: 500 14px/1 system-ui, sans-serif;
      box-shadow: 0 8px 24px rgba(0,0,0,.35);
    }
    #lightning-select-bar .lightning-count { min-width: 120px; }
    #lightning-select-bar button {
      font: 600 13px/1 system-ui, sans-serif; border: 0; border-radius: 999px;
      padding: 9px 14px; cursor: pointer;
    }
    #lightning-select-bar button:disabled { opacity: .45; cursor: default; }
    #lightning-select-bar .lightning-primary { background: #d97706; color: #fff; }
    #lightning-select-bar .lightning-ghost { background: transparent; color: #fff; }
    #lightning-select-bar .lightning-this[aria-pressed="true"] { background: #fff; color: #1f1f1f; }
    #lightning-select-toggle {
      position: fixed; right: 20px; bottom: 20px; z-index: 99998;
      font: 600 13px/1 system-ui, sans-serif; border: 0; border-radius: 999px;
      padding: 10px 16px; cursor: pointer; background: #d97706; color: #fff;
      box-shadow: 0 6px 18px rgba(0,0,0,.3);
    }
    #lightning-select-toggle[aria-pressed="true"] { background: #1f1f1f; }
  `
  // A copy left by an earlier load of the extension no longer answers: its controls are replaced.
  document.documentElement.classList.remove('lightning-select-on')
  for (const old of document.querySelectorAll(
    '#lightning-select-bar, #lightning-select-toggle, [data-lightning-box], .lightning-box'
  ))
    old.remove()
  for (const card of document.querySelectorAll('[data-lightning-card]')) {
    card.classList.remove('lightning-picked')
    card.removeAttribute('data-lightning-card')
  }
  const style = document.createElement('style')
  style.textContent = STYLE
  ;(document.head || document.documentElement).appendChild(style)

  // The card types YouTube uses for videos in its lists, grids and search results.
  const CARD =
    'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ' +
    'ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, ' +
    'ytd-reel-item-renderer, ytm-video-with-context-renderer, ytm-rich-item-renderer, ' +
    'ytm-compact-video-renderer, ytm-playlist-video-renderer'
  // Newer cards (channel pages, some search results) are yt-lockup-view-model with no #thumbnail id.
  const LOOSE =
    'yt-lockup-view-model, ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2'
  const THUMB = '#thumbnail, yt-thumbnail-view-model'
  const LINK =
    'a#thumbnail[href], a#video-title[href], a#video-title-link[href], ' +
    'a[class*="ContentImage"][href], a[class*="TitleLink"][href], a[href*="/watch?v="][href], a[href*="/shorts/"][href]'

  /** Every video card on the page: the classic renderers, then newer lockups not already inside one. */
  function cardsOnPage() {
    const found = [...document.querySelectorAll(CARD)]
    // A shelf or a playlist wraps other cards: only the inner ones are videos.
    for (let i = found.length - 1; i >= 0; i -= 1) {
      if (found[i].querySelector(CARD)) found.splice(i, 1)
    }
    for (const lockup of document.querySelectorAll(LOOSE)) {
      if (!lockup.closest(CARD) && !lockup.parentElement?.closest(LOOSE)) found.push(lockup)
    }
    return found
  }

  // The desktop app takes at most this many videos in one batch.
  const MAX_BATCH = 200
  const selected = new Map() // video id -> { url, title }
  let active = false
  let bar = null
  let busy = false

  /** The video address and title on a card, or null when the card has no video link. */
  function videoOf(card) {
    const link = [...card.querySelectorAll(LINK)].find((entry) =>
      /\/watch\?|\/shorts\//.test(entry.getAttribute('href') || '')
    )
    if (!link) return null
    let url
    try {
      url = new URL(link.getAttribute('href'), location.href)
    } catch {
      return null
    }
    const id = url.searchParams.get('v') || (url.pathname.match(/^\/shorts\/([\w-]+)/) || [])[1]
    if (!id) return null
    const title = (
      card.querySelector(
        '#video-title, h3, [class*="metadata-view-model__title"], [class*="TitleLink"]'
      )?.textContent ||
      link.getAttribute('title') ||
      link.getAttribute('aria-label') ||
      ''
    ).trim()
    return {
      id,
      url: url.pathname.startsWith('/shorts/')
        ? `https://www.youtube.com/shorts/${id}`
        : `https://www.youtube.com/watch?v=${id}`,
      title
    }
  }

  function setCheck(box, on) {
    box.setAttribute('aria-checked', String(on))
    box.closest('[data-lightning-card]')?.classList.toggle('lightning-picked', on)
  }

  function toggle(video, card) {
    if (selected.has(video.id)) selected.delete(video.id)
    else if (selected.size < MAX_BATCH)
      selected.set(video.id, { url: video.url, title: video.title })
    const box = card.querySelector('[data-lightning-box]')
    if (box) setCheck(box, selected.has(video.id))
    changed()
  }

  /** The video the watch page (or a Shorts page) is playing, or null on a list page. */
  function currentVideo() {
    const url = new URL(location.href)
    const id = url.pathname.startsWith('/shorts/')
      ? (url.pathname.match(/^\/shorts\/([\w-]+)/) || [])[1]
      : url.pathname === '/watch'
        ? url.searchParams.get('v')
        : null
    if (!id) return null
    const heading = document.querySelector('h1.ytd-watch-metadata, ytd-watch-metadata h1, h1')
    const title = (heading?.textContent || document.title.replace(/ - YouTube$/, '')).trim()
    return {
      id,
      url: url.pathname.startsWith('/shorts/')
        ? `https://www.youtube.com/shorts/${id}`
        : `https://www.youtube.com/watch?v=${id}`,
      title
    }
  }

  function toggleCurrent() {
    const video = currentVideo()
    if (!video) return
    if (selected.has(video.id)) selected.delete(video.id)
    else if (selected.size < MAX_BATCH)
      selected.set(video.id, { url: video.url, title: video.title })
    changed()
  }

  /** A pick changed: any "Sent" message gives way to the live count. */
  function changed() {
    flashUntil = 0
    updateBar()
  }

  /** Adds a checkbox to every video card on the page, and fixes the ones YouTube reused for another video. */
  function decorate() {
    if (!active) return
    for (const card of cardsOnPage()) {
      const video = videoOf(card)
      if (!video) continue
      const have = card.querySelector('[data-lightning-box]')
      if (have && card.dataset.lightningCard === video.id) continue
      // Either new, or YouTube put another video in this card (or dropped our checkbox): start over.
      card.querySelectorAll('[data-lightning-box]').forEach((old) => old.remove())
      card.dataset.lightningCard = video.id
      card.setAttribute('data-lightning-card', video.id)
      const thumb = card.querySelector(THUMB) || card
      if (getComputedStyle(thumb).position === 'static') thumb.style.position = 'relative'

      const box = document.createElement('span')
      box.setAttribute('role', 'checkbox')
      box.tabIndex = 0
      box.setAttribute('data-lightning-box', video.id)
      box.setAttribute('aria-label', t('yt_aria', { t: video.title || t('yt_video') }))
      box.className = 'lightning-box'
      thumb.appendChild(box)
      setCheck(box, selected.has(video.id))
    }
    updateBar()
  }

  /** The card under a press. What is on top there may lie outside the card (a preview, a badge, an
   * overlay), so everything under the pointer is looked at, not only the event's target. */
  function cardFrom(event) {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('#lightning-select-bar, #lightning-select-toggle')) return null
    const own = target?.closest('[data-lightning-card]')
    if (own) return own
    // YouTube's header, menus, dialogs and the side guide stay usable over the cards.
    if (
      target?.closest(
        '#masthead-container, ytd-masthead, tp-yt-app-drawer, ytd-popup-container, ' +
          'tp-yt-iron-dropdown, ytd-mini-guide-renderer, #movie_player, ytd-feed-filter-chip-bar-renderer'
      )
    )
      return null
    if (event.type.startsWith('key')) return null
    for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
      const card = element.closest('[data-lightning-card]')
      if (card) return card
    }
    return null
  }

  function swallow(event) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  // In select mode a press anywhere on a card ticks its video and nothing else: YouTube acts on the
  // press as well as the click, so all of them are kept from it. First on the window, before its own.
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick', 'click']) {
    window.addEventListener(
      type,
      (event) => {
        if (!active || event.button !== 0) return
        const card = cardFrom(event)
        const video = card && videoOf(card)
        if (!video) return
        swallow(event)
        if (type === 'click') toggle(video, card)
      },
      true
    )
  }
  // Space or Enter ticks: on the box, and on a card's own link, which Enter would open.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!active || (event.key !== 'Enter' && event.key !== ' ')) return
      if (!(event.target instanceof Element)) return
      const onBox = event.target.closest('[data-lightning-box]')
      if (!onBox && !(event.key === 'Enter' && event.target.closest('a[href]'))) return
      const card = cardFrom(event)
      const video = card && videoOf(card)
      if (!video) return
      swallow(event)
      toggle(video, card)
    },
    true
  )

  // A status message stays up for a moment; the counts do not overwrite it.
  let flashUntil = 0

  /** Sets a label only when its text changed (the page observer watches this bar too). */
  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text
  }

  function updateBar() {
    if (!bar) return
    const count = selected.size
    const loaded = document.querySelectorAll('[data-lightning-card]').length
    // Buttons always follow the picks; only the count text gives way to a status message.
    if (Date.now() >= flashUntil) {
      setText(
        bar.count,
        count === 0
          ? t('yt_none')
          : `${t('yt_n', { n: count })}${count >= MAX_BATCH ? ' ' + t('yt_max') : ''}`
      )
    }
    setText(bar.send, count > 0 ? t('yt_dl_n', { n: count }) : t('yt_dl'))
    bar.send.disabled = count === 0 || busy
    bar.clear.disabled = count === 0 || busy
    bar.invert.disabled = loaded === 0 || busy
    bar.selectAll.disabled = loaded === 0 || busy || count >= MAX_BATCH
    const current = currentVideo()
    bar.this.hidden = !current
    if (current) bar.this.setAttribute('aria-pressed', String(selected.has(current.id)))
  }

  function relabelBar() {
    if (!bar) return
    bar.selectAll.textContent = t('yt_all')
    bar.invert.textContent = t('yt_invert')
    bar.clear.textContent = t('yt_clear')
    bar.done.textContent = t('yt_done')
    bar.this.textContent = t('yt_this')
    bar.root.dir = I18N.dir(lang)
    updateBar()
  }

  let setActive = function setActiveState(on) {
    if (on === active) return
    if (!on && selected.size > 0 && !confirm(t('yt_discard', { n: selected.size }))) return
    active = on
    document.documentElement.classList.toggle('lightning-select-on', on)
    if (on) {
      mountBar()
      decorate()
    } else {
      document.querySelectorAll('[data-lightning-card]').forEach((card) => {
        card.classList.remove('lightning-picked')
        card.querySelector('[data-lightning-box]')?.remove()
        delete card.dataset.lightningCard
        card.removeAttribute('data-lightning-card')
      })
      selected.clear()
      unmountBar()
    }
    updateBar()
  }

  function button(label, className, onClick) {
    const node = document.createElement('button')
    node.type = 'button'
    node.textContent = label
    node.className = className
    node.addEventListener('click', onClick)
    return node
  }

  /** Every decorated card on the page, with its video. */
  function loadedVideos() {
    const out = []
    for (const card of document.querySelectorAll('[data-lightning-card]')) {
      const video = videoOf(card)
      if (video) out.push({ card, video })
    }
    return out
  }

  function selectAllLoaded() {
    for (const { card, video } of loadedVideos()) {
      if (selected.size >= MAX_BATCH) break
      if (!selected.has(video.id)) selected.set(video.id, { url: video.url, title: video.title })
      const box = card.querySelector('[data-lightning-box]')
      if (box) setCheck(box, true)
    }
    changed()
  }

  function invertSelection() {
    for (const { card, video } of loadedVideos()) {
      if (selected.has(video.id)) selected.delete(video.id)
      else if (selected.size < MAX_BATCH)
        selected.set(video.id, { url: video.url, title: video.title })
      const box = card.querySelector('[data-lightning-box]')
      if (box) setCheck(box, selected.has(video.id))
    }
    changed()
  }

  function clearSelection() {
    selected.clear()
    document.querySelectorAll('[data-lightning-box]').forEach((box) => setCheck(box, false))
    changed()
  }

  function mountBar() {
    if (bar) return
    const root = document.createElement('div')
    root.id = 'lightning-select-bar'
    const count = document.createElement('span')
    count.className = 'lightning-count'
    const thisOne = button('', 'lightning-ghost lightning-this', toggleCurrent)
    thisOne.setAttribute('aria-pressed', 'false')
    const selectAll = button('', 'lightning-ghost', selectAllLoaded)
    const invert = button('', 'lightning-ghost', invertSelection)
    const clear = button('', 'lightning-ghost', clearSelection)
    const send = button('', 'lightning-primary', sendSelected)
    const done = button('', 'lightning-ghost', () => setActive(false))
    root.append(count, thisOne, selectAll, invert, clear, send, done)
    document.documentElement.appendChild(root)
    bar = { root, count, selectAll, invert, clear, send, done, this: thisOne }
    relabelBar()
  }

  function unmountBar() {
    bar?.root.remove()
    bar = null
  }

  function flash(text) {
    if (!bar) return
    flashUntil = Date.now() + 2500
    bar.count.textContent = text
    setTimeout(updateBar, 2500)
  }

  async function sendSelected() {
    if (selected.size === 0 || busy) return
    if (selected.size > MAX_BATCH) {
      flash(t('yt_limit', { n: MAX_BATCH }))
      return
    }
    busy = true
    updateBar()
    const videos = [...selected.values()]
    try {
      const response = await api.runtime.sendMessage({ type: 'youtube-batch', videos })
      if (response?.result === 'ok') {
        selected.clear()
        document.querySelectorAll('[data-lightning-box]').forEach((box) => setCheck(box, false))
        flash(t('yt_sent', { n: response.started ?? videos.length }))
      } else {
        flash(response?.message || t('yt_fail'))
      }
    } catch {
      flash(t('yt_fail'))
    } finally {
      busy = false
      updateBar()
    }
  }

  // The small button that turns select mode on or off, always visible on YouTube pages.
  const toggleButton = button(t('yt_toggle'), 'lightning-toggle', () => setActive(!active))
  toggleButton.id = 'lightning-select-toggle'
  toggleButton.setAttribute('aria-pressed', 'false')
  const syncToggle = () => {
    toggleButton.setAttribute('aria-pressed', String(active))
    toggleButton.textContent = active ? t('yt_stop') : t('yt_toggle')
    // While the bar is up, "Done" is the way out, so the toggle steps aside.
    toggleButton.hidden = active
  }

  // Keyboard: Ctrl/Cmd+A selects all loaded videos; Esc clears, then leaves select mode.
  // Ignored while typing in a text field, so search boxes and comments still work.
  document.addEventListener('keydown', (event) => {
    if (!active) return
    const typing =
      event.target instanceof Element &&
      event.target.closest('input, textarea, [contenteditable="true"]')
    if (typing && !event.target.matches('[data-lightning-box]')) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      selectAllLoaded()
    } else if (event.key === 'Escape') {
      if (selected.size > 0) clearSelection()
      else setActive(false)
    }
  })
  document.documentElement.appendChild(toggleButton)
  const baseSetActive = setActive
  setActive = (on) => {
    baseSetActive(on)
    syncToggle()
  }

  // Lists load as the person scrolls, and YouTube changes pages without reloading: keep up.
  // The bar's own changes (its labels) are not page changes: they are ignored.
  const inOwnBar = (node) => {
    const element = node instanceof Element ? node : node.parentElement
    return !!element?.closest('#lightning-select-bar, #lightning-select-toggle')
  }
  let frame = 0
  const observer = new MutationObserver((records) => {
    if (!active || frame) return
    if (records.every((record) => inOwnBar(record.target))) return
    frame = requestAnimationFrame(() => {
      frame = 0
      decorate()
    })
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })

  // The popup and the background can turn select mode on and off.
  api.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'youtube-select') {
      setActive(message.on === undefined ? !active : message.on)
      respond({ active })
      return false
    }
    if (message?.type === 'youtube-select-state') {
      respond({ active, count: selected.size })
      return false
    }
    return false
  })
})()
