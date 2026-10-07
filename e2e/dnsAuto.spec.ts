import { BLOCK, expect, test } from './fixtures'

// The DNS test and Auto DNS, against a local server (its host is an IP, so every DNS leads to the
// same place: what is checked is the plumbing and what the person sees).

test.describe('testing DNS @smoke', () => {
  test('a test tries the system DNS and the well-known ones, and says DNS cannot matter here', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: 32 * BLOCK })
    const result = await lightning.api.testDns(origin.url(), null)
    expect(result.host).toBe('127.0.0.1')
    const names = result.entries.map((entry) => entry.name)
    expect(names).toEqual(
      expect.arrayContaining(['System DNS', 'Electro', 'Shecan', 'Begzar', 'Cloudflare', 'Google'])
    )
    // Every DNS leads to the one address, and the server was measured.
    expect(new Set(result.entries.map((entry) => entry.ip))).toEqual(new Set(['127.0.0.1']))
    expect(result.entries[0].bytesPerSec).toBeGreaterThan(0)
    expect(result.recommendation.kind).toBe('same')
  })

  test('the DNS list offers Auto and the Iranian DNSs, and the test dialog opens from a link', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: 32 * BLOCK })
    const page = lightning.page
    await page.getByRole('button', { name: 'New download' }).first().click()
    await page.getByRole('menuitem', { name: 'One link' }).click()
    await page.getByRole('textbox', { name: 'Link' }).fill(origin.url())

    const picker = page.getByRole('button', { name: 'DNS', exact: true })
    await picker.click()
    await expect(page.getByText('The best DNS found for each site')).toBeVisible()
    // Each DNS says what it is.
    await expect(page.getByText(/Tests a site the first time/)).toBeVisible()
    await expect(page.getByText(/well known with gamers/)).toBeVisible()
    await expect(page.getByText(/blocks sites known to spread malware/)).toBeVisible()
    await expect(page.getByText('Well-known · Iran')).toBeVisible()
    for (const name of ['Electro', 'Shecan', 'Begzar', '403 online', 'Radar']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible()
    }
    await page.getByRole('button', { name: 'Test DNS for this site…' }).click()

    const dialog = page.getByRole('dialog', { name: 'Test DNS for this site' })
    await expect(dialog.getByRole('table', { name: 'DNS test results' })).toBeVisible({
      timeout: 30_000
    })
    await expect(dialog.getByText(/Every DNS leads to the same server/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Use Auto for every site' }).click()
    await expect(dialog).toBeHidden()
    await expect(picker).toContainText('Auto')
  })

  test('a download on Auto DNS has its site tested in the background and remembered', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: 32 * BLOCK })
    await lightning.api.setDefaultDns('auto')
    await lightning.start(origin.url(), origin.sha256)
    await expect
      .poll(async () => (await lightning.api.getDns()).best?.['127.0.0.1']?.name, {
        timeout: 30_000
      })
      .toBe('System DNS')
    await lightning.waitForStatus('completed', 30_000)
  })

  test('resuming a download after Auto was switched on also has its site tested', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: 40 * BLOCK, bytesPerSecond: 40_000 })
    const id = await lightning.start(origin.url(), origin.sha256)
    await lightning.api.pauseDownload(id)
    await lightning.waitForStatus('paused')
    expect((await lightning.api.getDns()).best).toBeUndefined()
    await lightning.api.setDefaultDns('auto')
    await lightning.api.resumeDownload(id)
    await expect
      .poll(async () => (await lightning.api.getDns()).best?.['127.0.0.1']?.name, {
        timeout: 30_000
      })
      .toBe('System DNS')
    await lightning.api.pauseDownload(id)
  })
})
