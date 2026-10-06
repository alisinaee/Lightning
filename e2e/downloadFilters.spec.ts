import type { Locator } from '@playwright/test'
import { BLOCK, expect, test } from './fixtures'

test('download filters show live counts, retain the filter, and clear hidden selections', async ({
  lightning,
  serve
}) => {
  const finished = await serve({ size: BLOCK })
  await lightning.start(finished.url(), finished.sha256, { fileName: 'finished.bin' })
  await lightning.waitForStatus('completed')

  const failed = await serve({ size: 16 * BLOCK })
  const reached = failed.hold(4 * BLOCK)
  const failedId = await lightning.start(failed.url(), failed.sha256, { fileName: 'failed.bin' })
  await reached
  failed.setRule(() => ({ status: 403 }))
  failed.release()
  await lightning.waitForStatus('error', 30_000)

  const paused = await serve({ size: 16 * BLOCK })
  const pausedReached = paused.hold(4 * BLOCK)
  const pausedId = await lightning.start(paused.url(), paused.sha256, { fileName: 'paused.bin' })
  await pausedReached
  await lightning.api.pauseDownload(pausedId)
  paused.release()
  await lightning.waitForStatus('paused')

  const page = lightning.page
  const side = page.getByRole('navigation', { name: 'Download categories' })
  const cat = (name: string): Locator => side.getByRole('button', { name: new RegExp(`^${name}`) })

  await expect(cat('All downloads')).toBeVisible()
  await expect(cat('Paused')).toBeVisible()
  await expect(cat('Completed')).toBeVisible()
  await expect(cat('Failed')).toBeVisible()

  await cat('Paused').click()
  await expect(cat('Paused')).toHaveAttribute('aria-current', 'true')
  await expect(page.getByRole('button', { name: 'Open paused.bin', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open finished.bin', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Open failed.bin', exact: true })).toBeHidden()

  await page.getByRole('button', { name: 'Open paused.bin', exact: true }).click()
  await page.getByRole('button', { name: 'Downloads', exact: true }).click()
  await expect(cat('Paused')).toHaveAttribute('aria-current', 'true')
  await page.getByRole('checkbox', { name: 'Select paused.bin', exact: true }).check()
  await expect(page.getByRole('toolbar', { name: 'Selected downloads' })).toBeVisible()
  await page.getByRole('button', { name: 'Deselect all', exact: true }).click()

  await cat('Completed').click()
  await expect(page.getByText('1 selected', { exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Open finished.bin', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open paused.bin', exact: true })).toBeHidden()

  await cat('Failed').click()
  await expect(page.getByRole('button', { name: 'Open failed.bin', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fix link', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Fix link', exact: true }).click()
  const fixLink = page.getByRole('dialog', { name: 'Paste a new link', exact: true })
  await expect(fixLink.getByRole('button', { name: 'Close', exact: true })).toHaveCount(1)
  await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 5, y: 5 } })
  await expect(fixLink).toBeVisible()
  await fixLink.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(fixLink).toBeHidden()

  await lightning.api.removeDownload(failedId)
  await expect(page.getByText('No downloads need attention', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Show all downloads', exact: true }).click()
  await expect(cat('All downloads')).toHaveAttribute('aria-current', 'true')
  await expect(page.getByRole('button', { name: 'Open finished.bin', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open paused.bin', exact: true })).toBeVisible()
})
