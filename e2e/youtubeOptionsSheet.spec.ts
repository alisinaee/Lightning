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

test('YouTube and Downloads share one side panel, with no back button', async ({ lightning }) => {
  const page = lightning.page
  const panel = page.getByRole('navigation', { name: 'Download categories' })
  await panel.getByRole('button', { name: 'YouTube' }).click()
  await expect(page.getByRole('heading', { name: 'YouTube' })).toBeVisible()
  await expect(panel).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back to Downloads' })).toHaveCount(0)
  await panel.getByRole('button', { name: /^Completed/ }).click()
  await expect(page.getByRole('heading', { name: 'YouTube' })).toBeHidden()
})
