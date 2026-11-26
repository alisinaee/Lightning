import type { Page } from '@playwright/test'
import { BLOCK, expect, NETWORKS, test, type LightningApp } from './fixtures'

// The panel under the menu-bar icon, read without the icon: its own small window, supplied with
// snapshots about once a second.

test.use({ appEnv: { LIGHTNING_E2E_TRAY_PANEL: '1' } })

async function panelOf(lightning: LightningApp): Promise<Page> {
  let found: Page | undefined
  await expect
    .poll(
      () => {
        found = lightning.electronApp.windows().find((page) => page.url().includes('tray.html'))
        return found !== undefined
      },
      { timeout: 20_000 }
    )
    .toBe(true)
  return found!
}

test.describe('menu bar panel @smoke', () => {
  test('shows the speed, each network, the running downloads and the queue, with bars', async ({
    lightning,
    serve
  }) => {
    test.setTimeout(90_000)
    const nets = Object.keys(NETWORKS)
    for (const name of ['alpha.rar', 'beta.rar', 'gamma.mp4']) {
      const origin = await serve({ size: 80 * BLOCK, bytesPerSecond: 80_000 })
      await lightning.start(origin.url(), origin.sha256, { fileName: name, networks: nets })
    }
    const panel = await panelOf(lightning)
    const region = panel.getByRole('region', { name: 'Lightning status' })
    await expect(region).toBeVisible({ timeout: 20_000 })
    await expect(region.getByLabel('Total speed', { exact: true })).toContainText('/s', {
      timeout: 20_000
    })
    await expect(region.getByText(/\d+ downloading/)).toBeVisible()
    await expect(
      region.getByRole('img', { name: 'Total speed over the last minute' })
    ).toBeVisible()
    await expect(region.getByText('Networks', { exact: true })).toBeVisible()
    await expect(region.getByText(/\d+ connections?/).first()).toBeVisible()
    await expect(region.getByText('Running', { exact: true })).toBeVisible()
    await expect(region.getByRole('button', { name: 'Open alpha.rar' })).toBeVisible()
    await expect(region.getByRole('button', { name: 'Open beta.rar' })).toBeVisible()
    await expect(region.getByText('waiting')).toBeVisible()
    await expect(region.getByRole('button', { name: 'New', exact: true })).toBeVisible()
    await expect(region.getByRole('button', { name: 'Quit' })).toBeVisible()
  })

  test('says so when nothing is downloading', async ({ lightning }) => {
    const panel = await panelOf(lightning)
    const region = panel.getByRole('region', { name: 'Lightning status' })
    await expect(region.getByText('Nothing is downloading')).toBeVisible({ timeout: 20_000 })
    await expect(region.getByRole('button', { name: 'New', exact: true })).toBeVisible()
  })

  test('the panel obeys Settings → Status bar', async ({ lightning, serve }) => {
    const origin = await serve({ size: 80 * BLOCK, bytesPerSecond: 80_000 })
    await lightning.start(origin.url(), origin.sha256, { fileName: 'delta.bin' })
    const panel = await panelOf(lightning)
    const region = panel.getByRole('region', { name: 'Lightning status' })
    await expect(region.getByRole('button', { name: 'Open delta.bin' })).toBeVisible({
      timeout: 20_000
    })

    const settings = await lightning.openSettings('Status bar')
    await settings.getByRole('switch', { name: 'A speed graph in the panel' }).click()
    await settings.getByRole('switch', { name: /^Quick buttons in the panel/ }).click()
    await settings
      .getByRole('switch', { name: 'The downloads running now (click one to open it)' })
      .click()
    await lightning.closeSettings()

    await expect(region.getByRole('img', { name: 'Total speed over the last minute' })).toBeHidden({
      timeout: 20_000
    })
    await expect(region.getByRole('button', { name: 'New', exact: true })).toBeHidden()
    await expect(region.getByRole('button', { name: 'Open delta.bin' })).toBeHidden()
  })
})
