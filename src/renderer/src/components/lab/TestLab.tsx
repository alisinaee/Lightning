import { PlayIcon, SquareIcon } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useLabStore } from '../../store/useLabStore'
import { TITLE_BAR_HEIGHT } from '../../theme'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { Separator } from '../ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet'
import { PlanCard } from './PlanCard'
import { CopyReportButton, ReportView } from './ReportView'

const MIN_WIDTH = 420

/** The Test lab: a panel on the right that runs real, automatic workflows against the real app
 * while the main window stays in view and usable. The main process runs everything (see
 * main/debug/lab.ts); this shows what it pushes. */
export function TestLab(): React.JSX.Element {
  const open = useLabStore((store) => store.open)
  const setOpen = useLabStore((store) => store.setOpen)
  const width = useLabStore((store) => store.width)
  const setWidth = useLabStore((store) => store.setWidth)
  const state = useLabStore((store) => store.state)
  const error = useLabStore((store) => store.error)
  const run = useLabStore((store) => store.run)
  const runAll = useLabStore((store) => store.runAll)
  const verify = useLabStore((store) => store.verify)
  const stop = useLabStore((store) => store.stop)

  const running = state?.running ?? null
  useEffect(() => {
    if (running) {
      document
        .getElementById(`lab-plan-${running}`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [running])

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const move = (e: PointerEvent): void =>
        setWidth(
          Math.min(Math.max(window.innerWidth - e.clientX, MIN_WIDTH), window.innerWidth - 240)
        )
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [setWidth]
  )

  const busy = running !== null || state?.runningAll === true
  const finished = state
    ? Object.values(state.runs).filter((r) => r.status === 'pass' || r.status === 'fail')
    : []
  return (
    <Sheet open={open} onOpenChange={setOpen} modal={false} disablePointerDismissal>
      <SheetContent
        overlay={false}
        showCloseButton
        className="gap-0 p-0 data-[side=right]:w-auto data-[side=right]:sm:max-w-none"
        // Below the title bar, so its Debug button still closes the panel.
        style={{
          top: TITLE_BAR_HEIGHT,
          bottom: 0,
          height: 'auto',
          width: Math.min(width, window.innerWidth - 120)
        }}
        aria-label="Test lab"
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the Test lab"
          onPointerDown={startResize}
          className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-primary/30"
        />
        <SheetHeader className="gap-1 border-b p-4 pr-12">
          <SheetTitle>Test lab</SheetTitle>
          <SheetDescription>
            Real downloads, groups and Auto planning, run for you against pretend networks and a
            built-in server. Watch the list behind this panel while a plan runs.
          </SheetDescription>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy} onClick={runAll}>
              <PlayIcon data-icon="inline-start" />
              Run all
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!busy && !state?.simActive}
              onClick={stop}
            >
              <SquareIcon data-icon="inline-start" />
              {busy ? 'Stop' : 'Restore real networks'}
            </Button>
            <CopyReportButton report={state?.report} label="Copy Run all report" />
            {state?.simActive && (
              <span className="text-xs text-amber-700 dark:text-amber-300">
                Simulated networks are on
              </span>
            )}
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 p-4">
            {state?.report && (
              <div className="space-y-2 rounded-xl border bg-card p-3.5">
                <div className="text-sm font-semibold">Run all</div>
                <ReportView report={state.report} />
              </div>
            )}
            {!state && <div className="text-sm text-muted-foreground">Loading the plans...</div>}
            {state?.plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                run={state.runs[plan.id]}
                networks={state.networks}
                busy={busy}
                onRun={() => run(plan.id)}
                onVerify={() => verify(plan.id)}
              />
            ))}
            <Separator />
            <p className="pb-2 text-xs text-muted-foreground">
              {finished.length} of {state?.plans.length ?? 0} plans run so far. Reports are also
              written to the log file (lines tagged [lab]).
            </p>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
