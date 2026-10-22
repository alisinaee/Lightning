import { expect, test } from './fixtures'

test('dragging the corner of Settings is remembered after closing and reopening', async ({
  lightning
}) => {
  const page = lightning.page
  await lightning.electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1500, 1000)
  )
  await page.evaluate(() => window.lightning.setZoom(0.9))
  await page.waitForTimeout(400)
  const dialog = page.getByRole('dialog')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(dialog).toBeVisible()
  const before = (await dialog.boundingBox())!
  await page.mouse.move(before.x + before.width - 4, before.y + before.height - 4)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width + 150, before.y + before.height + 120, { steps: 8 })
  await page.mouse.up()
  const dragged = (await dialog.boundingBox())!
  expect(dragged.height).toBeGreaterThan(before.height + 60)
  await page.waitForTimeout(800)
  console.log('stored', await page.evaluate(() => localStorage.getItem('lightning.settingsSize')))
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(dialog).toBeVisible()
  await page.waitForTimeout(500)
  const after = (await dialog.boundingBox())!
  console.log(
    'sizes',
    before.width,
    before.height,
    dragged.width,
    dragged.height,
    after.width,
    after.height
  )
  expect(after.height).toBeGreaterThan(before.height + 50)
  expect(after.width).toBeGreaterThan(before.width + 100)
})
