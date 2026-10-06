import type { StartDownloadRequest } from '../src/shared/types'
import { BLOCK, expect, interfacesEnv, LAN_ADDRESS, test } from './fixtures'
import { seededBytes } from './origin'

// What a person does when downloads fail: the top bar's one button retries them, and a group can
// try its failed files again — including one that can't continue because the file on the server
// is no longer the one that was probed.

test.describe('retrying failures @smoke', () => {
  test('with only failures left, the top bar button retries them', async ({ lightning, serve }) => {
    const origin = await serve({ size: 16 * BLOCK })
    const reached = origin.hold(4 * BLOCK)
    await lightning.start(origin.url(), origin.sha256, { fileName: 'flaky.bin' })
    await reached
    origin.setRule(() => ({ status: 500 }))
    origin.release()
    await lightning.waitForStatus('error', 30_000)

    const page = lightning.page
    // Not "Pause all", which would do nothing: nothing is running.
    await expect(page.getByRole('button', { name: 'Pause all' })).toBeHidden()
    const retry = page.getByRole('button', { name: 'Retry all failed' })
    await expect(retry).toBeEnabled()

    origin.setRule(() => 'ok')
    await retry.click()
    await lightning.waitForStatus('completed', 30_000)
  })

  test('a group retries a file that changed on the server by starting it over', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: 4 * BLOCK, seed: 1, etag: '"v1"' })
    const probe = await lightning.api.probeUrl(origin.url())
    const request: StartDownloadRequest = {
      kind: 'http',
      url: probe.finalUrl,
      destinationDir: lightning.dirs.dest,
      suggestedFileName: 'moved.bin',
      totalBytes: probe.totalBytes ?? 0,
      supportsRanges: probe.supportsRanges,
      interfaceIds: ['a'],
      etag: probe.etag,
      lastModified: probe.lastModified
    }
    // What the probe saw is no longer what the server has (a different size, as when a VPN or a
    // proxy answered the probe differently from the server itself).
    origin.setContent(seededBytes(6 * BLOCK, 2), '"v2"')
    const { group } = await lightning.api.createGroup({
      name: 'Changed',
      destinationDir: lightning.dirs.dest,
      mode: 'manual',
      interfaceIds: ['a'],
      requests: [request]
    })
    const failed = await lightning.waitForStatus('error', 30_000)
    expect(failed.error).toMatch(/changed during the download/)
    expect(failed.resumable).toBe(false)

    const page = lightning.page
    const retry = page.getByRole('button', { name: `Retry failed in ${group.name}` })
    await expect(retry).toBeVisible()
    await retry.click()
    // Started over from a fresh look at the link: the new size, and no error.
    const done = await lightning.waitForStatus('completed', 30_000)
    expect(done.totalBytes).toBe(6 * BLOCK)
  })
})

test.describe('looking at a link goes out on a real network @smoke', () => {
  test.skip(!LAN_ADDRESS, 'needs a second local address')
  test.use({ appEnv: { LIGHTNING_E2E_INTERFACES: interfacesEnv({ b: LAN_ADDRESS ?? '' }) } })

  test('the probe leaves from the selected network, not the default route', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: 4 * BLOCK })
    await lightning.api.probeUrl(origin.url())
    // With the default route the server would see 127.0.0.1; a bound probe arrives from the network.
    expect(origin.log.length).toBeGreaterThan(0)
    expect(new Set(origin.log.map((entry) => entry.from))).toEqual(new Set([LAN_ADDRESS]))
  })
})

test.describe('a network that has only just come back @smoke', () => {
  test.skip(!LAN_ADDRESS, 'needs a second local address')
  test.use({
    appEnv: {
      LIGHTNING_E2E_INTERFACES: interfacesEnv({ a: '127.0.0.1' }),
      LIGHTNING_E2E_NETWORK_STABLE_MS: '5000'
    }
  })

  test('gets no new file in an Auto group until it has stayed up a while', async ({
    lightning,
    serve
  }) => {
    const requests: StartDownloadRequest[] = []
    for (const name of ['one.bin', 'two.bin', 'three.bin']) {
      const origin = await serve({ size: 40 * BLOCK, bytesPerSecond: 20_000 })
      const probe = await lightning.api.probeUrl(origin.url())
      requests.push({
        kind: 'http',
        url: probe.finalUrl,
        destinationDir: lightning.dirs.dest,
        suggestedFileName: name,
        totalBytes: probe.totalBytes ?? 0,
        supportsRanges: probe.supportsRanges,
        interfaceIds: ['a', 'b'],
        etag: probe.etag,
        lastModified: probe.lastModified
      })
    }
    await lightning.api.createGroup({
      name: 'Flaky',
      destinationDir: lightning.dirs.dest,
      mode: 'auto',
      interfaceIds: ['a', 'b'],
      requests
    })
    const running = async (): Promise<number> =>
      (await lightning.all()).filter((state) => state.status === 'downloading').length
    await expect.poll(running, { timeout: 15_000 }).toBe(1)

    // The second network appears. For a moment it is not trusted: no second file starts.
    await lightning.evaluateMain(
      (_electron, value) => {
        process.env['LIGHTNING_E2E_INTERFACES'] = value
      },
      interfacesEnv({ a: '127.0.0.1', b: LAN_ADDRESS ?? '' })
    )
    await lightning.api.listInterfaces()
    await lightning.page.waitForTimeout(2500)
    expect(await running()).toBe(1)

    // Once it has stayed up, it takes a file of its own.
    await expect.poll(running, { timeout: 20_000 }).toBe(2)
  })
})
