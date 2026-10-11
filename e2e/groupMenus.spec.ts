import type { StartDownloadRequest } from '../src/shared/types'
import { BLOCK, expect, test, type LightningApp } from './fixtures'
import type { Origin } from './origin'

// Right-click menus on a group, on a file in it, and on a file still waiting to start.

async function request(
  lightning: LightningApp,
  origin: Origin,
  name: string
): Promise<StartDownloadRequest> {
  const probe = await lightning.api.probeUrl(origin.url())
  return {
    kind: 'http',
    url: probe.finalUrl,
    destinationDir: lightning.dirs.dest,
    suggestedFileName: name,
    totalBytes: probe.totalBytes ?? 0,
    supportsRanges: probe.supportsRanges,
    interfaceIds: ['a'],
    etag: probe.etag,
    lastModified: probe.lastModified
  }
}

test.describe('group right-click menus @smoke', () => {
  test('a group and a file in it each have their actions', async ({ lightning, serve }) => {
    const origin = await serve({ size: 4 * BLOCK })
    const { group } = await lightning.api.createGroup({
      name: 'Menus',
      destinationDir: lightning.dirs.dest,
      mode: 'manual',
      interfaceIds: ['a'],
      requests: [await request(lightning, origin, 'inside.bin')]
    })
    await lightning.waitForStatus('completed')
    const page = lightning.page
    const header = page.locator(`[data-group="${group.id}"]`)

    // The group: its own actions, and right-clicking does not open or close it.
    await header.click({ button: 'right' })
    for (const name of ['Show files', 'Edit group', 'Select all files', 'Remove group…']) {
      await expect(page.getByRole('menuitem', { name })).toBeVisible()
    }
    await page.getByRole('menuitem', { name: 'Show files' }).click()

    // A file in the group: the same actions a plain download has.
    await page.getByText('inside.bin').first().click({ button: 'right' })
    for (const name of ['Details', 'Copy link', 'Copy file name']) {
      await expect(page.getByRole('menuitem', { name })).toBeVisible()
    }
    await page.keyboard.press('Escape')

    // Remove group… asks first.
    await header.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Remove group…' }).click()
    await expect(page.getByRole('alertdialog').getByText(/^Remove Menus\?/)).toBeVisible()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Keep it' }).click()
  })

  test('a file still waiting to start can be copied or taken out of its group', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: 4 * BLOCK })
    const { group } = await lightning.api.createGroup({
      name: 'Waiting',
      destinationDir: lightning.dirs.dest,
      mode: 'auto',
      startLater: true,
      interfaceIds: ['a'],
      requests: [await request(lightning, origin, 'waits.bin')]
    })
    const page = lightning.page
    await page.getByRole('button', { name: 'Show files in Waiting' }).click()
    const row = page.getByText('waits.bin').first()
    await row.click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Copy file name' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Remove from group' }).click()
    await expect
      .poll(
        async () =>
          (await lightning.api.listGroups()).find((g) => g.id === group.id)?.pending.length ?? 0
      )
      .toBe(0)
  })
})
