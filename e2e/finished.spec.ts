import { BLOCK, expect, test } from './fixtures'

const SIZE = 3 * BLOCK

test.describe('when all downloads finish @smoke', () => {
  test.use({ appEnv: { LIGHTNING_E2E_FINISHED_ACTION: 'nothing' } })

  test('asks once the queue is empty, only when Settings says so', async ({ lightning, serve }) => {
    const origin = await serve({ size: SIZE })
    await lightning.start(origin.url(), origin.sha256, { connections: 2 })
    await lightning.waitForStatus('completed')
    // Off by default: nothing is asked.
    await new Promise((resolve) => setTimeout(resolve, 4500))
    expect(lightning.output.join('')).not.toContain('queue finished')

    await lightning.api.updateSettings({ prefs: { askWhenFinished: true } })
    const second = await serve({ size: SIZE, seed: 7 })
    await lightning.start(second.url(), second.sha256, { connections: 2 })
    await lightning.waitForStatus('completed')
    await expect
      .poll(() => lightning.output.join(''), { timeout: 10_000 })
      .toContain('queue finished: 1 completed')
  })
})
