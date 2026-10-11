import { BLOCK, expect, test } from './fixtures'

// A progress line along the bottom of a running row, and only the percentage in the Status cell.

test('a running row has a progress line and a percentage, and Settings can turn the line off @smoke', async ({
  lightning,
  serve
}) => {
  const origin = await serve({ size: 80 * BLOCK, bytesPerSecond: 60_000 })
  await lightning.start(origin.url(), origin.sha256, { fileName: 'line.bin' })
  const page = lightning.page
  const row = page.locator('[data-file-id]').first()
  const line = row.getByRole('progressbar', { name: 'Progress' })
  await expect(line).toBeVisible({ timeout: 15_000 })

  // Along the bottom edge of the row, inside it, and the row's height is the same as any other.
  const [rowBox, lineBox] = await Promise.all([row.boundingBox(), line.boundingBox()])
  expect(Math.abs(lineBox!.y + lineBox!.height - (rowBox!.y + rowBox!.height))).toBeLessThanOrEqual(
    1.5
  )
  expect(lineBox!.width).toBeGreaterThan(rowBox!.width * 0.9)
  expect(lineBox!.height).toBeLessThanOrEqual(4)
  // The cell itself is the percentage.
  await expect(row.getByText(/^\d+%$/)).toBeVisible()
  const first = Number(await line.getAttribute('aria-valuenow'))
  await expect
    .poll(async () => Number(await line.getAttribute('aria-valuenow')))
    .toBeGreaterThan(first)

  // Off: the old bar is back inside the cell, and the line is gone.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Interface', exact: true }).click()
  await page
    .getByRole('checkbox', { name: 'Show a progress line along the bottom of each row' })
    .click()
  await page.keyboard.press('Escape')
  const bar = row.getByRole('progressbar', { name: 'Progress' })
  await expect(bar).toHaveCount(1)
  const barBox = await bar.boundingBox()
  expect(barBox!.width).toBeLessThan(rowBox!.width * 0.5)
  await page.screenshot({ path: '$S/line-off.png' })
})
