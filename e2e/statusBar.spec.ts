import { BLOCK, expect, NETWORKS, test } from './fixtures'

// The status bar: a menu of live details behind its count and speed, and Settings → Status bar
// deciding what the bar and the menu hold.

test.describe('status bar menu @smoke', () => {
  test('shows the speed, each network and the running downloads', async ({ lightning, serve }) => {
    const nets = Object.keys(NETWORKS)
    for (const name of ['alpha.bin', 'beta.bin']) {
      const origin = await serve({ size: 60 * BLOCK, bytesPerSecond: 60_000 })
      await lightning.start(origin.url(), origin.sha256, { fileName: name, networks: nets })
    }
    const page = lightning.page
    await expect(page.getByText('↓')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Show download activity' }).click()

    const menu = page.getByRole('region', { name: 'Download activity' })
    await expect(menu).toBeVisible()
    await expect(menu.getByText('Speed now')).toBeVisible()
    await expect(menu.getByRole('img', { name: 'Total speed over the last minute' })).toBeVisible()
    await expect(menu.getByText('Running', { exact: true }).first()).toBeVisible()
    await expect(menu.getByRole('button', { name: /alpha\.bin/ })).toBeVisible()
    await expect(menu.getByRole('button', { name: /beta\.bin/ })).toBeVisible()
    await expect(menu.getByText(/\d+ connections? ·/).first()).toBeVisible()
    await expect(menu.getByText('Free space')).toBeVisible()
    // A running download opens from the menu.
    await menu.getByRole('button', { name: /alpha\.bin/ }).click()
    await expect(
      page.getByRole('heading', { name: 'alpha.bin' }).or(page.getByText('alpha.bin').first())
    ).toBeVisible()
  })

  test('Settings → Status bar switches the bar’s items and the menu’s parts', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: 60 * BLOCK, bytesPerSecond: 60_000 })
    await lightning.start(origin.url(), origin.sha256, { fileName: 'gamma.bin' })
    const page = lightning.page
    await expect(page.getByText('↓')).toBeVisible({ timeout: 15_000 })

    const choose = async (name: string | RegExp): Promise<void> => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Status bar', exact: true }).click()
      await page.getByRole('checkbox', { name }).click()
      await page.keyboard.press('Escape')
    }

    // An item of the bar goes.
    await choose('The total speed')
    await expect(page.getByText('↓')).toBeHidden()
    await choose('The total speed')
    await expect(page.getByText('↓')).toBeVisible()

    // A part of the menu goes.
    await choose('A graph of the speed over the last minute')
    await page.getByRole('button', { name: 'Show download activity' }).click()
    const menu = page.getByRole('region', { name: 'Download activity' })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('img', { name: 'Total speed over the last minute' })).toBeHidden()
    await expect(menu.getByText('Speed now')).toBeVisible()
    await page.keyboard.press('Escape')

    // With the menu off, the bar is only a bar.
    await choose('Open a menu of live details when the count and speed are clicked')
    await expect(page.getByRole('button', { name: 'Show download activity' })).toBeHidden()
    await expect(page.getByText('↓')).toBeVisible()
  })

  test('the choices survive a restart', async ({ lightning }) => {
    const page = lightning.page
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Status bar', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Free disk space', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByText(/ free$/)).toBeHidden()
    // Saved at once, so a restart finds it as chosen.
    await expect(async () => {
      await lightning.relaunch()
      const saved = await lightning.page.evaluate(
        () => window.lightning.initialState.prefs.statusBar.showFree
      )
      expect(saved).toBe(false)
      await expect(lightning.page.getByText(/ free$/)).toBeHidden()
    }).toPass({ timeout: 30_000 })
  })
})
