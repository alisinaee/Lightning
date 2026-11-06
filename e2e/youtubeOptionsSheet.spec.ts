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

test('the YouTube section has a way back to Downloads', async ({ lightning }) => {
  const page = lightning.page
  await page.getByRole('button', { name: 'YouTube' }).click()
  await expect(page.getByRole('heading', { name: 'YouTube' })).toBeVisible()
  await page.getByRole('button', { name: 'Downloads', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'YouTube' })).toBeHidden()
})
