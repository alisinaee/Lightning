import { expect, test } from '@playwright/test'
import {
  COOLDOWN_MS,
  newTrack,
  planGroup,
  sustained,
  trackNetwork,
  type PlanAction,
  type PlanNetworkInput,
  type PlanRunning,
  type PlanWaiting,
  type Track
} from '../src/main/groups/planGroup'

// The reactive planner of an auto group, driven by simulated speed traces: one sample a second,
// the plan applied as the scheduler would. No app, no timers.

const MB = 1024 * 1024

interface Net {
  id: string
  name: string
  present: boolean
  track: Track
}

/** A tiny world: files with bytes left, networks with a speed per second, the planner in the loop. */
class Sim {
  now = 1_000_000
  nets: Net[]
  files: (PlanRunning & { done: boolean })[] = []
  waiting: PlanWaiting[] = []
  actions: PlanAction[] = []
  reasons: string[] = []
  constructor(
    ids: string[],
    public speed: (id: string, t: number) => number
  ) {
    this.nets = ids.map((id) => ({ id, name: id, present: true, track: newTrack() }))
  }
  t = 0
  addFile(id: string, total: number, networks: string[], splittable = true): void {
    this.files.push({
      id,
      name: id,
      remaining: total,
      total,
      networks,
      splittable,
      lastChangeAt: 0,
      done: false
    })
  }
  step(): void {
    this.t += 1
    this.now += 1000
    // Speeds: a network's speed is shared by the files on it.
    for (const net of this.nets) {
      const on = this.files.filter((f) => !f.done && f.networks.includes(net.id))
      const rate = net.present ? this.speed(net.id, this.t) : 0
      for (const f of on) f.remaining = Math.max(0, f.remaining - rate / on.length)
      const sample = on.length > 0 ? (net.present ? rate : 0) : null
      net.track = trackNetwork(net.track, sample, this.now).track
    }
    for (const f of this.files) if (f.remaining === 0 && f.total > 0) f.done = true
    const live = this.files.filter((f) => !f.done)
    const result = planGroup({
      now: this.now,
      networks: this.nets as PlanNetworkInput[],
      running: live,
      waiting: this.waiting
    })
    for (const action of result.actions) {
      const file = live.find((f) => f.id === action.fileId)!
      file.networks =
        action.kind === 'add'
          ? [...file.networks, action.networkId]
          : file.networks.filter((id) => id !== action.networkId)
      file.lastChangeAt = this.now
      this.actions.push(action)
      this.reasons.push(action.reason)
    }
    // Start waiting files on free lanes, as the scheduler does.
    if (result.actions.length === 0) {
      for (const net of this.nets) {
        if (!net.present || live.some((f) => f.networks.includes(net.id))) continue
        const id = result.order.find((candidate) => result.assignments[candidate] === net.id)
        const item = this.waiting.find((w) => w.id === id)
        if (!item) continue
        this.waiting = this.waiting.filter((w) => w !== item)
        this.addFile(item.id, item.size, [net.id])
      }
    }
  }
  run(seconds: number): void {
    for (let i = 0; i < seconds; i++) this.step()
  }
}

test('steady speeds change nothing', () => {
  const sim = new Sim(['wifi', 'eth'], (id) => (id === 'wifi' ? 6 * MB : 2 * MB))
  sim.addFile('a', 5000 * MB, ['wifi'])
  sim.addFile('b', 5000 * MB, ['eth'])
  sim.run(60)
  expect(sim.actions).toHaveLength(0)
})

test('wifi collapsing mid-file brings ethernet into that file', () => {
  const sim = new Sim(['wifi', 'eth'], (id, t) =>
    id === 'wifi' ? (t < 20 ? 6 * MB : 0.3 * MB) : 4 * MB
  )
  sim.addFile('show.part2.rar', 3000 * MB, ['wifi'])
  sim.addFile('other', 99000 * MB, ['eth'])
  sim.run(40)
  const add = sim.actions.find((a) => a.kind === 'add')
  expect(add).toMatchObject({ fileId: 'show.part2.rar', networkId: 'eth' })
  expect(add!.reason).toContain('wifi slowed from')
  expect(add!.reason).toContain('eth joined show.part2.rar')
  expect(sim.files[0].networks).toContain('eth')
  // The slow one gives under 10% of the file: dropped. Never restarted from scratch.
  expect(sim.files[0].networks).toEqual(['eth'])
  expect(sim.files[0].remaining).toBeLessThan(sim.files[0].total)
})

test('a slow network that still matters stays on the file', () => {
  const sim = new Sim(['wifi', 'eth'], (id, t) =>
    id === 'wifi' ? (t < 20 ? 10 * MB : 3 * MB) : 4 * MB
  )
  sim.addFile('big', 9000 * MB, ['wifi'])
  sim.run(40)
  expect([...sim.files[0].networks].sort()).toEqual(['eth', 'wifi'])
})

test('wifi recovering lets it take new files again', () => {
  const sim = new Sim(['wifi', 'eth'], (id, t) =>
    id === 'wifi' ? (t < 20 || t > 50 ? 6 * MB : 0.3 * MB) : 4 * MB
  )
  sim.addFile('a', 9000 * MB, ['wifi'])
  sim.addFile('b', 99000 * MB, ['eth'])
  sim.run(45)
  expect(sim.files[0].networks).toEqual(['eth'])
  sim.run(25)
  expect(sim.nets[0].track.state).toBe('fast')
  // A new file is planned for the recovered, faster network.
  const result = planGroup({
    now: sim.now,
    networks: sim.nets as PlanNetworkInput[],
    running: [],
    waiting: [{ id: 'n', name: 'n', size: 100 * MB }]
  })
  expect(result.assignments.n).toBe('wifi')
})

test('a spike or a dip of a few seconds is not a slowdown', () => {
  const sim = new Sim(['wifi', 'eth'], (id, t) =>
    id === 'wifi' ? (t >= 20 && t < 24 ? 0.2 * MB : 6 * MB) : 2 * MB
  )
  sim.addFile('a', 9000 * MB, ['wifi'])
  sim.addFile('b', 99000 * MB, ['eth'])
  sim.run(50)
  expect(sim.actions).toHaveLength(0)
})

test('a network that dies hands its file over at once', () => {
  const sim = new Sim(['wifi', 'eth'], () => 3 * MB)
  sim.addFile('a', 900 * MB, ['wifi'])
  sim.addFile('b', 9900 * MB, ['eth'])
  sim.run(10)
  sim.nets[0].present = false
  sim.run(1)
  expect(sim.files[0].networks).toEqual(['eth'])
  expect(sim.reasons[0]).toContain('wifi disconnected, so eth took over a')
})

test('one network with nothing left to do helps the biggest file (work stealing)', () => {
  const sim = new Sim(['wifi', 'eth'], (id) => (id === 'wifi' ? 6 * MB : 2 * MB))
  sim.addFile('huge', 5000 * MB, ['wifi'])
  sim.run(3)
  expect([...sim.files[0].networks].sort()).toEqual(['eth', 'wifi'])
  expect(sim.actions).toHaveLength(1)
  expect(sim.actions[0].reason).toContain('eth had nothing left to download')
})

test('an idle network does not help a file that is nearly done', () => {
  const sim = new Sim(['wifi', 'eth'], () => 6 * MB)
  sim.addFile('small', 30 * MB, ['wifi'])
  sim.addFile('other', 30 * MB, ['wifi'])
  sim.run(2)
  expect(sim.actions).toHaveLength(0)
})

test('a lone running file, with nothing waiting, gets every network at once', () => {
  const sim = new Sim(['wifi', 'eth'], () => 6 * MB)
  sim.addFile('small', 30 * MB, ['wifi'])
  sim.run(1)
  expect([...sim.files[0].networks].sort()).toEqual(['eth', 'wifi'])
})

test('a helper is given back when a file of its own is waiting', () => {
  const sim = new Sim(['eth', 'wifi'], () => 4 * MB)
  sim.addFile('huge', 9000 * MB, ['wifi'])
  sim.run(3)
  expect([...sim.files[0].networks].sort()).toEqual(['eth', 'wifi'])
  sim.waiting.push({ id: 'next', name: 'next', size: 100 * MB })
  sim.now += COOLDOWN_MS
  sim.run(1)
  expect(sim.files[0].networks).toEqual(['wifi'])
  expect(sim.actions.at(-1)!.reason).toContain('so it can start next')
})

test('flapping speeds do not thrash', () => {
  const sim = new Sim(['wifi', 'eth'], (id, t) =>
    id === 'wifi' ? (Math.floor(t / 7) % 2 === 0 ? 6 * MB : 0.4 * MB) : 4 * MB
  )
  sim.addFile('a', 99000 * MB, ['wifi'])
  sim.run(300)
  // At most one change per file per 15 s, and in practice far fewer.
  expect(sim.actions.length).toBeLessThanOrEqual(2 * Math.ceil(300 / 15))
  expect(sim.actions.length).toBeLessThan(12)
})

test('a file whose size is unknown is not helped, but still waits and plans', () => {
  const sim = new Sim(['wifi', 'eth'], () => 3 * MB)
  sim.addFile('mystery', 0, ['wifi'])
  sim.files[0].remaining = 0
  sim.waiting.push({ id: 'w', name: 'w', size: 0 })
  const result = planGroup({
    now: sim.now,
    networks: sim.nets as PlanNetworkInput[],
    running: sim.files,
    waiting: sim.waiting
  })
  expect(result.actions).toHaveLength(0)
  expect(result.assignments.w).toBeDefined()
})

test('a file that cannot be split is never given a second network', () => {
  const sim = new Sim(['wifi', 'eth'], (id) => (id === 'wifi' ? 6 * MB : 2 * MB))
  sim.addFile('one-piece', 5000 * MB, ['wifi'], false)
  sim.run(30)
  expect(sim.actions).toHaveLength(0)
})

test('only one network: everything waits for it, nothing is moved', () => {
  const sim = new Sim(['wifi'], () => 3 * MB)
  sim.addFile('a', 5000 * MB, ['wifi'])
  sim.waiting.push({ id: 'b', name: 'b', size: 10 * MB })
  sim.run(30)
  expect(sim.actions).toHaveLength(0)
  expect(
    planGroup({ now: sim.now, networks: sim.nets, running: sim.files, waiting: sim.waiting })
      .assignments.b
  ).toBe('wifi')
})

test('a pinned file is never changed, and its load is planned around', () => {
  const sim = new Sim(['wifi', 'eth'], (id, t) =>
    id === 'wifi' ? (t < 20 ? 6 * MB : 0.3 * MB) : 4 * MB
  )
  sim.addFile('mine', 3000 * MB, ['wifi'])
  sim.files[0].pinned = true
  sim.run(60)
  // Wifi collapsed and ethernet is idle, but the user chose wifi for it.
  expect(sim.actions).toHaveLength(0)
  expect(sim.files[0].networks).toEqual(['wifi'])
  // A waiting file pinned to eth makes the others avoid eth.
  const result = planGroup({
    now: sim.now,
    networks: [
      { id: 'wifi', name: 'wifi', present: true, track: newTrack(5 * MB) },
      { id: 'eth', name: 'eth', present: true, track: newTrack(5 * MB) }
    ],
    running: [],
    waiting: [
      { id: 'p', name: 'p', size: 1000 * MB, pinned: ['eth'] },
      { id: 'x', name: 'x', size: 600 * MB }
    ]
  })
  expect(result.assignments).toEqual({ p: 'eth', x: 'wifi' })
})

test("a burst in a network's first seconds is not taken as its speed", () => {
  let track = newTrack()
  const burst = [6e6, 5e6, 1e6, 1e6, 1e6, 1e6, 1e6]
  const seen: number[] = []
  burst.forEach((sample, i) => {
    track = trackNetwork(track, sample, 1000 * (i + 1)).track
    seen.push(sustained(track))
  })
  // From the third second on the reading is the steady speed, never the burst.
  expect(seen.slice(2)).toEqual([1e6, 1e6, 1e6, 1e6, 1e6])
  expect(track.baseline).toBeLessThan(4e6)
})
