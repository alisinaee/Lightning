import { expect, test } from './fixtures'

test('the YouTube options sheet closes from its close button', async ({ lightning }) => {
  const page = lightning.page
  await page.getByRole('button', { name: 'YouTube' }).click()
  await page.getByRole('button', { name: 'YouTube options' }).click()
  const sheet = page.getByRole('dialog', { name: 'YouTube options' })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toBeHidden()
})

test('Downloads, YouTube and Telegram are accordion sections in one side panel, one open at a time', async ({
  lightning
}) => {
  const page = lightning.page
  const panel = page.getByRole('navigation', { name: 'Download categories' })
  const downloads = panel.getByRole('button', { name: 'Downloads', exact: true })
  const youtube = panel.getByRole('button', { name: /^YouTube/ })
  const telegram = panel.getByRole('button', { name: /^Telegram/ })

  await youtube.click()
  await expect(page.getByRole('heading', { name: 'YouTube' })).toBeVisible()
  await expect(youtube).toHaveAttribute('aria-expanded', 'true')
  await expect(downloads).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('button', { name: 'Back to Downloads' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: /^Completed/ })).toBeHidden()

  await telegram.click()
  await expect(telegram).toHaveAttribute('aria-expanded', 'true')
  await expect(youtube).toHaveAttribute('aria-expanded', 'false')

  await downloads.click()
  await expect(downloads).toHaveAttribute('aria-expanded', 'true')
  await expect(telegram).toHaveAttribute('aria-expanded', 'false')
  await expect(panel.getByRole('button', { name: /^Completed/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'YouTube' })).toBeHidden()
})
