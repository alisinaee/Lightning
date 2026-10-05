import { BLOCK, expect, test } from './fixtures'

const SIZE = 4 * BLOCK
const allDay = { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' }

test.describe('schedule @smoke', () => {
  test('a pause window holds a new download, and releasing it lets it finish', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: SIZE })
    await lightning.api.updateSettings({
      schedule: { enabled: true, rules: [{ id: 'p', action: 'pause', ...allDay }] }
    })
    await lightning.start(origin.url(), origin.sha256, { connections: 2 })
    await expect.poll(async () => (await lightning.current())?.status).toBe('queued')
    // Held, not failed: nothing has asked the server for the file.
    expect(origin.chunkRequests()).toHaveLength(0)

    await lightning.api.updateSettings({ schedule: { enabled: false, rules: [] } })
    await lightning.waitForStatus('completed')
  })

  test('a window that opens resumes what its closing paused', async ({ lightning, serve }) => {
    const slow = await serve({ size: 24 * BLOCK, bytesPerSecond: 512 * 1024 })
    const id = await lightning.start(slow.url(), slow.sha256, { connections: 2 })
    await lightning.waitForStatus('downloading')
    await lightning.api.updateSettings({
      schedule: { enabled: true, rules: [{ id: 'p', action: 'pause', ...allDay }] }
    })
    await expect.poll(async () => (await lightning.byId(id))?.status).toBe('paused')
    await lightning.api.updateSettings({ schedule: { enabled: false, rules: [] } })
    await lightning.waitForStatus('completed', 60_000)
  })
})
