import { BLOCK, expect, test } from './fixtures'
import { seededBytes, sha256 } from './origin'
import { named, Swarm, torrentFileOnDisk } from './torrentSwarm'

// Speed & data limits (main/network/limits.ts): every byte received goes through them, whether
// an HTTP response's or a torrent peer's. The checks fixture verifies each finished download's
// bytes, which is what matters most here: holding a connection back must never garble it.

const KB = 1024

test.describe('speed and data limits', () => {
  test('a total speed limit holds a download to it', async ({ plexo, serve }) => {
    const origin = await serve({ size: 16 * BLOCK })
    await plexo.api.updateSettings({ speedLimit: 256 * KB })
    const started = Date.now()
    await plexo.start(origin.url(), origin.sha256)
    await plexo.waitForHttpStatus('completed', 30_000)
    // 1 MB at 256 KB/s: four seconds, less the second's worth a bucket may hold.
    expect(Date.now() - started).toBeGreaterThan(2500)
  })

  test('a network that uses up its data for the month stops, and goes on once it is raised', async ({
    plexo,
    serve
  }) => {
    const origin = await serve({ size: 16 * BLOCK })
    await plexo.api.updateSettings({ networkPreferences: { a: { dataLimit: 4 * BLOCK } } })
    const id = await plexo.start(origin.url(), origin.sha256)

    const stopped = await plexo.waitUntil((state) =>
      state.networks.some((network) => network.id === 'a' && network.status === 'limit')
    )
    expect(stopped.status).toBe('downloading')
    expect(stopped.bytesDownloaded).toBeLessThan(16 * BLOCK)
    expect((await plexo.api.networkUsage()).a).toBeGreaterThanOrEqual(4 * BLOCK)

    await plexo.api.updateSettings({ networkPreferences: { a: { dataLimit: 1024 * BLOCK } } })
    await plexo.waitForHttpStatus('completed')
    expect((await plexo.byId(id))?.status).toBe('completed')
  })

  test('a torrent under a speed limit still arrives whole', async ({ plexo }) => {
    const swarm = await new Swarm().start()
    try {
      const data = seededBytes(1024 * KB, 31)
      const torrent = await swarm.seed([named(data, 'limited.bin')], { pieceLength: 64 * KB })
      await plexo.api.updateSettings({ speedLimit: 384 * KB })
      const started = Date.now()
      await plexo.start(await torrentFileOnDisk(torrent), sha256(data))
      await plexo.waitForTorrentStatus('completed', 30_000)
      expect(Date.now() - started).toBeGreaterThan(1500)
    } finally {
      await swarm.stop()
    }
  })
})
