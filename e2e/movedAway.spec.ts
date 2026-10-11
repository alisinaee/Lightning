import { BLOCK, expect, interfacesEnv, LAN_ADDRESS, test } from './fixtures'

// A download started on one network and resumed where that network is not (the USB cable stayed
// at work): it carries on over what is connected, instead of waiting for ever.

test.describe('resuming somewhere else @smoke', () => {
  test.skip(!LAN_ADDRESS, 'needs a second local address')
  test.use({
    appEnv: {
      LIGHTNING_E2E_INTERFACES: interfacesEnv({ a: '127.0.0.1', b: LAN_ADDRESS ?? '' })
    }
  })

  test('a download pinned to a network that is gone switches on one that is there', async ({
    lightning,
    serve
  }) => {
    test.setTimeout(90_000)
    const origin = await serve({ size: 40 * BLOCK, bytesPerSecond: 150_000 })
    const id = await lightning.start(origin.url(), origin.sha256, {
      fileName: 'moved.bin',
      networks: ['b']
    })
    await expect
      .poll(async () => (await lightning.byId(id))?.bytesDownloaded ?? 0, { timeout: 20_000 })
      .toBeGreaterThan(0)
    await lightning.api.pauseDownload(id)
    await lightning.waitForStatus('paused')

    // Home: network b is not there any more, a is.
    await lightning.evaluateMain(
      (_electron, value) => {
        process.env['LIGHTNING_E2E_INTERFACES'] = value
      },
      interfacesEnv({ a: '127.0.0.1' })
    )
    await lightning.api.listInterfaces()
    const enabled = async (): Promise<string[]> =>
      ((await lightning.byId(id))?.networks ?? []).filter((n) => n.enabled).map((n) => n.id)
    expect(await enabled()).toEqual(['b'])

    await lightning.api.resumeDownload(id)
    // After a few seconds without any of its networks, the one that is there is switched on.
    await expect.poll(enabled, { timeout: 20_000 }).toContain('a')
    // And it finishes: not stuck.
    await lightning.waitForStatus('completed', 60_000)
  })
})
