import { BLOCK, expect, test } from './fixtures'

// The text size (Settings → Appearance) must not move popups off what they point at, or crop the
// page: it is Electron's zoom, so the page's coordinates stay the pointer's.

test.describe('tooltips and text size @smoke', () => {
  for (const zoom of [1, 0.9, 1.1]) {
    test(`a hint sits on its button at text size ${zoom}`, async ({ lightning, serve }) => {
      const origin = await serve({ size: 60 * BLOCK, bytesPerSecond: 20000 })
      await lightning.start(origin.url(), origin.sha256, { fileName: 'tip.bin', networks: ['a'] })
      const page = lightning.page
      await page.evaluate((z) => window.lightning.setZoom(z), zoom)

      // The page still fits its window: nothing cropped or left blank.
      const fit = async (): Promise<{ page: number; window: number }> => ({
        page: await page.evaluate((z) => Math.round(window.innerWidth * z), zoom),
        window: (
          await lightning.electronApp.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].getContentSize()
          )
        )[0]
      })
      await expect
        .poll(async () => Math.abs((await fit()).page - (await fit()).window))
        .toBeLessThan(3)

      const button = page.getByRole('button', { name: /^Pause tip\.bin/ })
      await button.scrollIntoViewIfNeeded()
      await button.hover({ timeout: 10_000 })
      const tip = page.locator('[data-slot="tooltip-content"]')
      await expect(tip).toBeVisible()
      const [b, t] = await Promise.all([button.boundingBox(), tip.boundingBox()])
      expect(Math.abs(b!.x + b!.width / 2 - (t!.x + t!.width / 2))).toBeLessThan(30)
      expect(Math.abs(t!.y + t!.height - b!.y)).toBeLessThan(24)
    })
  }
})
