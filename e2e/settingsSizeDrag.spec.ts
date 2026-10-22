import { expect, test } from './fixtures'

type SizeShare = { w: number; h: number }

test('dragging the corner of Settings is remembered after closing and reopening', async ({
  lightning
}) => {
  const page = lightning.page
  const dialog = page.getByRole('dialog')
  const settings = page.getByRole('button', { name: 'Settings', exact: true })
  const storedSize = async (): Promise<SizeShare | null> => {
    const raw = await page.evaluate(() => localStorage.getItem('lightning.settingsSize'))
    return raw ? (JSON.parse(raw) as SizeShare) : null
  }
  const dialogSize = (): Promise<[number, number]> =>
    dialog.evaluate((el): [number, number] => {
      const html = el as HTMLElement
      return [html.offsetWidth, html.offsetHeight]
    })
  const windowSize = (): Promise<[number, number]> =>
    page.evaluate((): [number, number] => [window.innerWidth, window.innerHeight])

  await lightning.electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1500, 1000)
  )
  await page.evaluate(() => window.lightning.setZoom(0.9))
  await settings.click()
  await expect(dialog).toBeVisible()
  // Wait for the open animation to settle: two reads of the box in a row must match.
  await expect(async () => {
    const first = await dialog.boundingBox()
    await page.waitForFunction(() => new Promise((r) => requestAnimationFrame(() => r(true))))
    const second = await dialog.boundingBox()
    expect(second).toEqual(first)
  }).toPass({ timeout: 5000 })
  const before = (await dialog.boundingBox())!
  const [beforeW, beforeH] = await dialogSize()
  const [winW, winH] = await windowSize()
  const beforeShare = { w: (beforeW / winW) * 100, h: (beforeH / winH) * 100 }

  await page.mouse.move(before.x + before.width - 4, before.y + before.height - 4)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width + 150, before.y + before.height + 120, { steps: 8 })
  await page.mouse.up()

  // The size is stored after the 300 ms debounce.
  await expect.poll(storedSize).not.toBeNull()
  const stored = (await storedSize())!
  console.log('stored', JSON.stringify(stored))
  expect(stored.h).toBeGreaterThan(beforeShare.h + 2)
  expect(stored.w).toBeGreaterThan(beforeShare.w + 2)

  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
  await settings.click()
  await expect(dialog).toBeVisible()

  // Reopened at the stored share of the app window, within 2 percent.
  await expect(async () => {
    const [w, h] = await dialogSize()
    const [iw, ih] = await windowSize()
    console.log('reopened', w, h, iw, ih)
    expect(Math.abs((w / iw) * 100 - stored.w)).toBeLessThanOrEqual(2)
    expect(Math.abs((h / ih) * 100 - stored.h)).toBeLessThanOrEqual(2)
  }).toPass({ timeout: 5000 })
})
