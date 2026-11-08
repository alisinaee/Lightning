import type { BrowserWindow } from 'electron'
import type { GlassBlur } from '../shared/types'

const MATERIAL = { standard: 'under-window', strong: 'hud' } as const
const windows = new Set<BrowserWindow>()
let level: GlassBlur = 'standard'

function apply(window: BrowserWindow): void {
  if (window.isDestroyed() || process.platform !== 'darwin') return
  window.setVibrancy(level === 'off' ? null : MATERIAL[level])
}

/** A window that is frosted glass: it takes the blur the person chose, now and when it changes. */
export function registerGlassWindow(window: BrowserWindow): void {
  windows.add(window)
  window.once('closed', () => windows.delete(window))
  apply(window)
}

export function setGlassBlur(next: GlassBlur): void {
  level = next
  for (const window of windows) apply(window)
}
