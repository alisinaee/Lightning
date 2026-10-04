export interface Lane {
  id: string
  /** Bytes a second it is expected to deliver; above zero. */
  speed: number
  /** Bytes the files already running on it still have to fetch. */
  busyBytes: number
}

/**
 * Longest file first, each on the lane that would finish it soonest (counting what that lane is
 * already given): the usual greedy rule for splitting jobs over machines of different speeds.
 * Returns the lane for each size (by index) and the order the files should start in.
 */
export function assignFiles(
  sizes: number[],
  lanes: Lane[]
): { laneIds: string[]; order: number[] } {
  const known = sizes.filter((size) => size > 0)
  const guess = known.length > 0 ? known.reduce((sum, size) => sum + size, 0) / known.length : 1
  const sized = sizes.map((size) => (size > 0 ? size : guess))
  const order = sizes.map((_, index) => index).sort((a, b) => sized[b] - sized[a])
  const load = new Map(lanes.map((lane) => [lane.id, lane.busyBytes]))
  const laneIds: string[] = new Array<string>(sizes.length)
  for (const index of order) {
    let best = lanes[0]
    let bestTime = Infinity
    for (const lane of lanes) {
      const time = ((load.get(lane.id) ?? 0) + sized[index]) / lane.speed
      if (time < bestTime) {
        best = lane
        bestTime = time
      }
    }
    laneIds[index] = best.id
    load.set(best.id, (load.get(best.id) ?? 0) + sized[index])
  }
  return { laneIds, order }
}
