import { expect, test } from './fixtures'

/*
 * A page left blocked (pointer-events: none on the body, or inert on the root) with nothing open
 * is put right by the click guard, which says so in the console.
 */
test('a page blocked with nothing open is released', async ({ lightning }) => {
  const { page } = lightning
  const warnings: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text())
  })
  await page.evaluate(() => {
    document.body.style.pointerEvents = 'none'
    document.getElementById('root')?.setAttribute('inert', '')
  })
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents), {
      timeout: 15_000
    })
    .not.toBe('none')
  expect(await page.evaluate(() => document.getElementById('root')?.hasAttribute('inert'))).toBe(
    false
  )
  expect(warnings.some((text) => text.startsWith('Click guard:'))).toBe(true)
})

test('an open dialog may block the page behind it', async ({ lightning }) => {
  const { page } = lightning
  await page
    .getByRole('button', { name: /settings/i })
    .first()
    .click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.evaluate(() => (document.body.style.pointerEvents = 'none'))
  await page.waitForTimeout(7000)
  expect(await page.evaluate(() => document.body.style.pointerEvents)).toBe('none')
})
