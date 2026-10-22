import { expect, test } from '@playwright/test'
import { fitFileName } from '../src/shared/fileNames'

// The name a claim writes, at its longest: base, extension, " (9999)", then the claim's suffix.
const longestClaimed = (base: string, ext: string, suffix: string): number =>
  new TextEncoder().encode(`${base}${ext} (9999)${suffix}`).length

const file = { suffix: '.lightning', extension: true }

test('a long name with an early dot is shortened whole, not refused', () => {
  for (const name of [
    `St. Louis Cardinals vs Chicago Cubs full game replay ${'x'.repeat(200)}`,
    `1. ${'漢'.repeat(85)}`
  ]) {
    const { base, ext } = fitFileName(name, file)
    expect(ext).toBe('')
    expect(longestClaimed(base, ext, file.suffix)).toBeLessThanOrEqual(255)
    expect(name.startsWith(base)).toBe(true)
    expect(base.length).toBeGreaterThan(0)
  }
})

test('a real extension stays last and the base is shortened', () => {
  const { base, ext } = fitFileName(`${'a'.repeat(300)}.mkv`, file)
  expect(ext).toBe('.mkv')
  expect(base).toMatch(/^a+$/)
  expect(longestClaimed(base, ext, file.suffix)).toBeLessThanOrEqual(255)
})

test('an ordinary name keeps its extension whole', () => {
  expect(fitFileName('video.mp4', file)).toEqual({ base: 'video', ext: '.mp4' })
})

test('a folder has no extension to keep last', () => {
  expect(fitFileName('Show.S01', { suffix: '', extension: false })).toEqual({
    base: 'Show.S01',
    ext: ''
  })
})

test('a dot-less name and a dotfile have no extension', () => {
  expect(fitFileName('README', file)).toEqual({ base: 'README', ext: '' })
  expect(fitFileName('.bashrc', file)).toEqual({ base: '.bashrc', ext: '' })
})
