import { expect, test } from './fixtures'

// The Settings window keeps the size the person gave it, as a share of the app window.

test('Settings reopens at the size it was left at, in percent of the app window', async ({
  lightning
}) => {
  const page = lightning.page
  const dialog = page.getByRole('dialog')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(dialog).toBeVisible()

  // What dragging the corner does: the browser writes the new size onto the element.
  await dialog.evaluate((element) => {
    element.style.width = '80vw'
    element.style.height = '75vh'
  })
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('lightning.settingsSize')))
    .not.toBeNull()
  const saved = JSON.parse(
    (await page.evaluate(() => localStorage.getItem('lightning.settingsSize'))) ?? '{}'
  ) as { w: number; h: number }
  expect(saved.w).toBeGreaterThan(70)

  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const box = await dialog.boundingBox()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(Math.abs(((box?.width ?? 0) / viewport.width) * 100 - saved.w)).toBeLessThan(2)
  expect(Math.abs(((box?.height ?? 0) / viewport.height) * 100 - saved.h)).toBeLessThan(2)
})
