import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, screen, type BrowserWindow, type Rectangle } from 'electron'

// Where the main window was left (its size, place and whether it was maximized or full screen),
// so it opens the same way next time.

interface WindowState {
  bounds: Rectangle
  maximized: boolean
  fullScreen: boolean
  /** The monitor the window was on, and where that monitor was: a maximized or full-screen window
   * has no place of its own, only a monitor. */
  displayId?: number
  displayBounds?: Rectangle
}

const SAVE_DELAY_MS = 400

function statePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function isRectangle(value: unknown): value is Rectangle {
  const rect = value as Rectangle | null
  return (
    !!rect &&
    [rect.x, rect.y, rect.width, rect.height].every((part) => Number.isFinite(part)) &&
    rect.width > 0 &&
    rect.height > 0
  )
}

/** The saved state, when its place is still on a screen that is connected: after unplugging a
 * monitor the window is not left out of sight. */
export function loadWindowState(): WindowState | null {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf-8')) as Partial<WindowState>
    if (!isRectangle(parsed.bounds)) return null
    const bounds = parsed.bounds
    const maximized = parsed.maximized === true
    const fullScreen = parsed.fullScreen === true
    // The monitor it was on, found by its id, or failing that by where it sat.
    const displays = screen.getAllDisplays()
    const display =
      displays.find((entry) => entry.id === parsed.displayId) ??
      (isRectangle(parsed.displayBounds)
        ? displays.find(
            (entry) =>
              entry.bounds.x === parsed.displayBounds!.x &&
              entry.bounds.y === parsed.displayBounds!.y &&
              entry.bounds.width === parsed.displayBounds!.width
          )
        : undefined)
    if (display && (maximized || fullScreen)) {
      // Back to the size it had before, on that monitor.
      const area = display.workArea
      const width = Math.min(bounds.width, area.width)
      const height = Math.min(bounds.height, area.height)
      const inside =
        bounds.x >= area.x &&
        bounds.y >= area.y &&
        bounds.x + width <= area.x + area.width &&
        bounds.y + height <= area.y + area.height
      return {
        bounds: inside
          ? bounds
          : {
              x: Math.round(area.x + (area.width - width) / 2),
              y: Math.round(area.y + (area.height - height) / 2),
              width,
              height
            },
        maximized,
        fullScreen
      }
    }
    const visible = screen.getAllDisplays().some((display) => {
      const area = display.workArea
      const overlapX =
        Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
      const overlapY =
        Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
      return overlapX >= 120 && overlapY >= 80
    })
    if (!visible) return null
    return { bounds, maximized, fullScreen }
  } catch {
    return null
  }
}

/** Remembers the window's size, place and state as the person changes them. */
export function trackWindowState(window: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined
  const save = (): void => {
    clearTimeout(timer)
    if (window.isDestroyed()) return
    const display = screen.getDisplayMatching(window.getBounds())
    const state: WindowState = {
      // Normal bounds: the size it goes back to, not the maximized or full-screen one.
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized(),
      fullScreen: window.isFullScreen(),
      displayId: display.id,
      displayBounds: display.bounds
    }
    try {
      writeFileSync(statePath(), JSON.stringify(state))
    } catch {
      // Not remembered this time.
    }
  }
  const later = (): void => {
    clearTimeout(timer)
    timer = setTimeout(save, SAVE_DELAY_MS)
  }
  for (const event of [
    'resize',
    'move',
    'maximize',
    'unmaximize',
    'enter-full-screen',
    'leave-full-screen'
  ] as const) {
    window.on(event as 'resize', later)
  }
  window.on('close', save)
}
