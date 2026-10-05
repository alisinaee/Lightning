import { BLOCK, expect, test } from './fixtures'

// The downloads table remembers its layout in localStorage (lightning.table). Whatever is saved there,
// a bad value must never blank the window.

const GARBAGE = [
  'not json at all {{{',
  JSON.stringify({
    sort: { key: 'bogus', dir: 'sideways' },
    widths: { name: 'wide', nope: 5 },
    hidden: ['ghost', 7, null]
  }),
  JSON.stringify({ sort: null, widths: [1, 2], hidden: 'name' }),
  JSON.stringify({ hidden: ['name', 'status'], widths: { size: -50, speed: 1e9 } })
]

for (const [index, saved] of GARBAGE.entries()) {
  test(`a bad saved table layout (${index}) still shows the table`, async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: BLOCK })
    await lightning.start(origin.url(), origin.sha256, { fileName: 'kept.bin' })
    await lightning.waitForStatus('completed')
    const { page } = lightning
    await page.evaluate((value) => localStorage.setItem('lightning.table', value), saved)
    await page.reload()
    await expect(page.getByRole('table', { name: 'Downloads' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open kept.bin', exact: true })).toBeVisible()
    await expect(page.getByText('Something went wrong')).toBeHidden()
  })
}
