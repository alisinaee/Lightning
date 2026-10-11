import { BLOCK, expect, test } from './fixtures'

// Hiding the side panel (asked first, restorable in Settings), the slow mode control that looks
// editable, and the website under file names being off until switched on.

test.describe('side panel, slow mode and the website line @smoke', () => {
  test('the side panel is hidden after confirming, filtered from the top bar, and brought back in Settings', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: 4 * BLOCK })
    await lightning.start(origin.url(), origin.sha256, { fileName: 'one.bin' })
    await lightning.waitForStatus('completed')
    const page = lightning.page
    const sidebar = page.getByRole('navigation').first()
    await expect(sidebar).toBeVisible()

    // Asked first: Cancel leaves it.
    await page.getByRole('button', { name: 'Hide side panel' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByText('Hide the side panel?')).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(sidebar).toBeVisible()

    await page.getByRole('button', { name: 'Hide side panel' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Hide', exact: true }).click()
    await expect(sidebar).toBeHidden()
    // The filters are still reachable from the top bar.
    await expect(page.getByRole('button', { name: 'Filter' })).toBeVisible()

    // Brought back in Settings → Interface, and the choice is saved.
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Interface', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Show the side panel' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('navigation').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Filter' })).toBeHidden()
  })

  test('the hidden panel is remembered across a restart', async ({ lightning, serve }) => {
    const origin = await serve({ size: 4 * BLOCK })
    await lightning.start(origin.url(), origin.sha256, { fileName: 'one.bin' })
    await lightning.waitForStatus('completed')
    const page = lightning.page
    await page.getByRole('button', { name: 'Hide side panel' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Hide', exact: true }).click()
    await expect(async () => {
      await lightning.relaunch()
      const hidden = await lightning.page.evaluate(
        () => window.lightning.initialState.prefs.sidebarHidden
      )
      expect(hidden).toBe(true)
    }).toPass({ timeout: 30_000 })
  })

  test('the slow mode control shows an edit icon and opens its speed', async ({ lightning }) => {
    const page = lightning.page
    const speed = page.getByRole('button', { name: 'Slow mode speed' })
    await expect(speed).toBeVisible()
    await expect(speed.locator('svg')).toBeVisible()
    await speed.click()
    await expect(page.getByText('Caps all downloads at this speed')).toBeVisible()
  })

  test('the website under a file name is off by default and switched on in Settings', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: 4 * BLOCK })
    await lightning.start(origin.url(), origin.sha256, { fileName: 'host.bin' })
    await lightning.waitForStatus('completed')
    const page = lightning.page
    const host = new URL(origin.url()).host
    await expect(page.getByText('host.bin').first()).toBeVisible()
    await expect(page.getByText(host)).toBeHidden()

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Interface', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Show the website under file names' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByText(host).first()).toBeVisible()
  })
})
