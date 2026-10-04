import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PlanEvent } from '../../shared/types'
import type { LabPlan } from './lab'
import { is, mb, type LabContext, type LabFile } from './labContext'

// The Test lab's plans. Each one is an automatic workflow against the real app: it starts real
// downloads and groups through the same operations the window uses, steers the embedded server
// and the simulated networks, and checks what the app did. Sizes are small and each network is
// capped, so a plan takes 10 to 150 seconds. Every finished file is checked byte for byte.

const W = 'Wi-Fi'
const E = 'Ethernet'
const P = 'Phone'
const V = 'Fake VPN'
const MB = 1024 * 1024

export const RESTART_NOTE = join(tmpdir(), 'plexo-lab-restart', 'note.json')

/** Waits for every file; stops early if one fails. */
async function waitAll(
  ctx: LabContext,
  files: LabFile[],
  ms: number,
  label = 'every file finishes'
): Promise<boolean> {
  return ctx.waitFor(
    label,
    async () => {
      for (const file of files) if ((await ctx.find(file))?.status !== 'completed') return false
      return true
    },
    ms,
    {
      giveUp: async () => {
        for (const file of files) {
          const state = await ctx.find(file)
          if (state && (state.status === 'error' || state.status === 'cancelled')) {
            return `${file.name} ended as ${state.status}: ${state.error ?? 'no reason given'}`
          }
        }
        return null
      }
    }
  )
}

async function verifyAll(ctx: LabContext, files: LabFile[]): Promise<void> {
  for (const file of files) await ctx.verifyFile(file)
}

async function bytesOf(ctx: LabContext, file: LabFile): Promise<number> {
  return (await ctx.find(file))?.bytesDownloaded ?? 0
}

const staging = (names: string[]): string[] => names.filter((name) => name.includes('.plexo'))

const requestsOn = (counts: Record<string, { requests: number }>, net: string): number =>
  counts[net]?.requests ?? 0
const bytesOn = (counts: Record<string, { bytes: number }>, net: string): number =>
  counts[net]?.bytes ?? 0

/** Plan-log events of the kinds that are the planner acting or reacting (not measuring). */
const reactions = (events: PlanEvent[], after = 0): PlanEvent[] =>
  events.filter(
    (event) => event.at >= after && ['slow', 'lost', 'help', 'release', 'drop'].includes(event.kind)
  )

/** Records every status a file passes through, to catch one that ever shows as failed. */
function watchForErrors(ctx: LabContext, files: LabFile[]): { seen: () => string[] } {
  const seen = new Set<string>()
  const timer = setInterval(() => {
    for (const state of ctx.live()) {
      if (files.some((file) => state.url.includes(file.path))) {
        if (state.status === 'error' || state.status === 'cancelled') {
          seen.add(`${state.fileName}: ${state.status} ${state.error ?? ''}`)
        }
      }
    }
  }, 200)
  timer.unref()
  ctx.signal.addEventListener('abort', () => clearInterval(timer), { once: true })
  ;(ctx as { after(ms: number, fn: () => void): void }).after(0, () => {})
  return {
    seen: () => {
      clearInterval(timer)
      return [...seen]
    }
  }
}

const plans: LabPlan[] = [
  {
    id: '0',
    title: 'Self-check',
    difficulty: 'Easy',
    estimateSec: 10,
    steps: ['Server and simulated networks', 'One small download'],
    tests:
      'The lab itself: its built-in download server, the pretend networks (Wi-Fi, Ethernet, Phone and a fake VPN) and one tiny real download.',
    challenge:
      'Nothing difficult. It makes sure the test machinery works, so a later failure means the app has a problem and not the lab.',
    passLooksLike:
      'The server is running, all four pretend networks show up in the app, and a 2 MB file arrives exactly as the server made it.',
    async run(ctx) {
      await ctx.step('Server and simulated networks', async () => {
        ctx.require('the lab server is running', ctx.server.running, true)
        ctx.expect('the server has a port', ctx.server.port, is.gte(18000))
        ctx.expect('the pretend networks are listed', ctx.net.list(), [W, E, P, V])
        ctx.expect(
          'the app offers three of them (the VPN is left out)',
          ctx.net.selectable(),
          [W, E, P],
          'The VPN is only offered when Use VPN is on.'
        )
      })
      await ctx.step('One small download', async () => {
        ctx.server.setSpeed(W, 'unlimited')
        const file = ctx.file({ name: 'self-check.bin', mb: 2 })
        await ctx.startDownload(file, [W])
        await ctx.waitDone(file, 30_000)
        await ctx.verifyFile(file)
        const counts = ctx.fileCounters(file)
        ctx.expect('the file came over Wi-Fi', requestsOn(counts, W), is.gt(0))
        ctx.expect('no other network was used', requestsOn(counts, E) + requestsOn(counts, P), 0)
      })
    }
  },
  {
    id: '1',
    title: 'Integrity across many connections',
    difficulty: 'Hard',
    estimateSec: 40,
    steps: [
      'Start three files',
      'Wait for all of them',
      'Check every byte',
      'Check the networks were combined'
    ],
    tests:
      'That a file downloaded in pieces over several networks at once is saved exactly right, with no piece lost, repeated or put in the wrong place.',
    challenge:
      'Three big files are split over Wi-Fi, Ethernet and Phone at the same time, each network at a different speed, so pieces arrive out of order and from different directions.',
    passLooksLike:
      'All three files finish and every single byte matches what the server sent. Each network really carried part of the data, so the connections were truly combined.',
    async run(ctx) {
      const files = ['a', 'b', 'c'].map((n) => ctx.file({ name: `integrity-${n}.bin`, mb: 24 }))
      await ctx.step('Start three files', async () => {
        ctx.server.setSpeed(W, 1800)
        ctx.server.setSpeed(E, 1200)
        ctx.server.setSpeed(P, 800)
        for (const file of files) await ctx.startDownload(file, [W, E, P])
        ctx.expect('three downloads are running', ctx.live().length, 3)
      })
      await ctx.step('Wait for all of them', async () => {
        await waitAll(ctx, files, 120_000)
      })
      await ctx.step('Check every byte', async () => {
        await verifyAll(ctx, files)
      })
      await ctx.step('Check the networks were combined', async () => {
        const counts = ctx.counters()
        for (const net of [W, E, P]) {
          ctx.expect(`${net} served requests`, requestsOn(counts, net), is.gt(0))
          ctx.expect(`${net} sent data`, bytesOn(counts, net), is.gt(MB))
        }
        const total = [W, E, P].reduce((sum, net) => sum + bytesOn(counts, net), 0)
        ctx.expect(
          'together they sent at least the size of all files',
          total,
          is.gte(files.reduce((sum, file) => sum + file.size, 0))
        )
      })
    }
  },
  {
    id: '2',
    title: 'Pause and resume torture',
    difficulty: 'Brutal',
    estimateSec: 90,
    steps: ['Start the file', 'Pause and resume ten times', 'Finish and check'],
    tests:
      'That pausing and resuming a download over and over never loses or damages data, even when you pause at a bad moment or press Resume twice.',
    challenge:
      'One 40 MB file is paused and resumed ten times at random moments, some while a piece is half way in, some with a double Resume, some with a double Pause.',
    passLooksLike:
      'The file still finishes with every byte right, the progress number never went backwards, and no stray half-finished copies are left in the folder.',
    async run(ctx) {
      const file = ctx.file({ name: 'torture.bin', mb: 40 })
      let last = 0
      let backwards = 0
      let worst = 0
      const watch = setInterval(() => {
        void bytesOf(ctx, file).then((now) => {
          if (now < last) {
            backwards++
            worst = Math.max(worst, last - now)
          }
          last = Math.max(last, now) > now ? last : now
        })
      }, 100)
      watch.unref()
      try {
        await ctx.step('Start the file', async () => {
          ctx.server.setSpeed(W, 1000)
          ctx.server.setSpeed(E, 700)
          await ctx.startDownload(file, [W, E])
          await ctx.waitFor(
            'it starts receiving data',
            async () => (await bytesOf(ctx, file)) > 0,
            20_000,
            {
              fatal: true
            }
          )
        })
        await ctx.step('Pause and resume ten times', async () => {
          let rounds = 0
          for (let round = 1; round <= 10; round++) {
            await ctx.sleep(300 + Math.floor(Math.random() * 1400))
            const state = await ctx.find(file)
            if (state?.status === 'completed') {
              ctx.note(`round ${round}: already finished, nothing left to pause`)
              break
            }
            rounds++
            await ctx.pause(file)
            if (round % 4 === 0) await ctx.pause(file)
            await ctx.waitFor(
              `round ${round}: it is paused`,
              async () => (await ctx.find(file))?.status === 'paused',
              15_000
            )
            ctx.expect(
              `round ${round}: only one staging file`,
              staging(await ctx.listDir()).length,
              is.lte(1)
            )
            await ctx.resume(file)
            if (round % 3 === 0) await ctx.resume(file)
            await ctx.waitFor(
              `round ${round}: it is downloading again`,
              async () => {
                const s = await ctx.find(file)
                return s?.status === 'downloading' || s?.status === 'completed'
              },
              15_000
            )
          }
          ctx.expect('all ten pauses happened before the file finished', rounds, 10)
        })
        await ctx.step('Finish and check', async () => {
          const state = await ctx.find(file)
          if (state?.status === 'paused') await ctx.resume(file)
          await ctx.waitDone(file, 120_000)
          await ctx.verifyFile(file)
          ctx.expect(
            'the progress number never went backwards',
            backwards === 0 ? 0 : `${backwards} times, by up to ${mb(worst)}`,
            0,
            'The progress shown fell during a pause or resume.'
          )
          ctx.expect('the folder holds only the finished file', await ctx.listDir(), [file.name])
        })
      } finally {
        clearInterval(watch)
      }
    }
  },
  {
    id: '3',
    title: 'Server fault gauntlet',
    difficulty: 'Brutal',
    estimateSec: 170,
    timeoutSec: 600,
    steps: [
      'Server errors, then success',
      'Told to wait (429)',
      'Connection cut mid-piece',
      'Server goes silent',
      'Server lies about the range',
      'Server without ranges'
    ],
    tests:
      'How the app behaves when a server misbehaves: errors, "please wait", dropped connections, a server that goes silent, one that sends the wrong piece, and one that cannot send pieces at all.',
    challenge:
      'The server is made to fail in six different ways in a row. The app has to recover from each one, wait as long as it was told to, and above all never save a damaged file.',
    passLooksLike:
      'Every recoverable fault ends with a finished, byte-exact file. The wait the server asked for is respected. When the server keeps sending wrong data the download fails safely, with no finished-looking file left behind.',
    async run(ctx) {
      ctx.server.setSpeed(W, 4000)
      const clean = async (file: LabFile): Promise<void> => {
        await ctx.remove(file).catch(() => {})
      }
      await ctx.step('Server errors, then success', async () => {
        const file = ctx.file({ name: 'fault-503.bin', mb: 6, query: 'status=503&times=3' })
        await ctx.startDownload(file, [W])
        await ctx.waitDone(file, 90_000)
        await ctx.verifyFile(file)
        ctx.expect(
          'it asked again after each error',
          requestsOn(ctx.fileCounters(file), W),
          is.gte(4)
        )
        await clean(file)
      })
      await ctx.step('Told to wait (429)', async () => {
        const file = ctx.file({
          name: 'fault-429.bin',
          mb: 6,
          query: 'status=429&times=1&retryAfter=8'
        })
        const began = Date.now()
        await ctx.startDownload(file, [W])
        await ctx.waitDone(file, 90_000)
        const took = (Date.now() - began) / 1000
        await ctx.verifyFile(file)
        ctx.expect(
          'it waited as long as the server asked (8 s)',
          took,
          is.gte(7.5),
          'It came back before the server said it could.'
        )
        await clean(file)
      })
      await ctx.step('Connection cut mid-piece', async () => {
        const file = ctx.file({ name: 'fault-cut.bin', mb: 12, query: 'cut=1500000&times=4' })
        await ctx.startDownload(file, [W])
        await ctx.waitDone(file, 120_000)
        await ctx.verifyFile(file)
        ctx.expect('it had to reconnect', requestsOn(ctx.fileCounters(file), W), is.gte(5))
        await clean(file)
      })
      await ctx.step('Server goes silent', async () => {
        const file = ctx.file({ name: 'fault-stall.bin', mb: 4, query: 'stall=1&times=1' })
        await ctx.startDownload(file, [W])
        await ctx.waitDone(file, 100_000)
        await ctx.verifyFile(file)
        await clean(file)
      })
      await ctx.step('Server lies about the range', async () => {
        const brief = ctx.file({
          name: 'fault-range-brief.bin',
          mb: 4,
          query: 'wrongrange=1&times=2'
        })
        await ctx.startDownload(brief, [W])
        await ctx.waitDone(brief, 90_000)
        await ctx.verifyFile(brief, 'after two wrong answers the file is still byte-exact')
        await clean(brief)

        const lasting = ctx.file({ name: 'fault-range-always.bin', mb: 2, query: 'wrongrange=1' })
        await ctx.startDownload(lasting, [W])
        const failed = await ctx.waitFor(
          'with a server that always lies, the download stops with an error',
          async () => (await ctx.find(lasting))?.status === 'error',
          120_000
        )
        ctx.expect(
          'no finished-looking file was saved',
          (await ctx.listDir()).includes(lasting.name),
          false,
          'A damaged download must never appear under its final name.'
        )
        ctx.expect('it did not claim to be complete', failed, true)
        await clean(lasting)
      })
      await ctx.step('Server without ranges', async () => {
        const file = ctx.file({ name: 'fault-norange.bin', mb: 6, noRange: true })
        await ctx.startDownload(file, [W, E])
        await ctx.waitDone(file, 90_000)
        await ctx.verifyFile(file)
        ctx.expect('one network was used', requestsOn(ctx.fileCounters(file), E), 0)
        await clean(file)
      })
    }
  },
  {
    id: '4',
    title: 'Network drops and returns',
    difficulty: 'Brutal',
    estimateSec: 60,
    steps: [
      'Download on three networks',
      'Ethernet disappears',
      'Ethernet comes back',
      'Finish and check'
    ],
    tests:
      'What happens when one of your connections suddenly disappears in the middle of a big download, and when it comes back later.',
    challenge:
      'An 80 MB file runs over Wi-Fi, Ethernet and Phone. Ethernet is unplugged mid-file, then plugged in again. The download must not fail, must not start over, and must start using Ethernet again by itself.',
    passLooksLike:
      'While Ethernet is gone the download keeps going on the other two with no error and no lost progress, nothing more is received over Ethernet, and soon after it returns it carries data again. The final file is byte-exact.',
    async run(ctx) {
      const file = ctx.file({ name: 'drop.bin', mb: 80 })
      let atDrop = 0
      let ethernetBytes = 0
      await ctx.step('Download on three networks', async () => {
        for (const net of [W, E, P]) ctx.server.setSpeed(net, 1000)
        await ctx.startDownload(file, [W, E, P])
        await ctx.waitFor(
          'all three networks are carrying data',
          () => [W, E, P].every((net) => bytesOn(ctx.counters(), net) > MB),
          40_000,
          { fatal: true }
        )
      })
      await ctx.step('Ethernet disappears', async () => {
        await ctx.net.remove(E)
        await ctx.sleep(500)
        atDrop = await bytesOf(ctx, file)
        ethernetBytes = bytesOn(ctx.counters(), E)
        ctx.note(`Ethernet removed with ${mb(atDrop)} downloaded`)
        await ctx.sleep(4000)
        const state = await ctx.find(file)
        ctx.expect('the download is still going, with no error', state?.status, 'downloading')
        ctx.expect(
          'it carried on from where it was (did not restart)',
          state?.bytesDownloaded ?? 0,
          is.gt(atDrop)
        )
        const ethernet = state?.networks.find((n) => n.id === E)
        ctx.expect('the app sees Ethernet as offline', ethernet?.status, 'offline')
        ctx.expect(
          'nothing more came over the missing Ethernet',
          bytesOn(ctx.counters(), E) - ethernetBytes,
          is.lt(2 * MB),
          'Data kept arriving over a connection that is gone.'
        )
      })
      await ctx.step('Ethernet comes back', async () => {
        const before = bytesOn(ctx.counters(), E)
        await ctx.net.add(E)
        await ctx.waitFor(
          'Ethernet carries data again within 20 s',
          () => bytesOn(ctx.counters(), E) - before > 512 * 1024,
          20_000
        )
      })
      await ctx.step('Finish and check', async () => {
        await ctx.waitDone(file, 150_000)
        await ctx.verifyFile(file)
      })
    }
  },
  {
    id: '5',
    title: 'Auto: Wi-Fi collapses mid-download',
    difficulty: 'Brutal',
    estimateSec: 100,
    steps: ['Start the group', 'Wi-Fi collapses', 'Check the reaction', 'Finish and check'],
    tests:
      'Whether Auto mode notices when its fastest connection suddenly becomes very slow, and moves the work to the connections that are still fast.',
    challenge:
      'Six 30 MB files download in an Auto group. After 12 seconds Wi-Fi drops from fast to a crawl of 300 KB/s. Auto must see it and shift the work, instead of leaving a file stuck on the slow link.',
    passLooksLike:
      'Auto writes a "slowed down" note within 20 seconds of the drop, Wi-Fi carries a clearly smaller share of the data afterwards, the group finishes much sooner than if one file had crawled to the end over Wi-Fi, and every file is byte-exact.',
    async run(ctx) {
      const files = Array.from({ length: 6 }, (_, i) =>
        ctx.file({ name: `collapse-${i + 1}.bin`, mb: 30 })
      )
      let groupId = ''
      let dropAt = 0
      let started = 0
      let bytesBefore: Record<string, number> = {}
      await ctx.step('Start the group', async () => {
        ctx.server.setSpeed(W, 2500)
        ctx.server.setSpeed(E, 1000)
        ctx.server.setSpeed(P, 1000)
        started = Date.now()
        groupId = await ctx.startGroup({
          name: 'Wi-Fi collapse',
          mode: 'auto',
          networks: [W, E, P],
          files
        })
        ctx.after(12_000, () => {
          dropAt = Date.now()
          const counts = ctx.counters()
          bytesBefore = Object.fromEntries(Object.keys(counts).map((k) => [k, counts[k].bytes]))
          ctx.server.setSpeed(W, 300)
          ctx.note('Wi-Fi dropped to 300 KB/s')
        })
        await ctx.waitFor('the group is running', () => ctx.live().length > 0, 30_000, {
          fatal: true
        })
      })
      await ctx.step('Wi-Fi collapses', async () => {
        await ctx.waitFor('the collapse happened', () => dropAt > 0, 30_000, { fatal: true })
      })
      await ctx.step('Check the reaction', async () => {
        await ctx.waitFor(
          'Auto notices Wi-Fi slowed down within 20 s',
          () => ctx.planLog().some((e) => e.kind === 'slow' && e.at >= dropAt),
          20_000
        )
        const slowAt = ctx.planLog().find((e) => e.kind === 'slow' && e.at >= dropAt)?.at ?? 0
        ctx.expect(
          'the note came within 20 s of the drop',
          slowAt > 0 ? (slowAt - dropAt) / 1000 : 999,
          is.lte(20)
        )
      })
      await ctx.step('Finish and check', async () => {
        const done = await waitAll(ctx, files, 240_000)
        const finishedAfter = (Date.now() - dropAt) / 1000
        const worst = (30 * MB) / (300 * 1024)
        ctx.expect(
          `the group finished faster than one file crawling over the slow Wi-Fi (${worst.toFixed(0)} s)`,
          done ? finishedAfter : 999,
          is.lt(worst),
          'Work stayed on the slow connection.'
        )
        const after = ctx.counters()
        const share = (
          counts: Record<string, { bytes: number }>,
          base: Record<string, number>
        ): number => {
          const w = bytesOn(counts, W) - (base[W] ?? 0)
          const all = Object.keys(counts).reduce(
            (sum, k) => sum + counts[k].bytes - (base[k] ?? 0),
            0
          )
          return all > 0 ? w / all : 0
        }
        const beforeShare = share(
          Object.fromEntries(Object.entries(bytesBefore).map(([k, v]) => [k, { bytes: v }])),
          {}
        )
        const afterShare = share(after, bytesBefore)
        ctx.note(
          `Wi-Fi share of the data: ${(beforeShare * 100).toFixed(0)}% before the drop, ${(afterShare * 100).toFixed(0)}% after`
        )
        ctx.expect(
          'Wi-Fi share of the data fell after the drop',
          afterShare,
          is.lt(beforeShare * 0.6)
        )
        await verifyAll(ctx, files)
        void groupId
        void started
      })
    }
  },
  {
    id: '6',
    title: 'Auto: recovery and swap',
    difficulty: 'Hard',
    estimateSec: 70,
    steps: ['Start the group', 'Speeds swap', 'Finish and check'],
    tests:
      'Whether Auto mode re-plans when the fast and slow connections trade places half way through.',
    challenge:
      'Wi-Fi starts fast and Ethernet slow, then after about 15 seconds they swap. A planner that keeps its first decision would leave most of the data on what has become the slow connection.',
    passLooksLike:
      'Auto writes notes showing it noticed the swap and changed its plan, and the whole group finishes sooner than the estimate for sticking with the first assignment. All files are byte-exact.',
    async run(ctx) {
      const files = Array.from({ length: 6 }, (_, i) =>
        ctx.file({ name: `swap-${i + 1}.bin`, mb: 20 })
      )
      let swapAt = 0
      let wifiBefore = 0
      await ctx.step('Start the group', async () => {
        ctx.server.setSpeed(W, 4000)
        ctx.server.setSpeed(E, 500)
        await ctx.startGroup({ name: 'Speed swap', mode: 'auto', networks: [W, E], files })
        ctx.after(15_000, () => {
          swapAt = Date.now()
          wifiBefore = bytesOn(ctx.counters(), W)
          ctx.server.setSpeed(W, 500)
          ctx.server.setSpeed(E, 4000)
          ctx.note('Speeds swapped: Wi-Fi 500 KB/s, Ethernet 4000 KB/s')
        })
      })
      await ctx.step('Speeds swap', async () => {
        await ctx.waitFor('the swap happened', () => swapAt > 0, 40_000, { fatal: true })
        await ctx.waitFor(
          'Auto reacts to the swap (a note in its log) within 40 s',
          () =>
            reactions(ctx.planLog(), swapAt).length > 0 ||
            ctx.planLog().some((e) => e.kind === 'faster' && e.at >= swapAt),
          40_000
        )
      })
      await ctx.step('Finish and check', async () => {
        const done = await waitAll(ctx, files, 200_000)
        const total = files.reduce((sum, f) => sum + f.size, 0)
        const wifiShare = total * (4000 / 4500)
        const pinned = (swapAt - 0) / 1000
        void pinned
        const afterSwap = (Date.now() - swapAt) / 1000
        const estimate = Math.max(0, wifiShare - wifiBefore) / (500 * 1024)
        ctx.expect(
          `it beat the first-assignment estimate (${estimate.toFixed(0)} s after the swap)`,
          done ? afterSwap : 999,
          is.lt(estimate),
          'Sticking with the first plan would have been as slow or slower.'
        )
        await verifyAll(ctx, files)
      })
    }
  },
  {
    id: '7',
    title: 'Auto: flapping must not thrash',
    difficulty: 'Brutal',
    estimateSec: 90,
    steps: ['Start the group', 'Wi-Fi flaps for a minute', 'Finish and check'],
    tests:
      'That Auto mode stays calm when one connection keeps getting fast and slow again every few seconds, instead of shuffling files around nonstop.',
    challenge:
      'Wi-Fi switches between 4000 and 500 KB/s every 4 seconds for a full minute while twelve files download. A nervous planner would change its mind dozens of times and waste time reconnecting.',
    passLooksLike:
      'Auto changes the plan for Wi-Fi only a handful of times (6 or fewer) in the minute, and every file still finishes byte-exact.',
    async run(ctx) {
      const files = Array.from({ length: 12 }, (_, i) =>
        ctx.file({ name: `flap-${i + 1}.bin`, mb: 20 })
      )
      let began = 0
      await ctx.step('Start the group', async () => {
        ctx.server.setSpeed(W, 4000)
        ctx.server.setSpeed(E, 1500)
        began = Date.now()
        await ctx.startGroup({ name: 'Flapping Wi-Fi', mode: 'auto', networks: [W, E], files })
        let fast = true
        const flap = (): void => {
          if (Date.now() - began > 62_000) return
          fast = !fast
          ctx.server.setSpeed(W, fast ? 4000 : 500)
          ctx.after(4000, flap)
        }
        ctx.after(4000, flap)
      })
      await ctx.step('Wi-Fi flaps for a minute', async () => {
        await ctx.waitFor('a minute of flapping passes', () => Date.now() - began > 62_000, 90_000)
      })
      await ctx.step('Finish and check', async () => {
        await waitAll(ctx, files, 200_000)
        const acted = reactions(ctx.planLog()).filter((e) => /wi-?fi/i.test(e.text))
        ctx.note(
          `plan actions about Wi-Fi: ${acted.map((e) => `${e.kind}: ${e.text}`).join(' | ') || 'none'}`
        )
        ctx.expect(
          'plan actions for the flapping network',
          acted.length,
          is.lte(6),
          'The planner is thrashing.'
        )
        await verifyAll(ctx, files)
      })
    }
  },
  {
    id: '8',
    title: 'Auto: a network dies',
    difficulty: 'Brutal',
    estimateSec: 70,
    steps: ['Start the group', 'Ethernet dies', 'Finish and check'],
    tests:
      'What Auto mode does when one of its connections dies completely while a file is running on it.',
    challenge:
      'Six files run over Wi-Fi, Ethernet and Phone. Ten seconds in, Ethernet stops answering and also disappears from the computer. The file that was using it must be rescued by the other connections.',
    passLooksLike:
      'The file that was on Ethernet carries on over another connection, nothing is ever shown as failed, Auto notes the loss, and all six files finish byte-exact.',
    async run(ctx) {
      const files = Array.from({ length: 6 }, (_, i) =>
        ctx.file({ name: `dies-${i + 1}.bin`, mb: 20 })
      )
      let diedAt = 0
      let guard: { seen: () => string[] } | null = null
      await ctx.step('Start the group', async () => {
        ctx.server.setSpeed(W, 2000)
        ctx.server.setSpeed(E, 2000)
        ctx.server.setSpeed(P, 1500)
        guard = watchForErrors(ctx, files)
        await ctx.startGroup({ name: 'Ethernet dies', mode: 'auto', networks: [W, E, P], files })
        ctx.after(10_000, async () => {
          diedAt = Date.now()
          ctx.server.setSpeed(E, 'block')
          await ctx.net.remove(E)
          ctx.note('Ethernet blocked and removed')
        })
      })
      await ctx.step('Ethernet dies', async () => {
        await ctx.waitFor('Ethernet died', () => diedAt > 0, 40_000, { fatal: true })
        await ctx.sleep(8000)
        const stuck = ctx
          .live()
          .filter(
            (s) =>
              s.status === 'downloading' &&
              !s.networks.some((n) => n.enabled && n.id !== E && n.status === 'on')
          )
        ctx.expect(
          'no running file depends only on the dead network',
          stuck.map((s) => s.fileName),
          []
        )
        ctx.expect(
          'Auto noticed the loss in its log',
          ctx
            .planLog()
            .some((e) => e.at >= diedAt && (e.kind === 'lost' || /ethernet/i.test(e.text))),
          true
        )
      })
      await ctx.step('Finish and check', async () => {
        await waitAll(ctx, files, 200_000)
        ctx.expect('no file was ever shown as failed', guard?.seen() ?? [], [])
        await verifyAll(ctx, files)
      })
    }
  },
  {
    id: '9',
    title: 'VPN setting proof',
    difficulty: 'Hard',
    estimateSec: 60,
    steps: [
      'VPN off: Auto group',
      'VPN off: a manual download on all networks',
      'Turn Use VPN on',
      'VPN on and fastest: Auto group'
    ],
    tests:
      'That the "Use VPN for downloads" switch really decides whether a VPN connection is used, and that a VPN is used when you allow it.',
    challenge:
      'A fake VPN is offered as the fastest connection of all, to tempt the app. With the switch off, even a download that explicitly asks for "all networks" must stay off the VPN. With it on, Auto must make use of it.',
    passLooksLike:
      'With the switch off the VPN receives zero requests and is missing from the choices. After switching it on, the VPN is in the choices and carries real data for an Auto group.',
    async run(ctx) {
      const off = Array.from({ length: 4 }, (_, i) =>
        ctx.file({ name: `vpn-off-${i + 1}.bin`, mb: 10 })
      )
      const manual = ctx.file({ name: 'vpn-off-manual.bin', mb: 16 })
      const on = Array.from({ length: 4 }, (_, i) =>
        ctx.file({ name: `vpn-on-${i + 1}.bin`, mb: 16 })
      )
      await ctx.step('VPN off: Auto group', async () => {
        await ctx.settings.set({ useVpn: false })
        ctx.server.setSpeed(W, 2000)
        ctx.server.setSpeed(E, 2000)
        ctx.server.setSpeed(V, 'unlimited')
        ctx.expect(
          'the VPN is not in the list the app offers',
          ctx.net.selectable().includes(V),
          false
        )
        ctx.expect('it is connected, though', ctx.net.list().includes(V), true)
        await ctx.startGroup({ name: 'VPN off', mode: 'auto', networks: [W, E, V], files: off })
        await waitAll(ctx, off, 120_000)
        await verifyAll(ctx, off)
        ctx.expect(
          'the VPN received no requests',
          requestsOn(ctx.counters(), V),
          0,
          'A VPN was used although the switch is off.'
        )
      })
      await ctx.step('VPN off: a manual download on all networks', async () => {
        await ctx.startDownload(manual, [W, E, V])
        await ctx.waitDone(manual, 90_000)
        await ctx.verifyFile(manual)
        ctx.expect(
          'the VPN still received no requests',
          requestsOn(ctx.counters(), V),
          0,
          'A manual download used the VPN with the switch off.'
        )
        ctx.expect('the VPN sent no data', bytesOn(ctx.counters(), V), 0)
      })
      await ctx.step('Turn Use VPN on', async () => {
        await ctx.settings.set({ useVpn: true })
        ctx.expect(
          'the VPN is now in the list the app offers',
          ctx.net.selectable().includes(V),
          true
        )
      })
      await ctx.step('VPN on and fastest: Auto group', async () => {
        ctx.server.resetCounters()
        ctx.server.setSpeed(W, 1000)
        ctx.server.setSpeed(E, 1000)
        ctx.server.setSpeed(V, 6000)
        await ctx.startGroup({ name: 'VPN on', mode: 'auto', networks: [W, E, V], files: on })
        await waitAll(ctx, on, 150_000)
        await verifyAll(ctx, on)
        const counts = ctx.counters()
        ctx.expect('the VPN received requests', requestsOn(counts, V), is.gt(0))
        ctx.expect('the VPN carried real data', bytesOn(counts, V), is.gt(4 * MB))
        const total = [W, E, V].reduce((sum, net) => sum + bytesOn(counts, net), 0)
        ctx.expect(
          'the VPN carried the biggest share, as the fastest',
          bytesOn(counts, V) / total,
          is.gt(0.34)
        )
      })
    }
  },
  {
    id: '10',
    title: 'Manual per-file connections are exclusive',
    difficulty: 'Hard',
    estimateSec: 50,
    steps: [
      'Start three files with their own connections',
      'Check each file stayed on its own connections',
      'Switch a running file to another connection',
      'Finish and check'
    ],
    tests:
      "That in a Manual group each file really uses only the connections you chose for it, and that changing a running file's connection takes effect.",
    challenge:
      'File A may only use Wi-Fi, file B only Ethernet, and file C Wi-Fi plus Phone, all downloading at once. Then file A is switched to Ethernet while it is running, the same way the buttons on its row do it.',
    passLooksLike:
      'The server confirms A never touched anything but Wi-Fi, B only Ethernet, and C only Wi-Fi and Phone. After the switch A stops using Wi-Fi and finishes over Ethernet. All files are byte-exact.',
    async run(ctx) {
      const a = ctx.file({ name: 'manual-a.bin', mb: 24 })
      const b = ctx.file({ name: 'manual-b.bin', mb: 12 })
      const c = ctx.file({ name: 'manual-c.bin', mb: 16 })
      await ctx.step('Start three files with their own connections', async () => {
        ctx.server.setSpeed(W, 1500)
        ctx.server.setSpeed(E, 2000)
        ctx.server.setSpeed(P, 1000)
        await ctx.startGroup({
          name: 'Manual connections',
          mode: 'manual',
          networks: [W, E, P],
          files: [a, b, c],
          perFile: { [a.name]: [W], [b.name]: [E], [c.name]: [W, P] }
        })
        await ctx.waitFor(
          'all three are receiving',
          async () => {
            for (const f of [a, b, c]) if ((await bytesOf(ctx, f)) < 512 * 1024) return false
            return true
          },
          40_000,
          { fatal: true }
        )
      })
      await ctx.step('Check each file stayed on its own connections', async () => {
        await ctx.sleep(2500)
        const ca = ctx.fileCounters(a)
        const cb = ctx.fileCounters(b)
        const cc = ctx.fileCounters(c)
        ctx.expect('A used Wi-Fi', requestsOn(ca, W), is.gt(0))
        ctx.expect(
          'A used nothing but Wi-Fi',
          requestsOn(ca, E) + requestsOn(ca, P) + requestsOn(ca, V),
          0
        )
        ctx.expect('B used Ethernet', requestsOn(cb, E), is.gt(0))
        ctx.expect(
          'B used nothing but Ethernet',
          requestsOn(cb, W) + requestsOn(cb, P) + requestsOn(cb, V),
          0
        )
        ctx.expect(
          'C used Wi-Fi and Phone',
          Math.min(requestsOn(cc, W), requestsOn(cc, P)),
          is.gt(0)
        )
        ctx.expect('C never used Ethernet', requestsOn(cc, E) + requestsOn(cc, V), 0)
      })
      await ctx.step('Switch a running file to another connection', async () => {
        const state = await ctx.find(a)
        ctx.require(
          'A is still running',
          state?.status,
          'downloading',
          'A finished before it could be switched.'
        )
        await ctx.setNetworks(a, [E])
        const switched = await ctx.find(a)
        ctx.expect('Wi-Fi is off for A', switched?.networks.find((n) => n.id === W)?.enabled, false)
        ctx.expect(
          'Ethernet is on for A',
          switched?.networks.find((n) => n.id === E)?.enabled,
          true
        )
        await ctx.waitFor(
          'A is served over Ethernet',
          () => requestsOn(ctx.fileCounters(a), E) > 0,
          20_000
        )
        await ctx.sleep(2000)
        const wifiThen = bytesOn(ctx.fileCounters(a), W)
        await ctx.sleep(2500)
        ctx.expect('A takes no more data over Wi-Fi', bytesOn(ctx.fileCounters(a), W) - wifiThen, 0)
      })
      await ctx.step('Finish and check', async () => {
        await waitAll(ctx, [a, b, c], 120_000)
        await verifyAll(ctx, [a, b, c])
        const cb = ctx.fileCounters(b)
        ctx.expect('B still never left Ethernet', requestsOn(cb, W) + requestsOn(cb, P), 0)
      })
    }
  },
  {
    id: '11',
    title: 'Pinning in Auto',
    difficulty: 'Hard',
    estimateSec: 70,
    steps: ['Start the group with one file pinned', 'Finish and check'],
    tests:
      'That in an Auto group a file you choose a connection for stays on exactly that connection, and Auto does not push other files onto it too.',
    challenge:
      'One file is pinned to Phone, which is by far the slowest connection (400 KB/s). Auto would never choose Phone for it by itself, and must also not treat Phone as a free fast lane for the other files.',
    passLooksLike:
      "The pinned file is served only over Phone, however slow, and Phone carries only a small share of the other files' data. Every file is byte-exact.",
    async run(ctx) {
      const pinned = ctx.file({ name: 'pinned.bin', mb: 10 })
      const others = Array.from({ length: 5 }, (_, i) =>
        ctx.file({ name: `free-${i + 1}.bin`, mb: 16 })
      )
      await ctx.step('Start the group with one file pinned', async () => {
        ctx.server.setSpeed(W, 3000)
        ctx.server.setSpeed(E, 3000)
        ctx.server.setSpeed(P, 400)
        const groupId = await ctx.startGroup({
          name: 'Pinned file',
          mode: 'auto',
          networks: [W, E, P],
          files: [pinned, ...others]
        })
        await ctx.pinFile(groupId, pinned, [P])
        ctx.expect(
          'the group lists the file as chosen by you',
          ctx.group(groupId)?.pinned.length ?? 0,
          is.gte(1)
        )
      })
      await ctx.step('Finish and check', async () => {
        await waitAll(ctx, [pinned, ...others], 200_000)
        const cp = ctx.fileCounters(pinned)
        ctx.expect('the pinned file used Phone', requestsOn(cp, P), is.gt(0))
        ctx.expect(
          'the pinned file never used Wi-Fi or Ethernet',
          requestsOn(cp, W) + requestsOn(cp, E),
          0
        )
        let phoneForOthers = 0
        let allOthers = 0
        for (const f of others) {
          phoneForOthers += bytesOn(ctx.fileCounters(f), P)
          allOthers += f.size
        }
        ctx.note(
          `Phone carried ${mb(phoneForOthers)} of the other files (${((phoneForOthers / allOthers) * 100).toFixed(0)}%)`
        )
        ctx.expect(
          'Phone carried a small share of the other files',
          phoneForOthers / allOthers,
          is.lt(0.25)
        )
        await verifyAll(ctx, [pinned, ...others])
      })
    }
  },
  {
    id: '12',
    title: 'Group edits while running',
    difficulty: 'Hard',
    estimateSec: 90,
    steps: [
      'Start the group',
      'Add three links while it runs',
      'Remove a running file',
      'Switch Auto, Manual, Auto',
      'Pause and resume the whole group',
      'Finish and check'
    ],
    tests:
      'That you can change a group while it downloads (add links, remove a file, change its mode, pause and resume it) and it stays consistent.',
    challenge:
      'Edits are made at awkward moments: links added while files run, a running file removed with half its data on disk, the mode flipped back and forth, and the whole group paused and resumed.',
    passLooksLike:
      'No file is lost or doubled, the removed file leaves nothing behind, the group never shows leftover waiting items, and the seven remaining files finish byte-exact.',
    async run(ctx) {
      const first = Array.from({ length: 5 }, (_, i) =>
        ctx.file({ name: `edit-${i + 1}.bin`, mb: 12 })
      )
      const added = Array.from({ length: 3 }, (_, i) =>
        ctx.file({ name: `edit-added-${i + 1}.bin`, mb: 8 })
      )
      let groupId = ''
      const items = async (): Promise<number> => {
        const group = ctx.group(groupId)
        const own = (await ctx.all()).length
        return own + (group?.pending.length ?? 0)
      }
      await ctx.step('Start the group', async () => {
        ctx.server.setSpeed(W, 1500)
        ctx.server.setSpeed(E, 1500)
        groupId = await ctx.startGroup({
          name: 'Edits',
          mode: 'auto',
          networks: [W, E],
          files: first
        })
        await ctx.waitFor(
          'files are running',
          () => ctx.live().some((s) => s.status === 'downloading'),
          30_000,
          { fatal: true }
        )
        ctx.expect('five items in the group', await items(), 5)
      })
      await ctx.step('Add three links while it runs', async () => {
        await ctx.addToGroup(groupId, added)
        ctx.expect('eight items in the group', await items(), 8)
      })
      let removed: LabFile = first[0]
      await ctx.step('Remove a running file', async () => {
        const running = ctx
          .live()
          .find((s) => s.status === 'downloading' && first.some((f) => s.url.includes(f.path)))
        removed = first.find((f) => running?.url.includes(f.path)) ?? first[0]
        await ctx.waitFor(
          'it has data on disk',
          async () => (await bytesOf(ctx, removed)) > MB,
          30_000
        )
        await ctx.remove(removed)
        await ctx.waitFor(
          'its partial file is gone',
          async () => !(await ctx.listDir()).some((n) => n.startsWith(removed.name)),
          15_000
        )
        ctx.expect('seven items remain', await items(), 7)
      })
      await ctx.step('Switch Auto, Manual, Auto', async () => {
        await ctx.updateGroup(groupId, { mode: 'manual' })
        await ctx.sleep(1500)
        ctx.expect('the group is manual', ctx.group(groupId)?.mode, 'manual')
        ctx.expect('seven items remain after the switch', await items(), 7)
        await ctx.updateGroup(groupId, { mode: 'auto' })
        ctx.expect('the group is auto again', ctx.group(groupId)?.mode, 'auto')
      })
      await ctx.step('Pause and resume the whole group', async () => {
        await ctx.pauseGroup(groupId)
        await ctx.waitFor(
          'nothing is downloading',
          () => !ctx.live().some((s) => s.status === 'downloading'),
          20_000
        )
        await ctx.sleep(1500)
        ctx.expect(
          'nothing started by itself while paused',
          ctx.live().filter((s) => s.status === 'downloading').length,
          0
        )
        await ctx.resumeGroup(groupId)
        await ctx.waitFor(
          'it is downloading again',
          () => ctx.live().some((s) => s.status === 'downloading'),
          30_000
        )
      })
      await ctx.step('Finish and check', async () => {
        const remaining = [...first, ...added].filter((f) => f !== removed)
        await waitAll(ctx, remaining, 240_000)
        await verifyAll(ctx, remaining)
        ctx.expect('no waiting items are left in the group', ctx.group(groupId)?.pending.length, 0)
        const all = await ctx.all()
        ctx.expect('seven downloads, no orphans', all.length, 7)
        ctx.expect(
          'all belong to the group',
          all.every((s) => s.groupId === groupId),
          true
        )
        const names = await ctx.listDir()
        ctx.expect('no staging files left', staging(names), [])
        ctx.expect(
          'the removed file is not on disk',
          names.some((n) => n.startsWith(removed.name)),
          false
        )
        ctx.expect('seven files saved', names.length, 7)
      })
    }
  },
  {
    id: '13',
    title: 'Concurrency and queue limits',
    difficulty: 'Hard',
    estimateSec: 75,
    steps: ['Twelve downloads, two at once', 'Auto lanes may exceed the limit'],
    tests:
      'That the "downloads at once" setting is respected for ordinary downloads, that the rest wait their turn in order, and that Auto groups, which use one connection per file, are the one deliberate exception.',
    challenge:
      'Twelve downloads are queued with only two allowed at a time, and the lab watches the count every tenth of a second. Then an Auto group runs with the limit set to one.',
    passLooksLike:
      'Never more than two ordinary downloads run together, all twelve finish byte-exact in roughly the order they were added, and the Auto group runs several files at once even with the limit at one.',
    async run(ctx) {
      const queue = Array.from({ length: 12 }, (_, i) =>
        ctx.file({ name: `queue-${String(i + 1).padStart(2, '0')}.bin`, mb: 4 })
      )
      await ctx.step('Twelve downloads, two at once', async () => {
        await ctx.settings.set({ downloadsAtOnce: 2 })
        ctx.server.setSpeed(W, 2500)
        let most = 0
        const poll = setInterval(() => {
          const running = ctx.live().filter((s) => s.status === 'downloading').length
          if (running > most) most = running
        }, 100)
        try {
          for (const file of queue) await ctx.startDownload(file, [W])
          await waitAll(ctx, queue, 120_000)
        } finally {
          clearInterval(poll)
        }
        ctx.expect(
          'most downloads running at one moment',
          most,
          is.lte(2),
          'The limit was exceeded.'
        )
        ctx.expect('it did use both slots', most, is.gte(2))
        await verifyAll(ctx, queue)
        const states = await Promise.all(queue.map((f) => ctx.find(f)))
        const order = states
          .map((s, i) => ({ i, at: s?.completedAt ?? 0 }))
          .sort((x, y) => x.at - y.at)
          .map((x) => x.i)
        const displacement = Math.max(...order.map((index, rank) => Math.abs(index - rank)))
        ctx.note(`finishing order: ${order.map((i) => i + 1).join(', ')}`)
        ctx.expect('the order stayed roughly first come, first served', displacement, is.lte(3))
        for (const file of queue) await ctx.remove(file).catch(() => {})
      })
      await ctx.step('Auto lanes may exceed the limit', async () => {
        await ctx.settings.set({ downloadsAtOnce: 1 })
        const files = Array.from({ length: 3 }, (_, i) =>
          ctx.file({ name: `lane-${i + 1}.bin`, mb: 24 })
        )
        for (const net of [W, E, P]) ctx.server.setSpeed(net, 1000)
        let most = 0
        const poll = setInterval(() => {
          const running = ctx.live().filter((s) => s.status === 'downloading').length
          if (running > most) most = running
        }, 100)
        try {
          await ctx.startGroup({ name: 'Lanes', mode: 'auto', networks: [W, E, P], files })
          await waitAll(ctx, files, 150_000)
        } finally {
          clearInterval(poll)
        }
        ctx.expect('the group ran several files at once with the limit at one', most, is.gte(2))
        await verifyAll(ctx, files)
      })
    }
  },
  {
    id: '14',
    title: 'Speed limit and slow mode',
    difficulty: 'Hard',
    estimateSec: 50,
    steps: ['Total speed limit', 'Limit removed', 'Slow mode'],
    tests:
      'That the speed limit and Slow mode really cap how fast data is received and saved, and that removing the limit lets the download speed up again.',
    challenge:
      'The server could send at full speed. The lab sets a 1 MB/s limit, measures for ten seconds how much was really saved (and how much the server sent), removes the limit, and then does the same with Slow mode at 0.5 MB/s.',
    passLooksLike:
      'Measured speed stays within 25% of the limit while it is on, and rises well above it as soon as it is removed.',
    async run(ctx) {
      const file = ctx.file({ name: 'limited.bin', mb: 400 })
      /** Measures a window two ways: what the server sent, and what the app says it has saved. */
      const measure = async (
        ms: number
      ): Promise<{ server: number; saved: number; requests: number; shown: number }> => {
        const before = await bytesOf(ctx, file)
        const requests = requestsOn(ctx.counters(), W)
        const sampled = await ctx.sample(ms)
        const saved = (await bytesOf(ctx, file)) - before
        const asked = requestsOn(ctx.counters(), W) - requests
        const shown = (await ctx.find(file))?.speedBytesPerSec ?? 0
        ctx.note(
          `server sent ${mb(sampled.total)}, the app saved ${mb(saved)}, ${asked} request(s), the app showed ${mb(shown)}/s`
        )
        return {
          server: sampled.rate[W] ?? 0,
          saved: saved / sampled.seconds,
          requests: asked,
          shown
        }
      }
      await ctx.step('Total speed limit', async () => {
        ctx.server.setSpeed(W, 'unlimited')
        await ctx.settings.set({ speedLimit: 1 * MB })
        await ctx.startDownload(file, [W])
        await ctx.waitFor('data is arriving', async () => (await bytesOf(ctx, file)) > 0, 20_000, {
          fatal: true
        })
        await ctx.sleep(3000)
        const got = await measure(10_000)
        ctx.expect(
          'the app saves data at the limit (1 MB/s, within 25%)',
          got.saved / MB,
          is.between(0.75, 1.25),
          'The limit is not respected.'
        )
        ctx.expect(
          'the server is not sending far above the limit (socket buffers blur a short window)',
          got.server / MB,
          is.lte(3),
          'Data is being pulled from the server at far more than the limit allows.'
        )
        ctx.expect(
          'the speed the app shows matches what it saved (within 40%)',
          got.shown / Math.max(1, got.saved),
          is.between(0.6, 1.4)
        )
      })
      await ctx.step('Limit removed', async () => {
        await ctx.settings.set({ speedLimit: undefined })
        await ctx.sleep(2000)
        const got = await measure(2000)
        ctx.expect(
          'speed rises well above the old limit',
          got.server / MB,
          is.gt(2.5),
          'Removing the limit did not speed the download up.'
        )
      })
      await ctx.step('Slow mode', async () => {
        await ctx.settings.set({ slowMode: true, slowModeSpeed: MB / 2 })
        await ctx.sleep(3000)
        const got = await measure(8000)
        ctx.expect(
          'Slow mode saves data at 0.5 MB/s (within 25%)',
          got.saved / MB,
          is.between(0.375, 0.625)
        )
        ctx.expect(
          'the server is not sending far above the slow-mode speed',
          got.server / MB,
          is.lte(1.5)
        )
      })
    }
  },
  {
    id: '15',
    title: 'Cancel and cleanup',
    difficulty: 'Hard',
    estimateSec: 60,
    steps: [
      'Cancel a download',
      'Remove a running download',
      'Remove a group',
      'Nothing left behind'
    ],
    tests:
      'That cancelling or removing downloads and groups leaves nothing behind: no half-finished files, no ghost entries, and nothing still quietly downloading.',
    challenge:
      'Downloads and a group are stopped in the middle, with a lot of data already on disk, in three different ways.',
    passLooksLike:
      'After each step the half-finished files are gone, the folder ends up empty, no download is running, and the server has no open connections left.',
    async run(ctx) {
      const files = ['a', 'b', 'c'].map((n) => ctx.file({ name: `cancel-${n}.bin`, mb: 60 }))
      const grouped = Array.from({ length: 3 }, (_, i) =>
        ctx.file({ name: `cancel-group-${i + 1}.bin`, mb: 40 })
      )
      ctx.server.setSpeed(W, 1500)
      ctx.server.setSpeed(E, 1500)
      const hasData = async (file: LabFile): Promise<boolean> => (await bytesOf(ctx, file)) > 2 * MB
      await ctx.step('Cancel a download', async () => {
        for (const file of files) await ctx.startDownload(file, [W, E])
        await ctx.waitFor(
          'all three have data',
          async () => (await Promise.all(files.map(hasData))).every(Boolean),
          60_000,
          { fatal: true }
        )
        ctx.expect('staging files exist while running', staging(await ctx.listDir()).length, 3)
        await ctx.cancel(files[0])
        await ctx.waitFor(
          'the cancelled download is cancelled',
          async () => (await ctx.find(files[0]))?.status === 'cancelled',
          20_000
        )
        await ctx.waitFor(
          'its partial file is gone',
          async () => staging(await ctx.listDir()).length === 2,
          15_000
        )
      })
      await ctx.step('Remove a running download', async () => {
        await ctx.remove(files[1])
        await ctx.waitFor(
          'it left the list',
          async () => (await ctx.find(files[1])) === undefined,
          15_000
        )
        await ctx.waitFor(
          'its partial file is gone',
          async () => staging(await ctx.listDir()).length === 1,
          15_000
        )
      })
      await ctx.step('Remove a group', async () => {
        const id = await ctx.startGroup({
          name: 'To remove',
          mode: 'auto',
          networks: [W, E],
          files: grouped
        })
        await ctx.waitFor(
          'the group has data on disk',
          async () =>
            (await Promise.all(grouped.map((f) => bytesOf(ctx, f)))).some((n) => n > 2 * MB),
          60_000,
          { fatal: true }
        )
        await ctx.removeGroup(id)
        ctx.expect('the group is gone', ctx.group(id), undefined)
        await ctx.waitFor(
          'only the first group-less download remains in the folder',
          async () => staging(await ctx.listDir()).length <= 1,
          20_000
        )
        ctx.expect(
          'none of its files are listed',
          (await ctx.all()).filter((s) => s.groupId === id).length,
          0
        )
      })
      await ctx.step('Nothing left behind', async () => {
        await ctx.remove(files[2])
        ctx.expect(
          'the cancelled download stays listed as cancelled (until removed), not running',
          (await ctx.find(files[0]))?.status,
          'cancelled'
        )
        await ctx.remove(files[0])
        await ctx.waitFor(
          'no download of the lab is listed',
          async () => (await ctx.all()).length === 0,
          20_000
        )
        ctx.expect('the folder is empty', await ctx.listDir(), [])
        ctx.expect('nothing is still running', ctx.live().length, 0)
        await ctx.waitFor(
          'the server has no open download connections',
          () => ctx.server.networks().every((n) => n.connections === 0),
          15_000
        )
        const history = (await ctx.all()).filter((s) => s.status !== 'completed')
        ctx.expect('no half-finished entries in the history', history.length, 0)
      })
    }
  },
  {
    id: '16',
    title: 'Restart recovery',
    difficulty: 'Hard',
    manual: true,
    estimateSec: 60,
    timeoutSec: 300,
    steps: ['Start and pause a group', 'Write the restart note'],
    verifySteps: ['After the restart: what came back', 'Finish the downloads'],
    fixedDir: join(tmpdir(), 'plexo-lab-restart', 'files'),
    tests:
      'That a group you were part way through is still there, with its progress and its plan, after you quit and reopen Plexo, and that it can then be finished.',
    challenge:
      'This one needs you. The lab starts a group, pauses it, and then asks you to quit and reopen Plexo yourself. Plexo has to remember everything from its files on disk.',
    passLooksLike:
      'After you reopen Plexo and press Verify, the group is back with the same files, the downloads are paused with their progress kept, the waiting files are still waiting, and resuming finishes everything byte-exact.',
    async run(ctx) {
      const files = Array.from({ length: 3 }, (_, i) =>
        ctx.file({ name: `restart-${i + 1}.bin`, mb: 40 })
      )
      let groupId = ''
      const progress: Record<string, number> = {}
      await ctx.step('Start and pause a group', async () => {
        ctx.server.setSpeed(W, 1000)
        ctx.server.setSpeed(E, 1000)
        groupId = await ctx.startGroup({
          name: 'Restart check',
          mode: 'auto',
          networks: [W, E],
          files
        })
        await ctx.waitFor(
          'files are receiving data',
          async () =>
            (await Promise.all(files.map((f) => bytesOf(ctx, f)))).filter((n) => n > MB).length >=
            2,
          60_000,
          { fatal: true }
        )
        await ctx.sleep(3000)
        await ctx.pauseGroup(groupId)
        await ctx.waitFor(
          'nothing is downloading',
          () => !ctx.live().some((s) => s.status === 'downloading'),
          20_000
        )
        for (const file of files) progress[file.name] = await bytesOf(ctx, file)
        ctx.expect(
          'some data is saved',
          Object.values(progress).reduce((a, b) => a + b, 0),
          is.gt(2 * MB)
        )
        // Let the paused state reach the disk before the person quits.
        await ctx.sleep(1500)
      })
      await ctx.step('Write the restart note', async () => {
        await mkdir(join(tmpdir(), 'plexo-lab-restart'), { recursive: true })
        const group = ctx.group(groupId)
        await writeFile(
          RESTART_NOTE,
          JSON.stringify({
            planId: '16',
            tag: ctx.tag,
            port: ctx.server.port,
            groupId,
            groupName: group?.name,
            mode: group?.mode,
            pending: group?.pending.length ?? 0,
            files,
            progress,
            started: ctx.live().length
          })
        )
        ctx.expect('the note was written', existsSync(RESTART_NOTE), true)
        ctx.keep()
        ctx.awaitPerson(
          'Quit Plexo completely, open it again, open Debug, then press Verify on this plan.'
        )
      })
    },
    async verifyPort() {
      try {
        return (JSON.parse(await readFile(RESTART_NOTE, 'utf8')) as { port?: number }).port
      } catch {
        return undefined
      }
    },
    async verify(ctx) {
      const note = JSON.parse(await readFile(RESTART_NOTE, 'utf8')) as {
        tag: string
        groupId: string
        groupName: string
        mode: 'auto' | 'manual'
        pending: number
        files: LabFile[]
        progress: Record<string, number>
        started: number
      }
      ctx.adopt(note.tag, [note.groupId])
      await ctx.step('After the restart: what came back', async () => {
        ctx.server.setSpeed(W, 4000)
        ctx.server.setSpeed(E, 4000)
        const group = ctx.group(note.groupId)
        ctx.require('the group came back', group?.name, note.groupName)
        ctx.expect('with the same mode', group?.mode, note.mode)
        ctx.expect('the files still waiting are still waiting', group?.pending.length, note.pending)
        const live = ctx.live()
        ctx.expect('the started downloads are back', live.length, note.started)
        ctx.expect(
          'all of them are paused',
          live.filter((s) => s.status !== 'paused').map((s) => s.fileName),
          []
        )
        for (const state of live) {
          const file = note.files.find((f) => state.url.includes(f.path))
          const before = file ? (note.progress[file.name] ?? 0) : 0
          ctx.expect(
            `${state.fileName} kept its progress`,
            state.bytesDownloaded,
            is.gte(before * 0.9)
          )
        }
        ctx.expect('the plan is there (auto groups keep their plan)', group?.plan.mode, note.mode)
      })
      await ctx.step('Finish the downloads', async () => {
        await ctx.resumeGroup(note.groupId)
        await waitAll(ctx, note.files, 200_000)
        await verifyAll(ctx, note.files)
      })
    }
  }
]

export const LAB_PLANS = plans
