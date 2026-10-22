// Evidence, and a way out, for a window that stops answering clicks. A dialog or popup that is
// closed in the middle of something can leave `pointer-events: none` on the page, or `inert` on its
// root, with nothing open to explain it: the page keeps drawing but nothing can be clicked. Every few
// seconds this looks for that; the second time in a row it writes what it found to the log (via the
// console, as errorLog does) and puts the page back.
const OPEN_LAYERS =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [data-popup-open], [data-open][role]'

function describe(el: Element | null): string {
  if (!el) return 'none'
  const id = el.id ? `#${el.id}` : ''
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3) : []
  return `${el.tagName.toLowerCase()}${id}${cls.length ? `.${cls.join('.')}` : ''}`
}

function blockers(): string[] {
  const found: string[] = []
  if (getComputedStyle(document.body).pointerEvents === 'none')
    found.push('body pointer-events:none')
  if (getComputedStyle(document.documentElement).pointerEvents === 'none') {
    found.push('html pointer-events:none')
  }
  for (const el of document.querySelectorAll('[inert]')) found.push(`inert on ${describe(el)}`)
  return found
}

function release(): void {
  document.body.style.pointerEvents = ''
  document.documentElement.style.pointerEvents = ''
  for (const el of document.querySelectorAll('[inert]')) el.removeAttribute('inert')
}

let strikes = 0
setInterval(() => {
  // Something is legitimately open: it is allowed to block the page behind it.
  if (document.querySelector(OPEN_LAYERS)) {
    strikes = 0
    return
  }
  const found = blockers()
  if (found.length === 0) {
    strikes = 0
    return
  }
  if (++strikes < 2) return
  console.warn(
    `Click guard: the page was blocked with nothing open (${found.join('; ')}); focus on ${describe(
      document.activeElement
    )}. Released.`
  )
  release()
  strikes = 0
}, 3000)

// A click that lands on the page itself rather than on anything in it is another sign of a block.
let lastReport = 0
window.addEventListener(
  'pointerdown',
  (event) => {
    const target = event.target as Element | null
    if (target !== document.documentElement && target !== document.body) return
    if (document.querySelector(OPEN_LAYERS) || Date.now() - lastReport < 30_000) return
    lastReport = Date.now()
    console.warn(
      `Click guard: a click at ${Math.round(event.clientX)},${Math.round(event.clientY)} reached ` +
        `the page itself (${describe(target)}); blocked by: ${blockers().join('; ') || 'nothing found'}`
    )
  },
  true
)
