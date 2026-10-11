import { BLOCK, expect, test } from './fixtures'

// The selection bar offers Remove from list, Delete files and Cancel for what is selected.

test.describe('selection bar actions @smoke', () => {
  test('finished downloads can be removed from the list, or their files deleted, after asking', async ({
    lightning,
    serve
  }) => {
    for (const name of ['one.bin', 'two.bin', 'three.bin']) {
      const origin = await serve({ size: 4 * BLOCK })
      await lightning.start(origin.url(), origin.sha256, { fileName: name })
      await lightning.waitForStatus('completed')
    }
    const page = lightning.page
    await page.getByRole('checkbox', { name: 'Select all downloads' }).click()
    await expect(page.getByText('3 selected')).toBeVisible()

    // Actions the selection allows are there, with how many they apply to.
    const remove = page.getByRole('button', { name: 'Remove from list (3)' })
    await expect(remove).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete files (3)' })).toBeVisible()
    // Nothing is running or unfinished, so there is nothing to cancel, pause or resume.
    await expect(page.getByRole('button', { name: /^Cancel \(/ })).toBeHidden()

    // Asked first, and Keep/Cancel changes nothing.
    await remove.click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('3 selected')).toBeVisible()

    // Removing takes them off the list; the files stay.
    await remove.click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /^Remove/ })
      .click()
    await expect(page.getByText('selected', { exact: false })).toBeHidden()
    await expect.poll(async () => (await lightning.all()).length).toBe(0)
    const names = (await import('node:fs/promises')).readdir(lightning.dirs.dest)
    expect((await names).sort()).toEqual(['one.bin', 'three.bin', 'two.bin'])
  })

  test('failed downloads can be cancelled from the bar', async ({ lightning, serve }) => {
    const origin = await serve({ size: 16 * BLOCK })
    const reached = origin.hold(4 * BLOCK)
    await lightning.start(origin.url(), origin.sha256, { fileName: 'broke.bin' })
    await reached
    origin.setRule(() => ({ status: 500 }))
    origin.release()
    await lightning.waitForStatus('error', 30_000)

    const page = lightning.page
    await page.getByRole('checkbox', { name: 'Select all downloads' }).click()
    const cancel = page.getByRole('button', { name: 'Cancel (1)' })
    await expect(cancel).toBeVisible()
    await cancel.click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /^Cancel|Remove|Stop/ })
      .last()
      .click()
    await expect.poll(async () => (await lightning.all()).length, { timeout: 15_000 }).toBe(0)
  })
})
