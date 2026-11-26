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
      const settings = await lightning.openSettings('Status bar')
      await settings.getByRole('switch', { name, exact: typeof name === 'string' }).click()
      await lightning.closeSettings()
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

  test('the clipboard switch in the bar turns tracking on and off', async ({ lightning }) => {
    const page = lightning.page
    // What main has saved, read back the way a new window reads it.
    const saved = (): Promise<boolean> =>
      page.evaluate(() => window.lightning.readInitialState().prefs.clipboardTrack)
    const toggle = page.getByRole('switch', { name: 'Track the clipboard' })
    await expect(toggle).toBeVisible()
    const before = await toggle.isChecked()
    await toggle.click()
    await expect(toggle).toBeChecked({ checked: !before })
    await expect.poll(saved).toBe(!before)
    // Settings → Clipboard shows the same choice.
    const settings = await lightning.openSettings('Clipboard')
    await expect(
      settings.getByRole('switch', { name: 'Track the clipboard for download links' })
    ).toBeChecked({ checked: !before })
    await lightning.closeSettings()
    await toggle.click()
    await expect.poll(saved).toBe(before)

    // Settings → Status bar can take the switch away.
    const bar = await lightning.openSettings('Status bar')
    await bar.getByRole('switch', { name: 'A switch to track the clipboard', exact: true }).click()
    await lightning.closeSettings()
    await expect(toggle).toBeHidden()
  })

  test('the choices survive a restart', async ({ lightning }) => {
    const page = lightning.page
    const settings = await lightning.openSettings('Status bar')
    await settings.getByRole('switch', { name: 'Free disk space', exact: true }).click()
    await lightning.closeSettings()
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

test.describe('commands from the menu bar icon @smoke', () => {
  test('a running download clicked in that menu opens its page', async ({ lightning, serve }) => {
    const origin = await serve({ size: 60 * BLOCK, bytesPerSecond: 60_000 })
    const id = await lightning.start(origin.url(), origin.sha256, { fileName: 'delta.bin' })
    await lightning.evaluateMain(({ BrowserWindow }, downloadId) => {
      BrowserWindow.getAllWindows()[0].webContents.send('app:command', 'open-download', downloadId)
    }, id)
    await expect(lightning.page.getByText('delta.bin').first()).toBeVisible()
    await expect(lightning.page.getByRole('button', { name: /Downloads/ }).first()).toBeVisible()
  })
})
