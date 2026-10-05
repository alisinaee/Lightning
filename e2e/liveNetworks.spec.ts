import {
  BLOCK,
  expect,
  interfacesEnv,
  LAN_ADDRESS,
  NETWORKS,
  test,
  type LightningApp
} from './fixtures'
import type { LoggedRequest } from './origin'
import type { DownloadState } from '../src/shared/types'

// O. Networks that come, go, and are switched on and off while a download runs.

/** What the computer's networks are now, as the app will see them at its next look. */
const setNetworks = (lightning: LightningApp, networks: Record<string, string>): Promise<void> =>
  lightning.evaluateMain((_electron, value) => {
    process.env['LIGHTNING_E2E_INTERFACES'] = value
  }, interfacesEnv(networks))

const overB = (request: Pick<LoggedRequest, 'from'>): boolean => request.from !== '127.0.0.1'
const network = (state: DownloadState, id: string): DownloadState['networks'][number] | undefined =>
  state.networks.find((entry) => entry.id === id)
const streamsOn = (state: DownloadState, id: string): number =>
  state.kind === 'http' ? state.streams.filter((stream) => stream.interfaceId === id).length : 0
const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

test('the only network drops for a while: the download waits, then picks up where it was @smoke', async ({
  lightning,
  serve
}) => {
  const origin = await serve({ size: 64 * BLOCK, bytesPerSecond: 256 * 1024 })
  await lightning.start(origin.url(), origin.sha256)
  await lightning.waitUntil((state) => state.bytesDownloaded > 0)

  await setNetworks(lightning, {})
  await lightning.waitUntil((state) => network(state, 'a')?.status === 'offline')
  const gone = (await lightning.currentHttp())!
  // Far longer than a stream's retries used to last before the download failed and its
  // progress was thrown away (five of them, 20 ms apart and doubling, in these tests).
  await settle(1500)
  const waited = (await lightning.currentHttp())!
  expect(waited.status).toBe('downloading')
  expect(waited.streams).toHaveLength(0)
  expect(waited.bytesDownloaded, 'nothing it had was lost').toBe(gone.bytesDownloaded)

  await setNetworks(lightning, { a: NETWORKS['a'] })
  await lightning.waitForHttpStatus('completed')
})

test.describe('two networks @smoke', () => {
  test.skip(!LAN_ADDRESS, 'needs a LAN address to act as the second network')

  test('a network that drops out and comes back is used again', async ({ lightning, serve }) => {
    const origin = await serve({ size: 128 * BLOCK, bytesPerSecond: 256 * 1024 })
    await lightning.start(origin.url(), origin.sha256, { networks: ['a', 'b'], connections: 2 })
    await lightning.waitUntil((state) => (network(state, 'b')?.bytesDownloaded ?? 0) > 0)

    await setNetworks(lightning, { a: NETWORKS['a'] })
    const gone = await lightning.waitUntil(
      (state) => network(state, 'b')?.status === 'offline' && streamsOn(state, 'b') === 0
    )
    expect(network(gone, 'b')?.enabled, 'still the user’s pick').toBe(true)
    const goneAt = origin.log.length

    await setNetworks(lightning, NETWORKS)
    await lightning.waitForHttpStatus('completed')
    expect(origin.log.slice(goneAt).some(overB), 'b carried more once it was back').toBe(true)
  })

  test('a network that turns up mid-download is listed off; it carries traffic only while switched on', async ({
    lightning,
    serve
  }) => {
    await setNetworks(lightning, { a: NETWORKS['a'] })
    const origin = await serve({ size: 128 * BLOCK, bytesPerSecond: 256 * 1024 })
    const id = await lightning.start(origin.url(), origin.sha256, { connections: 2 })
    await lightning.waitUntil((state) => state.bytesDownloaded > 0)
    expect(network((await lightning.currentHttp())!, 'b')).toBeUndefined()

    await setNetworks(lightning, NETWORKS)
    const listed = await lightning.waitUntil((state) => network(state, 'b') !== undefined)
    expect(network(listed, 'b')).toMatchObject({ enabled: false, status: 'off' })
    await settle(500)
    expect(origin.chunkRequests().some(overB), 'not used until switched on').toBe(false)

    await lightning.api.setDownloadNetwork(id, 'b', true)
    await lightning.waitUntil((state) => (network(state, 'b')?.bytesDownloaded ?? 0) > 0)

    await lightning.api.setDownloadNetwork(id, 'b', false)
    const off = await lightning.waitUntil((state) => streamsOn(state, 'b') === 0)
    expect(network(off, 'b')).toMatchObject({ enabled: false, status: 'off' })
    expect(network(off, 'b')!.bytesDownloaded, 'what it delivered stays its own').toBeGreaterThan(0)
    const offAt = origin.log.length

    await settle(500)
    expect(origin.log.slice(offAt).some(overB), 'nothing over b while it is off').toBe(false)

    // Switching off the last network in use pauses the download; switching it back on resumes it.
    await lightning.api.setDownloadNetwork(id, 'a', false)
    const paused = await lightning.waitUntil((state) => state.status === 'paused')
    expect(network(paused, 'a')?.enabled).toBe(false)
    const pausedAt = origin.log.length
    await settle(500)
    expect(origin.log.length, 'nothing requested while every network is off').toBe(pausedAt)

    await lightning.api.setDownloadNetwork(id, 'a', true)
    await lightning.waitUntil(
      (state) => state.status === 'downloading' && streamsOn(state, 'a') > 0
    )

    // Resumed with none on, it switches back on the one switched off last.
    await lightning.api.setDownloadNetwork(id, 'a', false)
    await lightning.waitUntil((state) => state.status === 'paused')
    await lightning.api.resumeDownload(id)
    const resumed = await lightning.waitUntil((state) => state.status === 'downloading')
    expect(network(resumed, 'a')?.enabled).toBe(true)
  })

  test('switching the last network off and on quickly ends up where it was left', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: 128 * BLOCK, bytesPerSecond: 256 * 1024 })
    const id = await lightning.start(origin.url(), origin.sha256, { connections: 2 })
    await lightning.waitUntil((state) => state.bytesDownloaded > 0)

    // Back on before the pause has wound down: it resumes.
    const off = lightning.api.setDownloadNetwork(id, 'a', false)
    await lightning.api.setDownloadNetwork(id, 'a', true)
    await off
    await lightning.waitUntil(
      (state) => state.status === 'downloading' && streamsOn(state, 'a') > 0
    )

    // Off, on and off again before the resume has got going: it stays paused.
    await lightning.api.setDownloadNetwork(id, 'a', false)
    await lightning.waitUntil((state) => state.status === 'paused')
    await lightning.api.setDownloadNetwork(id, 'a', true)
    await lightning.api.setDownloadNetwork(id, 'a', false)
    await settle(1000)
    const left = (await lightning.currentHttp())!
    expect(left.status).toBe('paused')
    expect(network(left, 'a')?.enabled).toBe(false)

    // …and switching it on once more still resumes it.
    await lightning.api.setDownloadNetwork(id, 'a', true)
    await lightning.waitForHttpStatus('completed')
  })

  test('resumed with none on, it picks a network that is still there', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: 128 * BLOCK, bytesPerSecond: 256 * 1024 })
    const id = await lightning.start(origin.url(), origin.sha256, {
      networks: ['a', 'b'],
      connections: 2
    })
    await lightning.waitUntil((state) => state.bytesDownloaded > 0)

    await lightning.api.setDownloadNetwork(id, 'a', false)
    await lightning.api.setDownloadNetwork(id, 'b', false)
    await lightning.waitUntil((state) => state.status === 'paused')
    // b, the one switched off last, is unplugged while paused.
    await setNetworks(lightning, { a: NETWORKS['a'] })

    await lightning.api.resumeDownload(id)
    const resumed = await lightning.waitUntil((state) => state.status === 'downloading')
    expect(network(resumed, 'a')?.enabled).toBe(true)
    expect(network(resumed, 'b')?.enabled).toBe(false)
    await lightning.waitForHttpStatus('completed')
  })
})

test.describe('a network that can’t reach the server @smoke', () => {
  test.use({ appEnv: { LIGHTNING_E2E_SILENT_MS: '500' } })

  test('keeps one stream trying, and gets its streams back once it is through', async ({
    lightning,
    serve
  }) => {
    test.skip(!LAN_ADDRESS, 'needs a LAN address to act as the second network')
    const origin = await serve({ size: 128 * BLOCK, bytesPerSecond: 256 * 1024 })
    let blocked = true
    // Every connection over b drops before a byte of the file: connected, but not getting through.
    origin.setRule((request) =>
      blocked && overB(request) && request.range && request.range.end !== 0 ? { cutAfter: 0 } : 'ok'
    )
    await lightning.start(origin.url(), origin.sha256, { networks: ['a', 'b'], connections: 2 })

    const cut = await lightning.waitUntil(
      (state) => network(state, 'b')?.status === 'unreachable' && streamsOn(state, 'b') === 1
    )
    expect(network(cut, 'b')?.enabled).toBe(true)
    expect(cut.status, 'the download carries on over a').toBe('downloading')

    blocked = false
    await lightning.waitUntil(
      (state) => network(state, 'b')?.status === 'on' && streamsOn(state, 'b') === 2
    )
    await lightning.waitForHttpStatus('completed')
    expect(network((await lightning.currentHttp())!, 'b')!.bytesDownloaded).toBeGreaterThan(0)
  })
})

test.describe('a network that changes address', () => {
  // Far longer than the test waits: a stream only retries in time if it is woken.
  test.use({ appEnv: { LIGHTNING_E2E_RETRY_BASE_MS: '10000' } })

  test('gets its streams going again at once, not when their backoff runs out @smoke', async ({
    lightning,
    serve
  }) => {
    test.skip(!LAN_ADDRESS, 'needs a LAN address to act as the second network')
    const origin = await serve({ size: 192 * BLOCK, bytesPerSecond: 256 * 1024 })
    // Every connection over b's first address drops before a byte of the file.
    origin.setRule((request) =>
      overB(request) && request.range && request.range.end !== 0 ? { cutAfter: 0 } : 'ok'
    )
    await lightning.start(origin.url(), origin.sha256, { networks: ['a', 'b'], connections: 2 })
    await lightning.waitUntil(
      (state) =>
        state.kind === 'http' &&
        state.streams.some((stream) => stream.interfaceId === 'b' && stream.status === 'retrying')
    )

    // A new DHCP lease, say: b is now reached at another address, which gets through.
    await setNetworks(lightning, { a: NETWORKS['a'], b: '127.0.0.1' })
    const changedAt = Date.now()
    await lightning.waitUntil((state) => (network(state, 'b')?.bytesDownloaded ?? 0) > 0, 5000)
    expect(Date.now() - changedAt, 'well before a backoff of 8 s or more').toBeLessThan(5000)
  })
})

test.describe('the computer wakes from sleep', () => {
  // Nothing else would notice the dead connection for a long while.
  test.use({ appEnv: { LIGHTNING_E2E_STALL_MS: '60000', LIGHTNING_E2E_SILENT_MS: '60000' } })

  test('a connection that died in its sleep is replaced at once @smoke', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: 16 * BLOCK })
    let stalled = 0
    // One block's answer stops after its headers, as a connection does across a sleep.
    origin.setRule(({ range }) =>
      range?.start === 3 * BLOCK && stalled++ === 0 ? 'stallBody' : 'ok'
    )
    await lightning.start(origin.url(), origin.sha256, { connections: 2 })
    await lightning.waitUntil((state) => state.bytesDownloaded >= 15 * BLOCK)
    expect((await lightning.currentHttp())!.status).toBe('downloading')

    await lightning.evaluateMain((electron) => {
      electron.powerMonitor.emit('resume')
    }, null)
    await lightning.waitForHttpStatus('completed', 5000)
    expect(stalled, 'the block was asked for again').toBeGreaterThan(1)
  })
})
