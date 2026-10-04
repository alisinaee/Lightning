import type { LabPlanInfo, LabPlanRun, LabRunStatus } from '@shared/lab'
import { PlayIcon, ShieldCheckIcon } from 'lucide-react'
import { cn } from 'cn'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { Progress } from '../ui/progress'
import { LabChart } from './LabChart'
import { CopyReportButton, ReportView } from './ReportView'
import { StatusIcon, Timeline } from './Timeline'

const DIFFICULTY_VARIANT = {
  Easy: 'secondary',
  Hard: 'default',
  Brutal: 'destructive'
} as const

const RUN_LABEL: Record<LabRunStatus, string> = {
  idle: '',
  running: 'Running',
  pass: 'PASS',
  fail: 'FAIL',
  stopped: 'Stopped',
  awaiting: 'Waiting for you'
}

const RUN_STYLE: Record<LabRunStatus, string> = {
  idle: '',
  running: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  pass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  fail: 'bg-destructive/15 text-destructive',
  stopped: 'bg-muted text-muted-foreground',
  awaiting: 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
}

function duration(seconds: number): string {
  if (seconds < 90) return `about ${Math.round(seconds / 5) * 5 || 5} s`
  return `about ${Math.round(seconds / 60)} min`
}

function Copy({ title, children }: { title: string; children: string }): React.JSX.Element {
  return (
    <div>
      <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </div>
      <p className="text-[13px] leading-snug">{children}</p>
    </div>
  )
}

interface PlanCardProps {
  plan: LabPlanInfo
  run: LabPlanRun | undefined
  networks: string[]
  /** Some plan is running: no other can start. */
  busy: boolean
  onRun: () => void
  onVerify: () => void
}

export function PlanCard({
  plan,
  run,
  networks,
  busy,
  onRun,
  onVerify
}: PlanCardProps): React.JSX.Element {
  const running = run?.status === 'running'
  const total = run?.steps.length ?? plan.steps.length + 1
  const done =
    run?.steps.filter((s) => s.status === 'pass' || s.status === 'fail' || s.status === 'skipped')
      .length ?? 0
  const elapsed =
    run?.endedAt && run.startedAt
      ? (run.endedAt - run.startedAt) / 1000
      : (run?.samples[run.samples.length - 1]?.t ?? 0)
  const shown = run?.status && run.status !== 'idle' ? run : undefined
  return (
    <div
      id={`lab-plan-${plan.id}`}
      className={cn(
        'rounded-xl border bg-card p-3.5 shadow-xs transition-shadow',
        running && 'border-sky-500/60 shadow-md ring-2 ring-sky-500/30',
        run?.status === 'fail' && 'border-destructive/50'
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground tabular-nums">#{plan.id}</span>
            <h3 className="text-sm leading-tight font-semibold">{plan.title}</h3>
            <Badge variant={DIFFICULTY_VARIANT[plan.difficulty]}>{plan.difficulty}</Badge>
            <Badge variant="outline">{duration(plan.estimateSec)}</Badge>
            {plan.manual && <Badge variant="outline">needs you</Badge>}
          </div>
        </div>
        {shown && (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-semibold',
              RUN_STYLE[shown.status]
            )}
          >
            {RUN_LABEL[shown.status]}
          </span>
        )}
        {run?.status === 'awaiting' && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={onVerify}>
            <ShieldCheckIcon data-icon="inline-start" />
            Verify
          </Button>
        )}
        <Button size="sm" disabled={busy} onClick={onRun}>
          <PlayIcon data-icon="inline-start" />
          Run
        </Button>
      </div>

      <div className="mt-2.5 grid gap-2">
        <Copy title="What it tests">{plan.tests}</Copy>
        <Copy title="The challenge">{plan.challenge}</Copy>
        <Copy title="What a pass looks like">{plan.passLooksLike}</Copy>
      </div>

      {run?.awaiting && (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[13px]">
          {run.awaiting}
        </div>
      )}

      {shown && (
        <div className="mt-3 space-y-3 border-t pt-3">
          <div className="flex items-center gap-3">
            <Progress value={Math.round((done / total) * 100)} className="flex-1" />
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {done}/{total} steps
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {elapsed.toFixed(0)} s
            </span>
          </div>
          {shown.status !== 'awaiting' || shown.steps.length > 0 ? (
            <Timeline steps={shown.steps} />
          ) : null}
          {shown.samples.length > 1 && <LabChart samples={shown.samples} networks={networks} />}
          {shown.planLog.length > 0 && (
            <Collapsible defaultOpen>
              <CollapsibleTrigger className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Plan log ({shown.planLog.length})
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto rounded-lg border bg-muted/40 p-2 text-[11px]">
                  {shown.planLog.map((event, index) => (
                    <div key={index} className="flex gap-2">
                      <span className="text-muted-foreground tabular-nums">
                        {new Date(event.at).toLocaleTimeString([], { hour12: false })}
                      </span>
                      <span className="w-12 shrink-0 font-medium">{event.kind}</span>
                      <span>{event.text}</span>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
          {shown.feed.length > 0 && (
            <Collapsible defaultOpen={running}>
              <CollapsibleTrigger className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Activity ({shown.feed.length})
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
                  {shown.feed.map((line, index) => (
                    <div key={index} className={cn(line.includes('] FAIL') && 'text-destructive')}>
                      {line}
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
          {shown.report && !running && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <StatusIcon
                  status={
                    shown.status === 'pass' ? 'pass' : shown.status === 'fail' ? 'fail' : 'skipped'
                  }
                />
                <span className="text-sm font-semibold">
                  {shown.status === 'pass'
                    ? 'PASS'
                    : shown.status === 'fail'
                      ? 'FAIL'
                      : RUN_LABEL[shown.status]}
                </span>
                <span className="flex-1" />
                <CopyReportButton report={shown.report} />
              </div>
              <ReportView report={shown.report} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
