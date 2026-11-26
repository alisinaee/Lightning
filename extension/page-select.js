// Lightning's select mode for any site: right-click → "Select links with Lightning" injects this
// file into the page. Hover highlights what can be downloaded, click picks it, and one button sends
// every picked link to the desktop app's several-links dialog. Esc or Cancel leaves the mode.
;(() => {
  if (window.__lightningPick) return
  window.__lightningPick = true

  const api = typeof browser !== 'undefined' ? browser : chrome

  // Texts in Lightning's language (kept in storage by the background script), else the browser's.
  const I18N = self.LightningI18n
  let lang = I18N.pick('', api.i18n?.getUILanguage?.() || navigator.language)
  const t = (key, vars) => I18N.t(lang, key, vars)
  const picked = new Map() // url -> element
  let hovered = null
  const PRESSES = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick', 'click']

  const STYLE = document.createElement('style')
  STYLE.textContent = `
    .lightning-pick-hover { outline: 3px dashed #d97706 !important; outline-offset: 2px !important; cursor: copy !important; }
    .lightning-pick-on { outline: 3px solid #d97706 !important; outline-offset: 2px !important; }
    #lightning-pick-bar {
      position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 2147483647;
      display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 16px;
      background: #1f1f1f; color: #fff; border-radius: 999px; font: 500 14px/1 system-ui, sans-serif;
      box-shadow: 0 8px 24px rgba(0,0,0,.35);
    }
    #lightning-pick-bar button {
      font: 600 13px/1 system-ui, sans-serif; border: 0; border-radius: 999px; padding: 9px 14px; cursor: pointer;
    }
    #lightning-pick-bar button:disabled { opacity: .45; cursor: default; }
    #lightning-pick-bar .lightning-primary { background: #d97706; color: #fff; }
    #lightning-pick-bar .lightning-secondary { background: #3a3a3a; color: #fff; }
  `
  document.documentElement.appendChild(STYLE)

  const bar = document.createElement('div')
  bar.id = 'lightning-pick-bar'
  bar.innerHTML =
    '<span class="lightning-count"></span>' +
    '<button class="lightning-primary" type="button"></button>' +
    '<button class="lightning-secondary lightning-all" type="button"></button>' +
    '<button class="lightning-secondary lightning-cancel" type="button"></button>'
  document.documentElement.appendChild(bar)
  const countLabel = bar.querySelector('.lightning-count')
  const sendButton = bar.querySelector('.lightning-primary')
  const allButton = bar.querySelector('.lightning-all')
  const cancelButton = bar.querySelector('.lightning-cancel')

  let status = null // 'sending' | 'sent' | 'fail' | a message from Lightning

  function relabel() {
    bar.dir = I18N.dir(lang)
    sendButton.textContent = t('ps_send')
    allButton.textContent = t('ps_all')
    cancelButton.textContent = t('ps_cancel')
  }

  function refresh(message) {
    if (message !== undefined) status = message
    const text =
      status === 'sending'
        ? t('ps_sending', { n: picked.size })
        : status === 'sent'
          ? t('ps_sent', { n: picked.size })
          : status === 'fail'
            ? t('ps_fail')
            : status || t('ps_hint', { n: picked.size })
    countLabel.textContent = text
    sendButton.disabled = picked.size === 0
  }

  const relang = (saved) => {
    lang = I18N.pick(saved, api.i18n?.getUILanguage?.() || navigator.language)
    relabel()
    refresh()
  }
  api.storage.local
    .get({ lang: '' })
    .then((v) => relang(v.lang))
    .catch(() => {})

  /** The link or media an event is about. A page often lays something over its links (a badge, a
   * preview, a transparent cover) or keeps them in a shadow tree, so everything under the pointer counts. */
  function targetOf(event) {
    const SELECTOR = 'a[href], area[href], video, audio'
    for (const node of event.composedPath()) {
      if (node instanceof Element && node.matches(SELECTOR) && addressOf(node)) return node
    }
    if (event.type.startsWith('key')) return null
    for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
      const found = element.closest(SELECTOR)
      if (found && addressOf(found)) return found
    }
    return null
  }

  /** The address an element stands for: a link, or the file behind a video or audio. */
  function addressOf(target) {
    let value = null
    if (target.matches('a, area')) value = target.getAttribute('href')
    else
      value =
        target.currentSrc ||
        target.getAttribute('src') ||
        target.querySelector('source[src]')?.getAttribute('src')
    if (!value) return null
    try {
      const url = new URL(value, document.baseURI).href
      return /^https?:/i.test(url) ? url : null
    } catch {
      return null
    }
  }

  function ownBar(event) {
    return event.target instanceof Element && event.target.closest('#lightning-pick-bar')
  }

  function onOver(event) {
    if (ownBar(event)) return
    const target = targetOf(event)
    if (hovered && hovered !== target) hovered.classList.remove('lightning-pick-hover')
    if (!target) {
      hovered = null
      return
    }
    hovered = target
    target.classList.add('lightning-pick-hover')
  }

  /** Picking, not following: the press, the click and the double-click never reach the page. */
  function onPress(event) {
    if (event.button !== 0 || ownBar(event)) return
    const target = targetOf(event)
    if (!target) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.type === 'click') pick(target)
  }

  function pick(target) {
    const url = addressOf(target)
    if (!url) return
    if (picked.has(url)) {
      picked.get(url).classList.remove('lightning-pick-on')
      picked.delete(url)
    } else {
      target.classList.add('lightning-pick-on')
      picked.set(url, target)
    }
    refresh(null)
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.stopImmediatePropagation()
      stop()
    } else if (event.key === 'Enter' && !ownBar(event)) {
      const target = targetOf(event)
      if (!target) return
      event.preventDefault()
      event.stopImmediatePropagation()
      pick(target)
    }
  }

  function stop() {
    window.removeEventListener('mouseover', onOver, true)
    for (const type of PRESSES) window.removeEventListener(type, onPress, true)
    window.removeEventListener('keydown', onKey, true)
    for (const element of picked.values()) element.classList.remove('lightning-pick-on')
    if (hovered) hovered.classList.remove('lightning-pick-hover')
    picked.clear()
    bar.remove()
    STYLE.remove()
    window.__lightningPick = false
  }

  sendButton.addEventListener('click', async () => {
    sendButton.disabled = true
    refresh('sending')
    try {
      const reply = await api.runtime.sendMessage({ type: 'send-links', links: [...picked.keys()] })
      if (reply?.result === 'ok') {
        refresh('sent')
        setTimeout(stop, 1500)
        return
      }
      refresh(reply?.message || 'fail')
    } catch {
      refresh('fail')
    }
    sendButton.disabled = picked.size === 0
  })
  cancelButton.addEventListener('click', stop)

  // Picks every link and media address on the page (the old "Scan this page" job).
  allButton.addEventListener('click', () => {
    for (const element of document.querySelectorAll('a[href], video, audio')) {
      const url = addressOf(element)
      if (!url || picked.has(url)) continue
      element.classList.add('lightning-pick-on')
      picked.set(url, element)
      if (picked.size >= 2000) break
    }
    refresh(null)
  })

  window.addEventListener('mouseover', onOver, true)
  for (const type of PRESSES) window.addEventListener(type, onPress, true)
  window.addEventListener('keydown', onKey, true)
  relabel()
  refresh(null)
})()
