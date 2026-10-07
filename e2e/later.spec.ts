import type { StartDownloadRequest } from '../src/shared/types'
import { BLOCK, expect, test } from './fixtures'
import type { Origin } from './origin'

// "Download later": the files are added and nothing starts until the person starts them.

test.describe('download later @smoke', () => {
  test('several links added for later wait, then start with the group’s Start button', async ({
    lightning,
    serve,
    dirs
  }) => {
    const names = ['one.bin', 'two.bin']
    const origins: Origin[] = []
    for (const name of names) {
      origins.push(
        await serve({ size: 4 * BLOCK, contentDisposition: `attachment; filename="${name}"` })
      )
    }
    await lightning.evaluateMain(({ dialog }, dest) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dest] })) as never
    }, dirs.dest)
    const page = lightning.page
    await page.getByRole('button', { name: 'New download' }).first().click()
    await page.getByRole('menuitem', { name: 'Several links' }).click()
    await page.getByRole('textbox', { name: 'Links' }).fill(origins.map((o) => o.url()).join('\n'))
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: /^Continue with/ }).click()
    await page.getByRole('textbox', { name: 'Folder name' }).fill('Later')
    await page.getByRole('button', { name: 'Download later' }).click()

    const start = page.getByRole('button', { name: 'Start Later' })
    await expect(start).toBeVisible()
    // Nothing runs while it waits.
    await page.waitForTimeout(2500)
    expect((await lightning.all()).filter((state) => state.status === 'downloading')).toHaveLength(
      0
    )
    const groups = await lightning.api.listGroups()
    expect(groups[0].held).toBe(true)
    expect(groups[0].pending.length + (await lightning.all()).length).toBe(2)

    await start.click()
    await expect(start).toBeHidden()
    await expect
      .poll(async () => (await lightning.all()).filter((s) => s.status === 'completed').length, {
        timeout: 30_000
      })
      .toBe(2)
    expect((await lightning.api.listGroups())[0].held).toBeUndefined()
  })

  test('a manual group added for later is paused until it is started', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: 4 * BLOCK })
    const probe = await lightning.api.probeUrl(origin.url())
    const request: StartDownloadRequest = {
      kind: 'http',
      url: probe.finalUrl,
      destinationDir: lightning.dirs.dest,
      suggestedFileName: 'later.bin',
      totalBytes: probe.totalBytes ?? 0,
      supportsRanges: probe.supportsRanges,
      interfaceIds: ['a'],
      etag: probe.etag,
      lastModified: probe.lastModified
    }
    const { group } = await lightning.api.createGroup({
      name: 'Manual later',
      destinationDir: lightning.dirs.dest,
      mode: 'manual',
      interfaceIds: ['a'],
      requests: [request],
      startLater: true
    })
    const paused = await lightning.waitForStatus('paused')
    expect(paused.fileName).toBe('later.bin')
    await lightning.page.waitForTimeout(1000)
    expect((await lightning.all()).every((state) => state.status === 'paused')).toBe(true)
    await lightning.page.getByRole('button', { name: `Start ${group.name}` }).click()
    await lightning.waitForStatus('completed', 30_000)
  })
})
