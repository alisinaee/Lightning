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
    await expect(region.getByRole('button', { name: 'New download' })).toBeVisible()
    await expect(region.getByRole('button', { name: 'Quit' })).toBeVisible()
    await panel.waitForTimeout(1500)
    await panel.screenshot({
      path: '/private/tmp/claude-501/-Users-ali-Works-Lightning/2947f1ce-1f8b-4bb3-a1ec-f36e4dcfd144/scratchpad/panel.png'
    })
  })

  test('says so when nothing is downloading', async ({ lightning }) => {
    const panel = await panelOf(lightning)
    const region = panel.getByRole('region', { name: 'Lightning status' })
    await expect(region.getByText('Nothing is downloading')).toBeVisible({ timeout: 20_000 })
    await expect(region.getByRole('button', { name: 'New download' })).toBeVisible()
  })

  test('the panel obeys Settings → Status bar', async ({ lightning, serve }) => {
    const origin = await serve({ size: 80 * BLOCK, bytesPerSecond: 80_000 })
    await lightning.start(origin.url(), origin.sha256, { fileName: 'delta.bin' })
    const panel = await panelOf(lightning)
    const region = panel.getByRole('region', { name: 'Lightning status' })
    await expect(region.getByRole('button', { name: 'Open delta.bin' })).toBeVisible({
      timeout: 20_000
    })

    const page = lightning.page
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Status bar', exact: true }).click()
    await page.getByRole('checkbox', { name: 'A speed graph in the panel' }).click()
    await page.getByRole('checkbox', { name: /^Quick buttons in the panel/ }).click()
    await page
      .getByRole('checkbox', { name: 'The downloads running now (click one to open it)' })
      .click()
    await page.keyboard.press('Escape')

    await expect(region.getByRole('img', { name: 'Total speed over the last minute' })).toBeHidden({
      timeout: 20_000
    })
    await expect(region.getByRole('button', { name: 'New download' })).toBeHidden()
    await expect(region.getByRole('button', { name: 'Open delta.bin' })).toBeHidden()
  })
})
