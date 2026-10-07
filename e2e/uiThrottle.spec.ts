import { expect, test } from '@playwright/test'
import {
  UI_UPDATE_FOCUSED_MS,
  UI_UPDATE_HIDDEN_MS,
  UI_UPDATE_VISIBLE_MS,
  uiUpdateDelay
} from '../src/shared/uiThrottle'

// How often the window is sent progress: often when it is in front, rarely when nobody can see it.

test.describe('window updates by what is visible @smoke', () => {
  test('a focused window gets the quickest updates', () => {
    expect(uiUpdateDelay({ visible: true, minimized: false, focused: true })).toBe(
      UI_UPDATE_FOCUSED_MS
    )
  })

  test('a window that is visible but behind others gets them less often', () => {
    expect(uiUpdateDelay({ visible: true, minimized: false, focused: false })).toBe(
      UI_UPDATE_VISIBLE_MS
    )
  })

  test('a hidden or minimized window gets them least often', () => {
    expect(uiUpdateDelay({ visible: false, minimized: false, focused: false })).toBe(
      UI_UPDATE_HIDDEN_MS
    )
    expect(uiUpdateDelay({ visible: true, minimized: true, focused: true })).toBe(
      UI_UPDATE_HIDDEN_MS
    )
  })

  test('the less it is seen, the slower the updates', () => {
    expect(UI_UPDATE_FOCUSED_MS).toBeLessThan(UI_UPDATE_VISIBLE_MS)
    expect(UI_UPDATE_VISIBLE_MS).toBeLessThan(UI_UPDATE_HIDDEN_MS)
  })
})
