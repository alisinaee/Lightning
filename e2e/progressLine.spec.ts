import type { StartDownloadRequest } from '../src/shared/types'
import { BLOCK, expect, test, type LightningApp } from './fixtures'
import type { Origin } from './origin'

// A progress line along the bottom of a running row, and only the percentage in the Status cell.

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
  // It starts exactly where the title text starts, and runs to the right edge.
  const titleBox = await row.locator('[data-title]').boundingBox()
  expect(Math.abs(lineBox!.x - titleBox!.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(lineBox!.x + lineBox!.width - (rowBox!.x + rowBox!.width))).toBeLessThanOrEqual(2)
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
})

test('a group header and a file in it each start their line at their own title', async ({
  lightning,
  serve
}) => {
  const origin = await serve({ size: 80 * BLOCK, bytesPerSecond: 40_000 })
  const { group } = await lightning.api.createGroup({
    name: 'Lines',
    destinationDir: lightning.dirs.dest,
    mode: 'manual',
    interfaceIds: ['a'],
    requests: [await request(lightning, origin, 'grouped.bin')]
  })
  const page = lightning.page
  const header = page.locator(`[data-group="${group.id}"]`)
  await page.getByRole('button', { name: 'Show files in Lines' }).click()
  const file = page.locator('[data-file-id]').first()

  const headerLine = header.getByRole('progressbar', { name: 'Progress' })
  const fileLine = file.getByRole('progressbar', { name: 'Progress' })
  await expect(headerLine).toBeVisible({ timeout: 15_000 })
  await expect(fileLine).toBeVisible({ timeout: 15_000 })

  // Each line starts at its own row's title, and the two titles are not at the same place.
  const edges: number[] = []
  for (const [row, line] of [
    [header, headerLine],
    [file, fileLine]
  ] as const) {
    const [titleBox, lineBox] = await Promise.all([
      row.locator('[data-title]').boundingBox(),
      line.boundingBox()
    ])
    expect(Math.abs(lineBox!.x - titleBox!.x)).toBeLessThanOrEqual(2)
    edges.push(titleBox!.x)
  }
  expect(Math.abs(edges[0] - edges[1])).toBeGreaterThan(4)
})
