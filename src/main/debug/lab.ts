import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeError } from '../../shared/errors'
import type {
  LabAssertion,
  LabPlanInfo,
  LabPlanRun,
  LabRunStatus,
  LabState,
  LabStep
} from '../../shared/lab'
import type { PlanEvent } from '../../shared/types'
import { log } from '../logger'
import { FakeServer } from './fakeServer'
import {
  LabAbort,
  LabFatal,
  RunContext,
  type LabContext,
  type LabDeps,
  type RunHooks
} from './labContext'
import { RESTART_NOTE, LAB_PLANS } from './labPlans'
import { simNetworks } from './simNetworks'

// The Test lab's runner. It owns every run: it makes the plan's folder, starts the embedded
// server and the simulated networks, runs the plan's steps against the real app, records each
// step and assertion (to the window and to the log file), and cleans up whatever the outcome.

export interface LabPlan extends Omit<LabPlanInfo, 'manual'> {
  manual?: boolean
  /** Longer than this and the plan fails instead of hanging. Default: 3 x the estimate + 60 s. */
  timeoutSec?: number
  /** A folder that outlives the run (the restart plan). */
  fixedDir?: string
  run(ctx: LabContext): Promise<void>
  /** The second half of a manual plan, once the person has done their part. */
  verify?(ctx: LabContext): Promise<void>
  /** Steps of verify() (the others already ran). */
  verifySteps?: string[]
  /** The server port the first half used, so the links still work. */
  verifyPort?(): Promise<number | undefined>
}

const MAX_FEED = 400
const MAX_SAMPLES = 900
const MAX_PLAN_LOG = 300

function pad(n: number): string {
  return n.toFixed(1).padStart(5)
}

export class Lab {
  private server = new FakeServer()
  private state: LabState
  private abort: AbortController | null = null
  private pushTimer: NodeJS.Timeout | null = null
  private current: Promise<unknown> | null = null
  private stopRequested = false

  constructor(private deps: LabDeps) {
    this.state = {
      plans: LAB_PLANS.map((plan) => this.info(plan)),
      runs: {},
      running: null,
      runningAll: false,
      simActive: false,
      networks: []
    }
    simNetworks.onActiveChange((active) => {
      this.state.simActive = active
      this.emit()
    })
    void this.restoreAwaiting()
  }

  private info(plan: LabPlan): LabPlanInfo {
    return {
      id: plan.id,
      title: plan.title,
      difficulty: plan.difficulty,
      tests: plan.tests,
      challenge: plan.challenge,
      passLooksLike: plan.passLooksLike,
      estimateSec: plan.estimateSec,
      manual: plan.manual === true,
      steps: plan.verifySteps ? [...plan.steps, ...plan.verifySteps] : plan.steps
    }
  }

  list(): LabPlanInfo[] {
    return this.state.plans
  }

  getState(): LabState {
    return structuredClone(this.state)
  }

  /** After a restart, a manual plan that was waiting for it shows as waiting still. */
  private async restoreAwaiting(): Promise<void> {
    try {
      if (!existsSync(RESTART_NOTE)) return
      const note = JSON.parse(await readFile(RESTART_NOTE, 'utf8')) as { planId?: string }
      const plan = LAB_PLANS.find((entry) => entry.id === note.planId)
      if (!plan) return
      this.state.runs[plan.id] = {
        planId: plan.id,
        status: 'awaiting',
        steps: [],
        planLog: [],
        feed: [],
        samples: [],
        awaiting: 'Plexo was reopened. Press Verify to check that everything came back right.'
      }
      this.emit()
    } catch {
      // No usable note: nothing is waiting.
    }
  }

  private emit(): void {
    if (this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      this.deps.push()
    }, 150)
  }

  /** Runs now; used for the final state of a plan and the first state after a change. */
  private emitNow(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.pushTimer = null
    this.deps.push()
  }

  private busy(): void {
    if (this.state.running || this.current) throw new Error('A lab run is already going.')
  }

  async run(planId: string): Promise<LabPlanRun> {
    this.busy()
    const plan = this.planOf(planId)
    const work = this.session(async () => this.execute(plan, 'run'))
    this.current = work
    try {
      return await work
    } finally {
      this.current = null
    }
  }

  async verify(planId: string): Promise<LabPlanRun> {
    this.busy()
    const plan = this.planOf(planId)
    if (!plan.verify) throw new Error('This plan has no verify step.')
    const work = this.session(async () => this.execute(plan, 'verify'))
    this.current = work
    try {
      return await work
    } finally {
      this.current = null
    }
  }

  async runAll(): Promise<LabState> {
    this.busy()
    this.state.runningAll = true
    this.stopRequested = false
    this.state.report = undefined
    const work = this.session(async () => {
      for (const plan of LAB_PLANS) {
        if (this.stopRequested) break
        if (plan.manual) continue
        await this.execute(plan, 'run')
      }
      this.state.report = this.summary()
      log.info('lab', `Run all finished\n${this.state.report}`)
    })
    this.current = work
    try {
      await work
    } finally {
      this.current = null
      this.state.runningAll = false
      this.emitNow()
    }
    return this.getState()
  }

  /** Stops the run (its plan cleans up first) and puts the real networks back. */
  async stop(): Promise<void> {
    this.stopRequested = true
    this.abort?.abort(new LabAbort('stopped'))
    await this.current?.catch(() => {})
    if (simNetworks.isActive()) {
      simNetworks.disable()
      await this.deps.networks.refresh()
    }
    this.emitNow()
  }

  private planOf(planId: string): LabPlan {
    const plan = LAB_PLANS.find((entry) => entry.id === planId)
    if (!plan) throw new Error(`There is no test plan "${planId}".`)
    return plan
  }

  /** Simulated networks and the server exist for the length of one invocation. */
  private async session<T>(body: () => Promise<T>): Promise<T> {
    try {
      return await body()
    } finally {
      await this.server.stop()
      simNetworks.disable()
      await this.deps.networks.refresh()
      this.state.running = null
      this.emitNow()
    }
  }

  private summary(): string {
    const lines = ['Test lab: Run all']
    for (const plan of LAB_PLANS) {
      const run = this.state.runs[plan.id]
      const secs =
        run?.endedAt && run.startedAt ? ((run.endedAt - run.startedAt) / 1000).toFixed(0) : '-'
      const verdict =
        plan.manual && !run ? 'SKIPPED (needs a restart)' : (run?.status ?? 'not run').toUpperCase()
      lines.push(
        `  ${plan.id.padStart(2)}  ${verdict.padEnd(8)} ${secs.padStart(4)} s  ${plan.title}`
      )
    }
    const failed = LAB_PLANS.filter((plan) => this.state.runs[plan.id]?.status === 'fail').length
    lines.push(failed === 0 ? 'Result: PASS' : `Result: FAIL (${failed} plan(s) failed)`)
    return lines.join('\n')
  }

  private async execute(plan: LabPlan, mode: 'run' | 'verify'): Promise<LabPlanRun> {
    const abort = new AbortController()
    this.abort = abort
    let timedOut = false
    const limit = (plan.timeoutSec ?? plan.estimateSec * 3 + 60) * 1000
    const watchdog = setTimeout(() => {
      timedOut = true
      abort.abort(new LabAbort('timeout'))
    }, limit)

    const steps: LabStep[] = [...plan.steps, ...(mode === 'verify' ? (plan.verifySteps ?? []) : [])]
      .concat('Cleanup')
      .map((name) => ({ name, status: 'pending', assertions: [], notes: [] }))
    if (mode === 'verify') {
      for (const name of plan.steps) {
        const done = steps.find((step) => step.name === name)
        if (done) {
          done.status = 'pass'
          done.notes.push('Done before Plexo was restarted.')
        }
      }
    }
    const run: LabPlanRun = {
      planId: plan.id,
      status: 'running',
      startedAt: Date.now(),
      steps,
      planLog: [],
      feed: [],
      samples: [],
      awaiting: undefined
    }
    this.state.runs[plan.id] = run
    this.state.running = plan.id
    this.state.networks = []
    this.emitNow()

    const t0 = Date.now()
    const feed = (line: string): void => {
      run.feed.push(`[${pad((Date.now() - t0) / 1000)} s] ${line}`)
      if (run.feed.length > MAX_FEED) run.feed.splice(0, run.feed.length - MAX_FEED)
    }
    let currentStep: LabStep | null = null
    let awaiting: string | undefined
    const hooks: RunHooks = {
      planLog: run.planLog,
      record: (label, ok, expected, actual, hint) => {
        const step = currentStep ?? steps[0]
        const assertion: LabAssertion = { label, expected, actual, ok, hint }
        step.assertions.push(assertion)
        const line = `${plan.id} "${step.name}" ${ok ? 'PASS' : 'FAIL'} ${label}: expected ${expected}, got ${actual}${!ok && hint ? ` (${hint})` : ''}`
        if (ok) log.info('lab', line)
        else log.error('lab', line)
        feed(`${ok ? 'ok  ' : 'FAIL'} ${label}: expected ${expected}; got ${actual}`)
        this.emit()
      },
      note: (message) => {
        currentStep?.notes.push(message)
        log.info('lab', `${plan.id} ${message}`)
        feed(message)
        this.emit()
      },
      setAwaiting: (message) => {
        awaiting = message
      }
    }

    // Everything the run makes lives in its own folder under the system's temp folder.
    const dir =
      plan.fixedDir ?? (await mkdtemp(join(tmpdir(), `plexo-lab-${plan.id.replace(/\W/g, '')}-`)))
    await mkdir(dir, { recursive: true })

    let ctx: RunContext | null = null
    let sampler: NodeJS.Timeout | null = null
    try {
      simNetworks.enable()
      await this.deps.networks.refresh()
      const port = mode === 'verify' ? await plan.verifyPort?.() : undefined
      await this.server.start(port)
      this.server.reset()
      ctx = new RunContext(this.server, dir, abort.signal, this.deps, hooks)
      const own = ctx
      own.stepRunner = (name, fn) =>
        this.runStep(
          run,
          steps,
          name,
          fn,
          hooks,
          (step) => (currentStep = step),
          () => timedOut
        )
      log.info(
        'lab',
        `${plan.id} "${plan.title}" ${mode === 'verify' ? 'verify' : 'started'} (${plan.difficulty}, about ${plan.estimateSec} s)`
      )
      feed(`Started "${plan.title}"`)

      // A well-behaved baseline for every plan; plans change what they test. Restored at the end.
      await own.settings.set({
        downloadsAtOnce: 8,
        speedLimit: undefined,
        slowMode: false,
        useVpn: false
      })

      let last = this.server.counters()
      sampler = setInterval(() => {
        const now = this.server.counters()
        const perNetwork: Record<string, number> = {}
        for (const key of Object.keys(now)) {
          perNetwork[key] = now[key].bytes - (last[key]?.bytes ?? 0)
          if (!this.state.networks.includes(key)) this.state.networks.push(key)
        }
        last = now
        run.samples.push({ t: (Date.now() - t0) / 1000, perNetwork })
        if (run.samples.length > MAX_SAMPLES)
          run.samples.splice(0, run.samples.length - MAX_SAMPLES)
        this.collectPlanLog(own, run)
        this.emit()
      }, 1000)

      try {
        if (mode === 'verify') await plan.verify!(own)
        else await plan.run(own)
      } catch (error) {
        if (error instanceof LabAbort) throw error
        if (error instanceof LabFatal) {
          log.error('lab', `${plan.id} stopped early: ${error.message}`)
        } else {
          hooks.record(
            'the plan ran without an unexpected error',
            false,
            'no error',
            describeError(error),
            undefined
          )
        }
      }
      this.collectPlanLog(own, run)
    } catch (error) {
      if (!(error instanceof LabAbort)) {
        log.error('lab', `${plan.id} could not run`, error)
        hooks.record(
          'the lab could set the plan up',
          false,
          'ready',
          describeError(error),
          undefined
        )
      }
    } finally {
      clearTimeout(watchdog)
      if (sampler) clearInterval(sampler)
    }

    const aborted = abort.signal.aborted
    // The wait for the person is over for good once the plan has stopped.
    const keepForPerson = !aborted && awaiting !== undefined
    if (ctx) {
      if (keepForPerson) ctx.keep()
      const cleanup = steps[steps.length - 1]
      cleanup.status = 'running'
      cleanup.startedAt = Date.now()
      currentStep = cleanup
      this.emit()
      const problems = await ctx.cleanup()
      cleanup.assertions.push({
        label: keepForPerson
          ? 'files are kept for the restart check'
          : 'everything the plan made was removed (downloads, groups, test files, settings, networks)',
        expected: keepForPerson ? 'kept' : 'nothing left',
        actual: keepForPerson
          ? 'kept'
          : problems.length === 0
            ? 'nothing left'
            : problems.join('; '),
        ok: keepForPerson || problems.length === 0,
        hint: 'A leftover means the app did not clean up after cancelling or removing.'
      })
      cleanup.status = cleanup.assertions.every((a) => a.ok) ? 'pass' : 'fail'
      cleanup.endedAt = Date.now()
      log[cleanup.status === 'pass' ? 'info' : 'error'](
        'lab',
        `${plan.id} cleanup ${cleanup.status}${problems.length ? `: ${problems.join('; ')}` : ''}`
      )
    } else {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
    if (mode === 'verify' && !aborted) await rm(RESTART_NOTE, { force: true }).catch(() => {})

    for (const step of steps)
      if (step.status === 'pending' || step.status === 'running') step.status = 'skipped'
    run.endedAt = Date.now()
    let status: LabRunStatus
    if (timedOut) status = 'fail'
    else if (aborted) status = 'stopped'
    else if (keepForPerson) status = 'awaiting'
    else status = steps.some((step) => step.status === 'fail') ? 'fail' : 'pass'
    run.status = status
    run.awaiting = keepForPerson ? awaiting : undefined
    run.report = this.report(plan, run)
    log[status === 'fail' ? 'error' : 'info'](
      'lab',
      `${plan.id} "${plan.title}" ${status.toUpperCase()} in ${((run.endedAt - (run.startedAt ?? run.endedAt)) / 1000).toFixed(0)} s\n${run.report}`
    )
    this.abort = null
    this.emitNow()
    return structuredClone(run)
  }

  private collectPlanLog(ctx: RunContext, run: LabPlanRun): void {
    const seen = new Set(run.planLog.map((event) => `${event.at}|${event.text}`))
    const added: PlanEvent[] = []
    for (const id of ctx.ownGroups) {
      for (const event of ctx.group(id)?.plan.log ?? []) {
        if (!seen.has(`${event.at}|${event.text}`)) added.push(event)
      }
    }
    if (added.length === 0) return
    run.planLog.push(...added)
    run.planLog.sort((a, b) => a.at - b.at)
    if (run.planLog.length > MAX_PLAN_LOG) run.planLog.splice(0, run.planLog.length - MAX_PLAN_LOG)
  }

  private async runStep(
    run: LabPlanRun,
    steps: LabStep[],
    name: string,
    fn: () => Promise<void>,
    hooks: RunHooks,
    setCurrent: (step: LabStep) => void,
    timedOut: () => boolean
  ): Promise<void> {
    let step = steps.find((entry) => entry.name === name)
    if (!step) {
      step = { name, status: 'pending', assertions: [], notes: [] }
      steps.splice(steps.length - 1, 0, step)
    }
    setCurrent(step)
    step.status = 'running'
    step.startedAt = Date.now()
    log.info('lab', `${run.planId} step "${name}" started`)
    this.emit()
    try {
      await fn()
    } catch (error) {
      if (error instanceof LabAbort) {
        step.status = 'fail'
        step.error = timedOut()
          ? 'The plan ran out of time during this step.'
          : 'Stopped before this step finished.'
        step.endedAt = Date.now()
        throw error
      }
      if (error instanceof LabFatal) {
        step.status = 'fail'
        step.error = error.message
        step.endedAt = Date.now()
        throw error
      }
      step.error = describeError(error)
      hooks.record(
        'the step ran without an unexpected error',
        false,
        'no error',
        step.error,
        undefined
      )
    }
    step.endedAt = Date.now()
    step.status = step.assertions.some((a) => !a.ok) || step.error ? 'fail' : 'pass'
    log[step.status === 'pass' ? 'info' : 'error'](
      'lab',
      `${run.planId} step "${name}" ${step.status.toUpperCase()}`
    )
    this.emit()
  }

  private report(plan: LabPlan, run: LabPlanRun): string {
    const seconds =
      run.endedAt && run.startedAt ? ((run.endedAt - run.startedAt) / 1000).toFixed(0) : '?'
    const lines = [
      `Plexo Test lab: ${plan.id} ${plan.title} (${plan.difficulty})`,
      `Result: ${run.status.toUpperCase()} in ${seconds} s`
    ]
    for (const step of run.steps) {
      const mark = {
        pass: 'PASS',
        fail: 'FAIL',
        skipped: 'SKIP',
        pending: '....',
        running: '....'
      }[step.status]
      lines.push(`  [${mark}] ${step.name}`)
      if (step.error) lines.push(`         error: ${step.error}`)
      for (const a of step.assertions) {
        lines.push(`         ${a.ok ? 'ok  ' : 'FAIL'} ${a.label}`)
        if (!a.ok) {
          lines.push(`              expected: ${a.expected}`)
          lines.push(`              actual:   ${a.actual}`)
          if (a.hint) lines.push(`              hint:     ${a.hint}`)
        }
      }
    }
    if (run.planLog.length > 0) {
      lines.push('  Planner log:')
      for (const event of run.planLog.slice(-40)) {
        lines.push(
          `    ${new Date(event.at).toISOString().slice(11, 19)} ${event.kind}: ${event.text}`
        )
      }
    }
    return lines.join('\n')
  }
}
