import type { StartDownloadRequest } from '../src/shared/types'
import { BLOCK, expect, test } from './fixtures'

// A group holding a finished and a failed file: the sidebar counts files, a status shows only the
// files in it, and search opens the group and finds the file inside.

test('counts, filters and search follow the files of a group @smoke', async ({
  lightning,
  serve
}) => {
  const good = await serve({ size: 4 * BLOCK })
  const bad = await serve({ size: 4 * BLOCK })
  const requests: StartDownloadRequest[] = []
  for (const [name, origin] of [
    ['finished-one.bin', good],
    ['broken-one.bin', bad]
  ] as const) {
    const probe = await lightning.api.probeUrl(origin.url())
    requests.push({
      kind: 'http',
      url: probe.finalUrl,
      destinationDir: lightning.dirs.dest,
      suggestedFileName: name,
      totalBytes: probe.totalBytes ?? 0,
      supportsRanges: probe.supportsRanges,
      interfaceIds: ['a'],
      etag: probe.etag,
      lastModified: probe.lastModified
    })
  }
  // The second file's server refuses once the group starts.
  bad.setRule(() => ({ status: 500 }))
  await lightning.api.createGroup({
    name: 'Mixed',
    destinationDir: lightning.dirs.dest,
    mode: 'manual',
    interfaceIds: ['a'],
    requests
  })
  const page = lightning.page
  const sidebar = page.getByRole('navigation').first()
  const count = async (label: string): Promise<string> =>
    (await sidebar.getByRole('button', { name: new RegExp(`^${label}`) }).innerText())
      .replace(/\D+/g, ' ')
      .trim()

  // One finished file and one failed file: 1 and 1, not "1 group".
  await expect.poll(() => count('Completed'), { timeout: 30_000 }).toBe('1')
  await expect.poll(() => count('Failed'), { timeout: 60_000 }).toBe('1')
  expect(await count('All downloads')).toBe('2')

  // A status lists the group opened, with only the files in it.
  await sidebar.getByRole('button', { name: /^Failed/ }).click()
  await expect(page.getByText('broken-one.bin').first()).toBeVisible()
  await expect(page.getByText('finished-one.bin')).toBeHidden()

  await sidebar.getByRole('button', { name: /^All downloads/ }).click()
  await page.getByRole('searchbox', { name: 'Search downloads' }).fill('finished')
  // The group opens by itself and shows the file the search found, and only that one.
  await expect(page.getByText('finished-one.bin').first()).toBeVisible()
  await expect(page.getByText('broken-one.bin')).toBeHidden()
  await expect(page.getByText('1/1')).toBeVisible()
})
