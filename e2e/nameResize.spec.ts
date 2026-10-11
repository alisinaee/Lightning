import { BLOCK, expect, test } from './fixtures'

// Dragging the divider after Name: it follows the pointer, taking room from the columns to its
// right in turn (and giving it back), instead of stopping when the next column reaches its
// minimum.

test('the Name divider follows the pointer through the other columns @smoke', async ({
  lightning,
  serve
}) => {
  const origin = await serve({ size: 2 * BLOCK })
  await lightning.start(origin.url(), origin.sha256, { fileName: 'a.bin' })
  await lightning.waitForStatus('completed')
  await lightning.electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1300, 700)
  )
  const page = lightning.page
  await page.waitForTimeout(600)
  const handle = page.locator('[role=columnheader]').nth(1).locator('span[aria-hidden]')
  const edges = async (): Promise<{ divider: number; right: number }> => {
    const heads = await page
      .locator('[role=columnheader]')
      .evaluateAll((all) => all.map((head) => head.getBoundingClientRect()))
    // Name is the second header; the last one is the column chooser.
    return { divider: heads[1].right, right: heads[heads.length - 2].right }
  }
  const drag = async (dx: number): Promise<number> => {
    const box = (await handle.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx / 2, y)
    await page.mouse.move(x + dx, y)
    await page.mouse.up()
    await page.waitForTimeout(250)
    return (await handle.boundingBox())!.x - box.x
  }
  const before = await edges()

  // Right, past the point where the next column is as narrow as it goes: the one after gives way.
  const right = await drag(50)
  expect(Math.abs(right - 50)).toBeLessThanOrEqual(2)
  // More than the next column had to give, so the ones after it give some too (all of them are
  // then at their minimum, which is the end of the road).
  const moreRight = await drag(50)
  expect(moreRight).toBeGreaterThan(20)

  // Left again: every drag moves it, and the columns on the right never leave the window.
  const left = await drag(-80)
  expect(Math.abs(left + 80)).toBeLessThanOrEqual(2)
  const moreLeft = await drag(-60)
  expect(moreLeft).toBeLessThan(-30)
  const after = await edges()
  expect(after.right).toBeCloseTo(before.right, 0)
})
