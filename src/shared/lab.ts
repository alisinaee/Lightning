import type { PlanEvent } from './types'

// What the Test lab (main/debug/lab.ts) tells the window. The main process owns every run; the
// window only shows this state, as it is pushed.

export type LabDifficulty = 'Easy' | 'Hard' | 'Brutal'

/** A plan as the window lists it, in plain words. */
export interface LabPlanInfo {
  id: string
  title: string
  difficulty: LabDifficulty
  /** What it tests, what makes it hard, and what a pass looks like: for a non-developer. */
  tests: string
  challenge: string
  passLooksLike: string
  estimateSec: number
  /** Needs the person to restart the app part way (see the restart plan). */
  manual: boolean
  /** The steps it goes through, in order. */
  steps: string[]
}

export type LabStepStatus = 'pending' | 'running' | 'pass' | 'fail' | 'skipped'

export interface LabAssertion {
  label: string
  expected: string
  actual: string
  ok: boolean
  hint?: string
}

export interface LabStep {
  name: string
  status: LabStepStatus
  startedAt?: number
  endedAt?: number
  assertions: LabAssertion[]
  /** Plain remarks made while the step ran. */
  notes: string[]
  error?: string
}

/** What the plan finished as. `awaiting`: it needs the person (restart the app, then Verify). */
export type LabRunStatus = 'idle' | 'running' | 'pass' | 'fail' | 'stopped' | 'awaiting'

export interface LabSample {
  /** Seconds since the run began. */
  t: number
  /** Bytes a second each network's server counter saw. */
  perNetwork: Record<string, number>
}

export interface LabPlanRun {
  planId: string
  status: LabRunStatus
  startedAt?: number
  endedAt?: number
  steps: LabStep[]
  /** The planner's own log of the groups the plan made, oldest first. */
  planLog: PlanEvent[]
  /** One line per thing that happened, as written to the log file. */
  feed: string[]
  samples: LabSample[]
  /** Set when a plan wants the person to do something. */
  awaiting?: string
  report?: string
}

export interface LabState {
  plans: LabPlanInfo[]
  runs: Record<string, LabPlanRun>
  /** The plan running now. */
  running: string | null
  runningAll: boolean
  /** The simulated networks stand in for the real ones. */
  simActive: boolean
  /** The networks the server saw, in the order they showed up, for the chart's colours. */
  networks: string[]
  /** The report of the last Run all. */
  report?: string
}

export interface LabEvent {
  kind: 'state'
  state: LabState
}
