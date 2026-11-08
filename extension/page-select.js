// Lightning's select mode for any site: right-click → "Select links with Lightning" injects this
// file into the page. Hover highlights what can be downloaded, click picks it, and one button sends
// every picked link to the desktop app's several-links dialog. Esc or Cancel leaves the mode.
;(() => {
  if (window.__lightningPick) return
  window.__lightningPick = true

  const api = typeof browser !== 'undefined' ? browser : chrome
  const picked = new Map() // url -> element
  let hovered = null

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
    '<button class="lightning-primary" type="button">Send to Lightning</button>' +
    '<button class="lightning-secondary" type="button">Cancel</button>'
  document.documentElement.appendChild(bar)
  const countLabel = bar.querySelector('.lightning-count')
  const sendButton = bar.querySelector('.lightning-primary')
  const cancelButton = bar.querySelector('.lightning-secondary')

  function refresh(message) {
    countLabel.textContent = message || `${picked.size} selected. Click links or videos to pick them.`
    sendButton.disabled = picked.size === 0
  }

  /** The address a clicked element stands for: a link, or the file behind a video or audio. */
  function addressOf(element) {
    const target = element.closest('a[href], video, audio')
    if (!target) return null
    let value = null
    if (target.tagName === 'A') value = target.getAttribute('href')
    else value = target.currentSrc || target.getAttribute('src') || target.querySelector('source[src]')?.getAttribute('src')
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
    const target = event.target
    if (!(target instanceof Element) || !addressOf(target)) return
    if (hovered && hovered !== target) hovered.classList.remove('lightning-pick-hover')
    hovered = target
    target.classList.add('lightning-pick-hover')
  }

  function onClick(event) {
    if (ownBar(event)) return
    const target = event.target
    const url = target instanceof Element ? addressOf(target) : null
    if (!url) return
    // Picking, not following: the page's own link must not open.
    event.preventDefault()
    event.stopPropagation()
    if (picked.has(url)) {
      picked.get(url).classList.remove('lightning-pick-on')
      picked.delete(url)
    } else {
      target.classList.add('lightning-pick-on')
      picked.set(url, target)
    }
    refresh()
  }

  function onKey(event) {
    if (event.key === 'Escape') stop()
  }

  function stop() {
    document.removeEventListener('mouseover', onOver, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('keydown', onKey, true)
    for (const element of picked.values()) element.classList.remove('lightning-pick-on')
    if (hovered) hovered.classList.remove('lightning-pick-hover')
    picked.clear()
    bar.remove()
    STYLE.remove()
    window.__lightningPick = false
  }

  sendButton.addEventListener('click', async () => {
    sendButton.disabled = true
    refresh(`Sending ${picked.size}…`)
    try {
      const reply = await api.runtime.sendMessage({ type: 'send-links', links: [...picked.keys()] })
      if (reply?.result === 'ok') {
        refresh(`Sent ${picked.size} to Lightning.`)
        setTimeout(stop, 1500)
        return
      }
      refresh(reply?.message || 'Lightning could not take the links.')
    } catch {
      refresh('Lightning could not take the links.')
    }
    sendButton.disabled = picked.size === 0
  })
  cancelButton.addEventListener('click', stop)

  document.addEventListener('mouseover', onOver, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKey, true)
  refresh()
})()
