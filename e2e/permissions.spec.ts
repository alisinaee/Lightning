import { expect, test } from './fixtures'

// Settings → Permissions lists what macOS lets Lightning do, each with its state or a way to allow it.

test('Settings has a Permissions page with the download folder allowed', async ({ lightning }) => {
  test.skip(process.platform !== 'darwin', 'macOS only')
  const dialog = await lightning.openSettings('Permissions')

  const folder = dialog.locator('[data-setting="Download folder"]')
  const fullDisk = dialog.locator('[data-setting="Full Disk Access"]')
  const notifications = dialog.locator('[data-setting="Notifications"]')
  await expect(folder).toBeVisible()
  await expect(fullDisk).toBeVisible()
  await expect(notifications).toBeVisible()
  // The test's own download folder is a temp folder, so it can be read.
  await expect(folder).toContainText('Allowed')
  // macOS doesn't say whether notifications are on, so the row offers to open the settings.
  await expect(notifications.getByRole('button', { name: 'Open settings' })).toBeVisible()
  // Full Disk Access is either held or offered.
  await expect(fullDisk.getByText(/Allowed|Allow…/).first()).toBeVisible()
})
