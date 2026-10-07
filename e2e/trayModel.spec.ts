import { expect, test } from '@playwright/test'
import { buildTrayModel, formatSpeed } from '../src/shared/trayModel'
import { DEFAULT_STATUS_BAR, type DownloadState } from '../src/shared/types'

// What the menu of the menu-bar icon says, decided without a window.

const download = (over: Record<string, unknown>): DownloadState =>
  ({
    kind: 'http',
    id: 'x',
    url: 'http://x',
    fileName: 'file.bin',
    destinationPath: '/x',
    totalBytes: 1000,
    bytesDownloaded: 500,
    speedBytesPerSec: 0,
    status: 'downloading',
    startedAt: 0,
    networks: [],
    streams: [],
    ...over
  }) as unknown as DownloadState

const net = (id: string, label: string, speed: number): Record<string, unknown> => ({
  id,
  label,
  kind: 'wifi',
  speedBytesPerSec: speed,
  transfer: 'http'
})

const running = [
  download({
    id: 'a',
    fileName: 'alpha.rar',
    speedBytesPerSec: 3_000_000,
    networks: [net('en0', 'Wi-Fi', 1_000_000), net('en7', 'USB LAN', 2_000_000)],
    streams: [
      { interfaceId: 'en0', status: 'downloading' },
      { interfaceId: 'en7', status: 'downloading' },
      { interfaceId: 'en7', status: 'downloading' }
    ],
    timeLeftSeconds: 65
  }),
  download({ id: 'b', fileName: 'beta.rar', speedBytesPerSec: 500_000 }),
  download({ id: 'c', status: 'queued' }),
  download({ id: 'd', status: 'paused' }),
  download({ id: 'e', status: 'error' })
]

test.describe('menu bar icon menu @smoke', () => {
  test('says how many download, the speed, each network, the downloads and the queue', () => {
    const model = buildTrayModel(running, {}, DEFAULT_STATUS_BAR)
    const text = model.lines.flatMap((line) => (line.kind === 'separator' ? [] : [line.text]))
    expect(text[0]).toBe('2 downloading · ↓ 3.3 MB/s')
    expect(text).toContain('   USB LAN  1.9 MB/s · 2 connections')
    expect(text).toContain('   Wi-Fi  976.6 KB/s · 1 connection')
    expect(text.some((line) => line.startsWith('alpha.rar  50% · 2.9 MB/s · 1:05'))).toBe(true)
    expect(text).toContain('1 waiting · 1 paused · 1 failed')
    expect(model.canPause).toBe(true)
    expect(model.canResume).toBe(true)
  })

  test('a download line carries its id, so clicking it can open it', () => {
    const model = buildTrayModel(running, {}, DEFAULT_STATUS_BAR)
    const ids = model.lines.flatMap((line) => (line.kind === 'download' ? [line.id] : []))
    expect(ids).toEqual(['a', 'b'])
  })

  test('the names a person gave their networks are used', () => {
    const model = buildTrayModel(running, { en7: 'Office cable' }, DEFAULT_STATUS_BAR)
    expect(
      model.lines.some((line) => line.kind === 'info' && line.text.includes('Office cable'))
    ).toBe(true)
  })

  test('each part can be switched off', () => {
    const none = buildTrayModel(
      running,
      {},
      {
        ...DEFAULT_STATUS_BAR,
        trayTotals: false,
        trayNetworks: false,
        trayDownloads: false,
        trayQueue: false
      }
    )
    expect(none.lines).toEqual([])
  })

  test('only as many downloads as asked are listed, and the rest are counted', () => {
    const model = buildTrayModel(running, {}, { ...DEFAULT_STATUS_BAR, trayRows: 1 })
    const listed = model.lines.filter((line) => line.kind === 'download')
    expect(listed).toHaveLength(1)
    expect(model.lines.some((line) => line.kind === 'info' && line.text === '…and 1 more')).toBe(
      true
    )
  })

  test('nothing running says so, and Pause All has nothing to act on', () => {
    const model = buildTrayModel([download({ status: 'completed' })], {}, DEFAULT_STATUS_BAR)
    expect(model.lines).toEqual([{ kind: 'info', text: 'Nothing is downloading' }])
    expect(model.canPause).toBe(false)
    expect(model.canResume).toBe(false)
  })

  test('the speed beside the icon is off until asked for', () => {
    expect(buildTrayModel(running, {}, DEFAULT_STATUS_BAR).title).toBe('')
    expect(buildTrayModel(running, {}, { ...DEFAULT_STATUS_BAR, trayTitle: true }).title).toBe(
      ` ${formatSpeed(3_500_000)}`
    )
  })

  test('an unchanged menu has an unchanged signature', () => {
    const one = buildTrayModel(running, {}, DEFAULT_STATUS_BAR)
    const two = buildTrayModel(running, {}, DEFAULT_STATUS_BAR)
    expect(one.signature).toBe(two.signature)
    expect(buildTrayModel(running.slice(0, 1), {}, DEFAULT_STATUS_BAR).signature).not.toBe(
      one.signature
    )
  })
})
