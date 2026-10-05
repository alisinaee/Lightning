import { Meter, Meters, smoothTimeLeft } from '../src/main/download/transfer'
import { BLOCK, expect, test } from './fixtures'

// Speeds are counted as bytes arrive and read only on the download's clock (transfer.ts Meter).
// A speed limit releases bytes in bursts; read on arrival, a 7 MB/s limit read 6.9 MB/s.

const MB = 1024 * 1024

test.describe('speed meters', () => {
  test('a 7 MB/s limit that releases its bytes in bursts reads 7 MB/s', () => {
    const meter = new Meter()
    let now = 1_000_000
    meter.read(now) // the first reading is the starting point
    let worst = 0
    for (let tick = 1; tick <= 20; tick++) {
      // Four bursts of 1.75 MB a second: where they fall within a tick is not what's read.
      for (let burst = 0; burst < 4; burst++) meter.add(1.75 * MB)
      now += 1000
      const speed = meter.read(now)
      if (tick > 4) worst = Math.max(worst, Math.abs(speed - 7 * MB) / MB)
    }
    expect(worst).toBeLessThan(0.05)
  })

  test('a second clock reading ms after the last does not read a burst as a speed', () => {
    const meter = new Meter()
    meter.read(0)
    meter.add(5 * MB)
    expect(meter.read(5)).toBeLessThanOrEqual(5 * MB)
  })

  test('connections and networks keep their own counts', () => {
    const meters = new Meters()
    meters.add(1, 'wifi', 100)
    meters.add(2, 'wifi', 300)
    meters.connections.delete(1)
    meters.networks.get('wifi')!.read(0)
    meters.add(2, 'wifi', 1000)
    expect(meters.networks.get('wifi')!.read(1000)).toBe(1000)
    meters.clear()
    expect(meters.networks.size + meters.connections.size).toBe(0)
  })

  test('time left falls quickly and rises slowly', () => {
    expect(smoothTimeLeft(undefined, 1, 100)).toBe(100)
    const faster = smoothTimeLeft(100, 1, 60)
    const slower = smoothTimeLeft(100, 1, 140)
    expect(faster).toBeCloseTo(99 - 0.3 * 39, 5)
    expect(slower).toBeGreaterThan(99)
    expect(99 - faster).toBeGreaterThan(slower - 99)
  })
})

test('a limited download shows the speed it is held to, and a time left', async ({
  lightning,
  serve
}) => {
  const origin = await serve({ size: 80 * BLOCK })
  await lightning.api.updateSettings({ speedLimit: 1 * MB })
  await lightning.start(origin.url(), origin.sha256)
  // 5 MB at 1 MB/s: five seconds. Past the first ticks, the reading sits at the limit.
  const state = await lightning.waitUntil(
    (s) =>
      s.status === 'downloading' &&
      s.speedBytesPerSec > 0.5 * MB &&
      s.timeLeftSeconds !== undefined,
    20_000
  )
  expect(state.speedBytesPerSec).toBeLessThan(1.3 * MB)
  expect(state.networks.some((n) => n.speedBytesPerSec > 0)).toBe(true)
  await lightning.waitForHttpStatus('completed', 30_000)
  const done = await lightning.currentHttp()
  expect(done!.speedBytesPerSec).toBe(0)
  expect(done!.timeLeftSeconds).toBeUndefined()
})
