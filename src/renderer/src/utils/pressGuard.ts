// A press that begins on a button belongs to that button. A list that re-sorts, or a row that moves,
// between the press and the release would otherwise hand the click to whatever slid under the
// pointer, and the person would have to press again. The pointer itself must have stayed put:
// dragging off a button still cancels it.
const STILL_PX = 6
/** Longer than this is a hold, not a click. */
const PRESS_MS = 1500

/** These open on the press, under the pointer: their release lands on what they opened. */
const OPENS_ON_PRESS = '[aria-haspopup], [aria-expanded], [role="combobox"]'

let press: { button: HTMLButtonElement; x: number; y: number; at: number } | null = null

window.addEventListener(
  'pointerdown',
  (event) => {
    press = null
    if (event.button !== 0 || !event.isPrimary || !(event.target instanceof Element)) return
    const button = event.target.closest('button')
    if (!button || button.disabled || button.matches(OPENS_ON_PRESS)) return
    press = { button, x: event.clientX, y: event.clientY, at: event.timeStamp }
  },
  true
)

function forget(): void {
  press = null
}
window.addEventListener('pointercancel', forget, true)
window.addEventListener('dragstart', forget, true)

window.addEventListener(
  'click',
  (event) => {
    // Made by code or the keyboard: not the end of a press.
    if (!press || !event.isTrusted || event.detail === 0) return
    const { button, x, y, at } = press
    press = null
    if (button.contains(event.target as Node)) return
    if (Math.hypot(event.clientX - x, event.clientY - y) > STILL_PX) return
    if (event.timeStamp - at > PRESS_MS) return
    // The click must not land on what took the button's place, also when the button has gone.
    event.preventDefault()
    event.stopImmediatePropagation()
    if (button.isConnected && !button.disabled) button.click()
  },
  true
)
