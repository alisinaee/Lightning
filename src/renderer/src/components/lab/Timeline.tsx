import type { LabStep, LabStepStatus } from '@shared/lab'
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  CircleXIcon,
  LoaderCircleIcon
} from 'lucide-react'
import { useState } from 'react'
import { cn } from 'cn'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'

const STATUS_STYLE: Record<LabStepStatus, string> = {
  pass: 'text-emerald-600 dark:text-emerald-400',
  fail: 'text-destructive',
  running: 'text-sky-600 dark:text-sky-400',
  pending: 'text-muted-foreground',
  skipped: 'text-muted-foreground'
}

export function StatusIcon({
  status,
  className
}: {
  status: LabStepStatus
  className?: string
}): React.JSX.Element {
  const Icon = {
    pass: CircleCheckIcon,
    fail: CircleXIcon,
    running: LoaderCircleIcon,
    pending: CircleDashedIcon,
    skipped: CircleMinusIcon
  }[status]
  return (
    <Icon
      className={cn(
        'size-4 shrink-0',
        STATUS_STYLE[status],
        status === 'running' && 'animate-spin',
        className
      )}
    />
  )
}

function seconds(step: LabStep): string {
  if (!step.startedAt) return ''
  if (!step.endedAt) return '...'
  return `${((step.endedAt - step.startedAt) / 1000).toFixed(1)} s`
}

function StepRow({ step }: { step: LabStep }): React.JSX.Element {
  // A failed step opens by itself, so the reason is the first thing seen.
  const [toggled, setToggled] = useState<boolean | null>(null)
  const open = toggled ?? step.status === 'fail'
  const failed = step.assertions.filter((a) => !a.ok).length
  const detail = step.assertions.length > 0 || step.notes.length > 0 || step.error
  return (
    <Collapsible open={open} onOpenChange={(next) => setToggled(next)}>
      <CollapsibleTrigger
        disabled={!detail}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
          detail && 'hover:bg-muted',
          step.status === 'running' && 'bg-sky-500/10'
        )}
      >
        <StatusIcon status={step.status} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            step.status === 'pending' && 'text-muted-foreground'
          )}
        >
          {step.name}
        </span>
        {step.assertions.length > 0 && (
          <span
            className={cn(
              'text-[11px] tabular-nums',
              failed ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {failed ? `${failed} failed of ` : ''}
            {step.assertions.length} checks
          </span>
        )}
        <span className="w-12 text-right text-[11px] text-muted-foreground tabular-nums">
          {seconds(step)}
        </span>
        {detail && (
          <ChevronRightIcon
            className={cn(
              'size-3.5 text-muted-foreground transition-transform',
              open && 'rotate-90'
            )}
          />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 mb-2 ml-6 space-y-1 border-l pl-3">
          {step.error && <div className="text-xs text-destructive">{step.error}</div>}
          {step.assertions.map((assertion, index) => (
            <div key={index} className="text-xs leading-snug">
              <div className="flex items-start gap-1.5">
                <StatusIcon status={assertion.ok ? 'pass' : 'fail'} className="mt-px size-3.5" />
                <span className="font-medium">{assertion.label}</span>
              </div>
              <div className="ml-5 font-mono text-[11px] text-muted-foreground">
                expected <span className="text-foreground">{assertion.expected}</span> · got{' '}
                <span
                  className={assertion.ok ? 'text-foreground' : 'font-semibold text-destructive'}
                >
                  {assertion.actual}
                </span>
              </div>
              {!assertion.ok && assertion.hint && (
                <div className="ml-5 text-[11px] text-destructive">{assertion.hint}</div>
              )}
            </div>
          ))}
          {step.notes.map((note, index) => (
            <div key={`n${index}`} className="text-[11px] text-muted-foreground italic">
              {note}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The steps of a run, each opening to its checks (what was expected and what happened). */
export function Timeline({ steps }: { steps: LabStep[] }): React.JSX.Element {
  return (
    <div className="space-y-0.5">
      {steps.map((step) => (
        <StepRow key={step.name} step={step} />
      ))}
    </div>
  )
}
