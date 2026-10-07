import { expect, test } from '@playwright/test'
import { PANEL_FOCUS_GRACE_MS, shouldClosePanel } from '../src/shared/panelFocus'

// When the panel under the menu-bar icon closes because someone clicked elsewhere.

const open = { visible: true, focused: false, shownAt: 1000 }

test.describe('closing the menu bar panel @smoke', () => {
  test('stays while it has the focus', () => {
    expect(shouldClosePanel({ ...open, focused: true, now: 100_000 })).toBe(false)
  })

  test('closes once it has lost, or never had, the focus', () => {
    expect(shouldClosePanel({ ...open, now: 1000 + PANEL_FOCUS_GRACE_MS + 1 })).toBe(true)
  })

  test('is given a moment to take the focus after opening', () => {
    expect(shouldClosePanel({ ...open, now: 1000 + 100 })).toBe(false)
  })

  test('has nothing to close when it is not showing', () => {
    expect(shouldClosePanel({ ...open, visible: false, now: 100_000 })).toBe(false)
  })
})
