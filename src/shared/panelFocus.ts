/** How long after opening the panel may go without focus before it counts as clicked away from:
 * macOS gives a window its focus a moment after it is shown. */
export const PANEL_FOCUS_GRACE_MS = 600

/** Whether the panel under the menu-bar icon should close because the person went elsewhere. It
 * normally hears that as a "blur", but a window of an app that is not the active one never had the
 * focus to lose, so it is also watched: open, not focused, and past the moment focus takes. */
export function shouldClosePanel(state: {
  visible: boolean
  focused: boolean
  shownAt: number
  now: number
}): boolean {
  return state.visible && !state.focused && state.now - state.shownAt > PANEL_FOCUS_GRACE_MS
}
