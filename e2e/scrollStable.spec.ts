import type { StartDownloadRequest } from '../src/shared/types'
import { BLOCK, expect, test } from './fixtures'

// With downloads running (progress arrives several times a second) the list must stay where the
// person scrolled it.

test('the list does not jump while downloads run @smoke', async ({ lightning, serve }) => {
  test.setTimeout(120_000)
  for (let index = 0; index < 28; index++) {
    const origin = await serve({ size: 2 * BLOCK })
    await lightning.start(origin.url(), origin.sha256, { fileName: `done-${index}.bin` })
  }
  await expect
    .poll(async () => (await lightning.all()).filter((s) => s.status === 'completed').length, {
      timeout: 60_000
    })
    .toBe(28)
  // Two that keep running for the whole test.
  for (const name of ['run-a.bin', 'run-b.bin']) {
    const origin = await serve({ size: 80 * BLOCK, bytesPerSecond: 40_000 })
    await lightning.start(origin.url(), origin.sha256, { fileName: name })
  }
  const page = lightning.page
  const list = page.locator('[role="rowgroup"]').first()
  await expect(page.getByText('run-a.bin').first()).toBeVisible()

  await list.evaluate((element) => element.scrollTo({ top: 700 }))
  await page.waitForTimeout(500)
  const start = await list.evaluate((element) => element.scrollTop)
  expect(start).toBeGreaterThan(300)

  // Several seconds of progress updates, the scroll position sampled throughout.
  const seen: number[] = []
  for (let tick = 0; tick < 12; tick++) {
    await page.waitForTimeout(500)
    seen.push(await list.evaluate((element) => element.scrollTop))
  }
  for (const position of seen) expect(Math.abs(position - start)).toBeLessThanOrEqual(2)
})

test('a group that is scrolled does not shift as its files finish @smoke', async ({
  lightning,
  serve
}) => {
  test.setTimeout(120_000)
  const requests: StartDownloadRequest[] = []
  // Some finish at once; some run for a few seconds and finish while the group is being scrolled.
  for (let index = 0; index < 26; index++) {
    const runner = index % 3 === 0
    const origin = await serve(
      runner ? { size: 6 * BLOCK, bytesPerSecond: 90_000 } : { size: 2 * BLOCK }
    )
    const probe = await lightning.api.probeUrl(origin.url())
    requests.push({
      kind: 'http',
      url: probe.finalUrl,
      destinationDir: lightning.dirs.dest,
      suggestedFileName: `file-${String(index).padStart(2, '0')}.bin`,
      totalBytes: probe.totalBytes ?? 0,
      supportsRanges: probe.supportsRanges,
      interfaceIds: ['a'],
      etag: probe.etag,
      lastModified: probe.lastModified
    })
  }
  await lightning.api.createGroup({
    name: 'Scrolled',
    destinationDir: lightning.dirs.dest,
    mode: 'manual',
    maxAtOnce: 6,
    interfaceIds: ['a'],
    requests
  })
  const page = lightning.page
  await page.getByRole('button', { name: 'Show files in Scrolled' }).click()
  const list = page.locator('[role="rowgroup"]').first()
  await expect(page.getByText('file-25.bin')).toBeVisible({ timeout: 20_000 })
  await list.evaluate((element) => element.scrollTo({ top: 520 }))
  await page.waitForTimeout(400)

  // A file that is already finished, somewhere in view: where it sits on screen is watched.
  const anchor = page.getByRole('button', { name: 'Open file-04.bin' })
  await expect(anchor).toBeVisible()
  const top = async (): Promise<number> => (await anchor.boundingBox())!.y
  const start = await top()
  const moved: number[] = []
  for (let tick = 0; tick < 16; tick++) {
    await page.waitForTimeout(500)
    // Where the row is on screen: that is what the person sees stay put.
    moved.push(Math.abs((await top()) - start))
  }
  expect(Math.max(...moved)).toBeLessThanOrEqual(2)
  await expect
    .poll(async () => (await lightning.all()).filter((s) => s.status === 'completed').length, {
      timeout: 60_000
    })
    .toBe(26)
})
