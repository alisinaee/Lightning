/** How often the window is sent a download's progress, by how much the person can see of it.
 * A window nobody is looking at costs a computer's CPU and fans for nothing: the downloads
 * themselves go on at full speed, and what the window missed is sent in one piece. */
export const UI_UPDATE_FOCUSED_MS = 200
export const UI_UPDATE_VISIBLE_MS = 500
export const UI_UPDATE_HIDDEN_MS = 2000

export function uiUpdateDelay(window: {
  visible: boolean
  minimized: boolean
  focused: boolean
}): number {
  if (!window.visible || window.minimized) return UI_UPDATE_HIDDEN_MS
  return window.focused ? UI_UPDATE_FOCUSED_MS : UI_UPDATE_VISIBLE_MS
}
