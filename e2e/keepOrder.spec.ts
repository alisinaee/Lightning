import { expect, test } from '@playwright/test'
import { keepOrder } from '../src/renderer/src/utils/keepOrder'

const id = (item: { id: string }): string => item.id
const rows = (...ids: string[]): { id: string }[] => ids.map((one) => ({ id: one }))

test.describe('a list that holds its order while scrolled @smoke', () => {
  test('not frozen: the new order is used', () => {
    const next = rows('c', 'a', 'b')
    expect(keepOrder(next, id, ['a', 'b', 'c'], false)).toBe(next)
  })

  test('frozen: rows keep their place when the sort would move them', () => {
    expect(keepOrder(rows('c', 'a', 'b'), id, ['a', 'b', 'c'], true).map(id)).toEqual([
      'a',
      'b',
      'c'
    ])
  })

  test('frozen: rows that went are dropped and new ones come last', () => {
    expect(keepOrder(rows('d', 'a', 'c', 'e'), id, ['a', 'b', 'c'], true).map(id)).toEqual([
      'a',
      'c',
      'd',
      'e'
    ])
  })

  test('frozen with nothing drawn before: the computed order', () => {
    const next = rows('b', 'a')
    expect(keepOrder(next, id, undefined, true)).toBe(next)
  })

  test('frozen keeps the latest version of each row, only its place is held', () => {
    const next = [
      { id: 'b', n: 2 },
      { id: 'a', n: 9 }
    ]
    expect(keepOrder(next, id, ['a', 'b'], true)).toEqual([
      { id: 'a', n: 9 },
      { id: 'b', n: 2 }
    ])
  })
})
