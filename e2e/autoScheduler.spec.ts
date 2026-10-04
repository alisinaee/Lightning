import { expect, test } from '@playwright/test'
import { assignFiles } from '../src/main/groups/assignFiles'

// Which network each file of an auto group goes on. Pure, so the choices are pinned down as inputs.

const lane = (
  id: string,
  speed: number,
  busyBytes = 0
): { id: string; speed: number; busyBytes: number } => ({
  id,
  speed,
  busyBytes
})

test('the biggest file goes on the fastest network', () => {
  const { laneIds, order } = assignFiles([10, 100, 40], [lane('slow', 1), lane('fast', 10)])
  expect(order).toEqual([1, 2, 0])
  expect(laneIds[1]).toBe('fast')
})

test('a network with a file already on it is given fewer', () => {
  const { laneIds } = assignFiles([50, 50], [lane('a', 1, 500), lane('b', 1)])
  expect(laneIds).toEqual(['b', 'b'])
})

test('equal networks share the files out evenly', () => {
  const { laneIds } = assignFiles([30, 30, 30, 30], [lane('a', 5), lane('b', 5)])
  expect(laneIds.filter((id) => id === 'a')).toHaveLength(2)
})

test('a file of unknown size counts as the average of the others', () => {
  const { order } = assignFiles([0, 10, 30], [lane('a', 1)])
  // 0 is taken as 20: between the two known ones.
  expect(order).toEqual([2, 0, 1])
})
