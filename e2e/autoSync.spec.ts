import { rename, unlink } from 'node:fs/promises'
import type { Locator, Page } from '@playwright/test'
import { BLOCK, expect, test } from './fixtures'

// Auto sync: a finished download whose file is moved or deleted leaves the list by itself. Only
// the record goes; the files are never touched. Sync runs at start, every 5 s and on focus.

const rowButton = (page: Page, name: string): Locator =>
  page.getByRole('button', { name: `Open ${name}`, exact: true })

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

test.describe('auto sync of finished downloads @smoke', () => {
  test('on by default: a finished download whose file is deleted leaves the list', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: BLOCK })
    await lightning.start(origin.url(), origin.sha256, { fileName: 'auto-gone.bin' })
    const complete = await lightning.waitForStatus('completed')
    await expect(rowButton(lightning.page, 'auto-gone.bin')).toBeVisible()

    await unlink(complete.destinationPath)
    await expect(rowButton(lightning.page, 'auto-gone.bin')).toHaveCount(0, { timeout: 20_000 })
    await expect(lightning.page.getByText('File missing', { exact: true })).toHaveCount(0)
    expect(await lightning.byId(complete.id)).toBeNull()
  })

  test('off: the entry stays and shows File missing', async ({ lightning, serve }) => {
    await lightning.api.updateSettings({ prefs: { autoSyncFiles: false } })
    const origin = await serve({ size: BLOCK })
    await lightning.start(origin.url(), origin.sha256, { fileName: 'kept-missing.bin' })
    const complete = await lightning.waitForStatus('completed')

    await rename(complete.destinationPath, `${complete.destinationPath}.moved`)
    await lightning.page.reload()
    await expect(rowButton(lightning.page, 'kept-missing.bin')).toBeVisible()
    await expect(lightning.page.getByText('File missing', { exact: true }).first()).toBeVisible()
    // Two checks' worth of time pass: the row is still there.
    await pause(11_000)
    await expect(rowButton(lightning.page, 'kept-missing.bin')).toBeVisible()
    await rename(`${complete.destinationPath}.moved`, complete.destinationPath)
  })

  test('a download kept after its file was removed stays in the list', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: BLOCK })
    await lightning.start(origin.url(), origin.sha256, { fileName: 'kept-entry.bin' })
    const complete = await lightning.waitForStatus('completed')

    // Removed from the list but kept as a record: the file itself is not trashed here. Moved
    // rather than deleted, so the fixture's final checks can still read the bytes.
    await lightning.api.removeDownload(complete.id, { keepEntry: true })
    await rename(complete.destinationPath, `${complete.destinationPath}.moved`)
    await lightning.page.reload()
    await expect(lightning.page.getByText('File missing', { exact: true }).first()).toBeVisible({
      timeout: 20_000
    })
    await pause(11_000)
    await expect(rowButton(lightning.page, 'kept-entry.bin')).toBeVisible()
    await expect(lightning.page.getByText('File missing', { exact: true }).first()).toBeVisible()
    await rename(`${complete.destinationPath}.moved`, complete.destinationPath)
  })
})
