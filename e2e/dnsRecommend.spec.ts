import { expect, test } from '@playwright/test'
import { DNS_PRESETS, describeDns } from '../src/shared/dnsPresets'
import { recommend, SYSTEM_NAME, type DnsTestEntry } from '../src/shared/dnsRecommend'

// Which DNS to suggest from what each one measured: pure, so no app is needed.

const entry = (
  name: string,
  ip: string | null,
  over: Partial<DnsTestEntry> = {}
): DnsTestEntry => ({
  name,
  servers: name === SYSTEM_NAME ? [] : [`${name}-server`],
  lookupMs: 50,
  ip,
  connectMs: 100,
  bytesPerSec: 1_000_000,
  ...over
})

test.describe('choosing a DNS from a test @smoke', () => {
  test('every DNS leading to one server means DNS cannot matter', () => {
    const result = recommend([entry(SYSTEM_NAME, '1.1.1.1'), entry('Shecan', '1.1.1.1')])
    expect(result.kind).toBe('same')
  })

  test('a clearly faster server is suggested, with how much faster', () => {
    const result = recommend([
      entry(SYSTEM_NAME, '1.1.1.1', { bytesPerSec: 1_000_000 }),
      entry('Begzar', '2.2.2.2', { bytesPerSec: 2_000_000 })
    ])
    expect(result.kind).toBe('better')
    expect(result.name).toBe('Begzar')
    expect(result.gain).toBeCloseTo(1, 1)
  })

  test('a small gain is not worth changing a setting for', () => {
    const result = recommend([
      entry(SYSTEM_NAME, '1.1.1.1', { bytesPerSec: 1_000_000 }),
      entry('Begzar', '2.2.2.2', { bytesPerSec: 1_100_000 })
    ])
    expect(result.kind).toBe('keep')
  })

  test('when the system DNS already leads to the best server, it stays', () => {
    const result = recommend([
      entry(SYSTEM_NAME, '2.2.2.2', { bytesPerSec: 3_000_000 }),
      entry('Begzar', '2.2.2.2', { bytesPerSec: 3_000_000 }),
      entry('Google', '1.1.1.1', { bytesPerSec: 500_000 })
    ])
    expect(result.kind).toBe('keep')
    expect(result.name).toBe(SYSTEM_NAME)
  })

  test('DNSs leading to the same best server: the system one stands for them, else the quickest', () => {
    const withSystem = recommend([
      entry(SYSTEM_NAME, '2.2.2.2', { bytesPerSec: 3_000_000 }),
      entry('Begzar', '2.2.2.2', { bytesPerSec: 3_000_000, lookupMs: 10 }),
      entry('Google', '1.1.1.1', { bytesPerSec: 500_000 }),
      entry('Shecan', '3.3.3.3', { bytesPerSec: 400_000 })
    ])
    expect(withSystem.name).toBe(SYSTEM_NAME)
    const without = recommend(
      [
        entry(SYSTEM_NAME, '1.1.1.1', { bytesPerSec: 500_000 }),
        entry('Begzar', '2.2.2.2', { bytesPerSec: 3_000_000, lookupMs: 90 }),
        entry('Shecan', '2.2.2.2', { bytesPerSec: 3_000_000, lookupMs: 20 })
      ],
      SYSTEM_NAME
    )
    expect(without.name).toBe('Shecan')
  })

  test('without measured speeds, how quickly a server connects decides', () => {
    const result = recommend([
      entry(SYSTEM_NAME, '1.1.1.1', { bytesPerSec: null, connectMs: 120 }),
      entry('Begzar', '2.2.2.2', { bytesPerSec: null, connectMs: 60 })
    ])
    expect(result.kind).toBe('better')
    expect(result.name).toBe('Begzar')
  })

  test('a DNS that gave no answer, or whose server refused, is never suggested', () => {
    const result = recommend([
      entry(SYSTEM_NAME, '1.1.1.1', { bytesPerSec: 1_000_000 }),
      entry('Radar', null, { error: 'No answer in time', connectMs: null, bytesPerSec: null }),
      entry('Google', '2.2.2.2', { error: 'Status 403', bytesPerSec: 9_000_000 })
    ])
    expect(result.name).not.toBe('Radar')
    expect(result.name).not.toBe('Google')
  })

  test('nothing measurable says so', () => {
    const result = recommend([entry('Radar', null, { error: 'No answer', connectMs: null })])
    expect(result.kind).toBe('none')
  })
})

test.describe('a gain that is only noise @smoke', () => {
  test('a big percentage on a trickle of a link is not worth a change', () => {
    const result = recommend([
      entry(SYSTEM_NAME, '1.1.1.1', { bytesPerSec: 20_000 }),
      entry('Shecan', '2.2.2.2', { bytesPerSec: 40_000 })
    ])
    expect(result.kind).toBe('keep')
  })

  test('the same percentage on a real link is', () => {
    const result = recommend([
      entry(SYSTEM_NAME, '1.1.1.1', { bytesPerSec: 2_000_000 }),
      entry('Shecan', '2.2.2.2', { bytesPerSec: 4_000_000 })
    ])
    expect(result.kind).toBe('better')
  })

  test('a few milliseconds quicker to connect is not worth a change', () => {
    const result = recommend([
      entry(SYSTEM_NAME, '1.1.1.1', { bytesPerSec: null, connectMs: 30 }),
      entry('Begzar', '2.2.2.2', { bytesPerSec: null, connectMs: 10 })
    ])
    expect(result.kind).toBe('keep')
  })
})

test.describe('what each DNS is @smoke', () => {
  test('every well-known DNS has a description, and it is found by name or by servers', () => {
    for (const preset of DNS_PRESETS) {
      expect(preset.description.length, preset.name).toBeGreaterThan(30)
      expect(describeDns(preset.name)).toBe(preset.description)
      expect(describeDns(preset.servers)).toBe(preset.description)
    }
    expect(describeDns(SYSTEM_NAME)).toMatch(/internet provider/)
    expect(describeDns('Some DNS of mine')).toBeUndefined()
  })
})
