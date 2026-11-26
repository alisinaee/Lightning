import { expect, test } from './fixtures'

test('the YouTube options sheet closes from its close button', async ({ lightning }) => {
  const page = lightning.page
  await page.getByRole('tab', { name: /^YouTube/ }).click()
  await page.getByRole('button', { name: 'YouTube options' }).click()
  const sheet = page.getByRole('dialog', { name: 'YouTube options' })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toBeHidden()
})

test('Downloads, YouTube and Telegram are tabs in one side panel, one chosen at a time', async ({
  lightning
}) => {
  const page = lightning.page
  const panel = page.getByRole('navigation', { name: 'Download categories' })
  const downloads = panel.getByRole('tab', { name: /^Downloads/ })
  const youtube = panel.getByRole('tab', { name: /^YouTube/ })
  const telegram = panel.getByRole('tab', { name: /^Telegram/ })

  await youtube.click()
  await expect(page.getByRole('heading', { name: 'YouTube' })).toBeAttached()
  await expect(youtube).toHaveAttribute('aria-selected', 'true')
  await expect(downloads).toHaveAttribute('aria-selected', 'false')
  await expect(panel.getByRole('button', { name: /^Completed/ })).toBeHidden()

  await telegram.click()
  await expect(telegram).toHaveAttribute('aria-selected', 'true')
  await expect(youtube).toHaveAttribute('aria-selected', 'false')

  await downloads.click()
  await expect(downloads).toHaveAttribute('aria-selected', 'true')
  await expect(telegram).toHaveAttribute('aria-selected', 'false')
  await expect(panel.getByRole('button', { name: /^Completed/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'YouTube' })).toHaveCount(0)
})
