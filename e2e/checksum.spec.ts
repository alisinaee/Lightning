import { createHash } from 'node:crypto'
import { BLOCK, expect, test } from './fixtures'

const SIZE = 4 * BLOCK

test.describe('checksum verification @smoke', () => {
  test('a matching hash is verified', async ({ lightning, serve }) => {
    const origin = await serve({ size: SIZE })
    await lightning.start(origin.url(), origin.sha256, {
      connections: 2,
      checksum: { algo: 'sha256', value: origin.sha256 }
    })
    const state = await lightning.waitForStatus('completed')
    await expect.poll(async () => (await lightning.current())?.checksum?.status).toBe('verified')
    expect(state.status).toBe('completed')
  })

  test('a different hash is reported and the file is kept', async ({ lightning, serve }) => {
    const origin = await serve({ size: SIZE })
    const wrong = createHash('md5').update('not the file').digest('hex')
    await lightning.start(origin.url(), origin.sha256, {
      connections: 2,
      checksum: { algo: 'md5', value: wrong }
    })
    await lightning.waitForStatus('completed')
    await expect.poll(async () => (await lightning.current())?.checksum?.status).toBe('mismatch')
    const final = await lightning.current()
    expect(final?.checksum?.expected).toBe(wrong)
    expect(final?.checksum?.actual).not.toBe(wrong)
  })
})
