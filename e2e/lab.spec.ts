import type {} from '../src/preload/globals'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import type { LabPlanRun } from '../src/shared/lab'
import { PROJECT_ROOT } from './fixtures'

// The Test lab (main/debug/lab.ts) run headlessly through its IPC. Each plan is a workflow against
// the real app, so a failure here prints the plan's own report. The app runs with its real
// defaults (no test knobs): this is the app as a person gets it, except for a hidden window.
//
// LAB_PLANS=0,1 picks other plans; LAB_PLANS=all runs every one (about 20 minutes).

const PLANS = (process.env.LAB_PLANS ?? '0,1,2,9,10').split(',').map((id) => id.trim())

test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let userData: string

async function launch(): Promise<void> {
  app = await electron.launch({
    args: [PROJECT_ROOT, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: {
      ...(process.env as Record<string, string>),
      LIGHTNING_USER_DATA: userData,
      LIGHTNING_E2E_HIDE_WINDOW: '1',
      LIGHTNING_E2E_DHT: '0',
      LIGHTNING_E2E_NETWORK_STABLE_MS: '1',
      // Pretend an update exists that was already dismissed, so the real check can't raise a
      // dialog over the window part way through.
      LIGHTNING_FORCE_UPDATE_VERSION: '0.0.1-lab'
    }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
}

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), 'lightning-lab-e2e-'))
  await writeFile(
    join(userData, 'app-settings.json'),
    JSON.stringify({ dismissedUpdateVersion: '0.0.1-lab', prefs: { showDebug: true } })
  )
  await launch()
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
  await rm(userData, { recursive: true, force: true })
})

const runPlan = (id: string): Promise<LabPlanRun> =>
  page.evaluate((planId) => window.lightning.labRun(planId), id)

test('the Debug button opens the Test lab and a plan runs from it', async () => {
  test.setTimeout(90_000)
  await page.getByRole('button', { name: /Debug/ }).click()
  const card = page.locator('#lab-plan-0')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Self-check')
  await expect(card).toContainText('What a pass looks like')
  // The main window stays usable beside the panel.
  await expect(page.getByRole('button', { name: 'New download' }).first()).toBeVisible()
  // The self-check is over in a fraction of a second, so the banner can come and go between two
  // polls: watch the lab's own events for the simulation being on, then off again.
  await page.evaluate(() => {
    const w = window as unknown as { __simSeen: boolean[] }
    w.__simSeen = []
    window.lightning.onLabEvent((event) => w.__simSeen.push(event.state.simActive))
  })
  await card.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(card.getByText('PASS', { exact: true }).first()).toBeVisible({ timeout: 60_000 })
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __simSeen: boolean[] }).__simSeen))
    .toEqual(expect.arrayContaining([true, false]))
  await expect(page.getByText('Test lab: simulated networks are active')).toBeHidden()
  await expect(card.getByRole('button', { name: 'Copy report' })).toBeVisible()
  if (process.env.LAB_SHOT) await page.screenshot({ path: process.env.LAB_SHOT })
})

test('the lab lists its plans', async () => {
  const plans = await page.evaluate(() => window.lightning.labList())
  expect(plans.map((plan) => plan.id)).toEqual(
    expect.arrayContaining([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
      '13',
      '14',
      '15',
      '16'
    ])
  )
  for (const plan of plans) {
    expect(plan.tests.length, plan.title).toBeGreaterThan(30)
    expect(plan.challenge.length, plan.title).toBeGreaterThan(30)
    expect(plan.passLooksLike.length, plan.title).toBeGreaterThan(30)
  }
})

const wanted = (id: string): boolean => (PLANS.includes('all') ? id !== '16' : PLANS.includes(id))

for (const id of [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15'
]) {
  test(`plan ${id} passes`, async () => {
    test.skip(!wanted(id), `not in LAB_PLANS (${PLANS.join(',')})`)
    test.setTimeout(10 * 60_000)
    const began = Date.now()
    const run = await runPlan(id)
    if (process.env.LAB_VERBOSE) console.log(run.report)
    console.log(`plan ${id}: ${run.status} in ${((Date.now() - began) / 1000).toFixed(0)} s`)
    expect(run.status, run.report).toBe('pass')
    // The lab puts everything back.
    const state = await page.evaluate(() => window.lightning.labGetState())
    expect(state.simActive).toBe(false)
    expect(await page.evaluate(() => window.lightning.listDownloads())).toEqual([])
  })
}

test('plan 16 survives a restart', async () => {
  test.skip(!PLANS.includes('16'), 'set LAB_PLANS=16 to run the restart plan')
  test.setTimeout(6 * 60_000)
  const first = await runPlan('16')
  expect(first.status, first.report).toBe('awaiting')
  await app.close()
  await launch()
  const state = await page.evaluate(() => window.lightning.labGetState())
  expect(state.runs['16']?.status).toBe('awaiting')
  const second = await page.evaluate(() => window.lightning.labVerify('16'))
  expect(second.status, second.report).toBe('pass')
})

test('Run all completes end to end', async () => {
  test.skip(!PLANS.includes('runall'), 'set LAB_PLANS=runall (about 12 minutes)')
  test.setTimeout(30 * 60_000)
  const began = Date.now()
  const state = await page.evaluate(() => window.lightning.labRunAll())
  console.log(`Run all took ${((Date.now() - began) / 1000).toFixed(0)} s\n${state.report}`)
  const failed = Object.values(state.runs).filter((run) => run.status !== 'pass')
  expect(failed.map((run) => run.report)).toEqual([])
  expect(state.simActive).toBe(false)
})
