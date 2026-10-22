import { expect, test } from '@playwright/test'
import { compareVersions } from '../src/main/updateCheck'

// Pure function test: the update check's version ordering, no app launched.

test('pre-releases compare numerically and a release beats its own rc', () => {
  expect(compareVersions('1.0.0-rc.33', '1.0.0-rc.9')).toBe(1)
  expect(compareVersions('1.0.0-rc.9', '1.0.0-rc.33')).toBe(-1)
  expect(compareVersions('1.0.0', '1.0.0-rc.33')).toBe(1)
  expect(compareVersions('1.0.0-rc.33', '1.0.0')).toBe(-1)
  expect(compareVersions('1.0.1-rc.1', '1.0.0')).toBe(1)
  expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  expect(compareVersions('1.0.0-rc.33', '1.0.0-rc.33')).toBe(0)
})
