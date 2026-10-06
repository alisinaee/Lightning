import type { StartDownloadRequest } from '../src/shared/types'
import { BLOCK, expect, test } from './fixtures'

// Every dialog can be closed from its header, and one with a Done or Save beside it has a Cancel.

test.describe('dialogs @smoke', () => {
  test('New download and Several links have a close button', async ({ lightning }) => {
    const page = lightning.page
    const dialog = page.getByRole('dialog')
    const close = dialog.getByRole('button', { name: 'Close' })

    await page.getByRole('button', { name: 'New download' }).first().click()
    await page.getByRole('menuitem', { name: 'One link' }).click()
    await expect(close).toBeVisible()
    await close.click()
    await expect(dialog).toBeHidden()

    await page.getByRole('button', { name: 'New download' }).first().click()
    await page.getByRole('menuitem', { name: 'Several links' }).click()
    await expect(close).toBeVisible()
    await close.click()
    await expect(dialog).toBeHidden()
  })

  test('Edit group: Cancel and the close button drop a new name, Done keeps it', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: BLOCK })
    const probe = await lightning.api.probeUrl(origin.url())
    const request: StartDownloadRequest = {
      kind: 'http',
      url: probe.finalUrl,
      destinationDir: lightning.dirs.dest,
      suggestedFileName: 'one.bin',
      totalBytes: probe.totalBytes ?? 0,
      supportsRanges: probe.supportsRanges,
      interfaceIds: ['a'],
      etag: probe.etag,
      lastModified: probe.lastModified
    }
    const { group } = await lightning.api.createGroup({
      name: 'Original',
      destinationDir: lightning.dirs.dest,
      mode: 'manual',
      interfaceIds: ['a'],
      requests: [request]
    })
    const page = lightning.page
    const dialog = page.getByRole('dialog')
    const name = dialog.getByRole('textbox', { name: 'Group name' })
    const edit = page.getByRole('button', { name: `Edit ${group.name}` })
    const groupName = async (): Promise<string> =>
      (await lightning.api.listGroups()).find((entry) => entry.id === group.id)?.name ?? ''

    await edit.click()
    await name.fill('Renamed by Cancel')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect(await groupName()).toBe('Original')

    await edit.click()
    await name.fill('Renamed by Close')
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
    expect(await groupName()).toBe('Original')

    await edit.click()
    await name.fill('Renamed by Done')
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(groupName).toBe('Renamed by Done')
  })
})
