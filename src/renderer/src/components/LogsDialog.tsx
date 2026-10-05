import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from 'cn'
import { useLogsStore } from '../store/useLogsStore'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'

type Level = 'INFO' | 'WARN' | 'ERROR'
const LEVELS: Level[] = ['INFO', 'WARN', 'ERROR']
const LINES = 500

const levelOf = (line: string): Level => {
  const match = /^\S+\s+(INFO|WARN|ERROR)\s/.exec(line)
  return (match?.[1] as Level | undefined) ?? 'INFO'
}

/** The app's log, in the window: the latest lines with a level filter and search, and the
 * buttons that hand it to whoever is helping (copy, the folder, a diagnostic report). */
export function LogsDialog(): React.JSX.Element {
  const open = useLogsStore((store) => store.open)
  const setOpen = useLogsStore((store) => store.setOpen)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton
        className="flex h-[600px] max-h-[calc(100%-2rem)] w-[860px] max-w-[calc(100%-2rem)] flex-col gap-3 sm:max-w-[calc(100%-2rem)]"
      >
        {open && <LogsView />}
      </DialogContent>
    </Dialog>
  )
}

function LogsView(): React.JSX.Element {
  const [lines, setLines] = useState<string[]>([])
  const [levels, setLevels] = useState<Level[]>(LEVELS)
  const [search, setSearch] = useState('')
  const [auto, setAuto] = useState(true)
  const [note, setNote] = useState('')
  const box = useRef<HTMLDivElement>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      setLines(await window.plexo.readLog(LINES))
    } catch (error) {
      setNote(`Could not read the log: ${String(error)}`)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first read on opening
    void load()
    if (!auto) return
    const timer = setInterval(() => void load(), 2000)
    return () => clearInterval(timer)
  }, [load, auto])

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return lines.filter(
      (line) => levels.includes(levelOf(line)) && (!needle || line.toLowerCase().includes(needle))
    )
  }, [lines, levels, search])

  useEffect(() => {
    const element = box.current
    if (element) element.scrollTop = element.scrollHeight
  }, [shown.length])

  const copy = async (text: string, what: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setNote(`Copied ${what}`)
    } catch {
      setNote('Could not copy')
    }
  }

  const toggle = (level: Level): void =>
    setLevels((current) =>
      current.includes(level) ? current.filter((entry) => entry !== level) : [...current, level]
    )

  return (
    <>
      <div>
        <DialogTitle className="text-[16px] font-semibold">Logs</DialogTitle>
        <DialogDescription className="text-[12px]">
          The latest {LINES} lines. Links are shown without their query strings.
        </DialogDescription>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {LEVELS.map((level) => (
          <Button
            key={level}
            type="button"
            size="sm"
            variant={levels.includes(level) ? 'secondary' : 'ghost'}
            aria-pressed={levels.includes(level)}
            onClick={() => toggle(level)}
          >
            {level[0] + level.slice(1).toLowerCase()}
          </Button>
        ))}
        <Input
          type="search"
          aria-label="Search the log"
          placeholder="Search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-8 w-[200px] text-[12.5px]"
        />
        <label className="flex items-center gap-1.5 text-[12.5px]">
          <input
            type="checkbox"
            checked={auto}
            onChange={(event) => setAuto(event.target.checked)}
          />
          Auto-refresh
        </label>
        <Button type="button" size="sm" variant="ghost" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      <div
        ref={box}
        role="log"
        aria-label="Log lines"
        className="min-h-0 flex-1 overflow-auto rounded-[9px] border-[0.5px] border-border bg-card p-2 font-mono text-[11px] leading-[1.45]"
      >
        {shown.length === 0 && <div className="text-muted-foreground">No lines to show.</div>}
        {shown.map((line, index) => (
          <div
            key={index}
            className={cn(
              'break-all whitespace-pre-wrap',
              levelOf(line) === 'ERROR' && 'text-destructive',
              levelOf(line) === 'WARN' && 'text-[var(--color-usb-text)]'
            )}
          >
            {line}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void copy(lines.join('\n'), 'all lines')}
        >
          Copy all
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() =>
            void copy(lines.filter((line) => levelOf(line) === 'ERROR').join('\n'), 'errors')
          }
        >
          Copy errors only
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() =>
            void window.plexo.diagnosticReport().then((report) => copy(report, 'the report'))
          }
        >
          Copy diagnostic report
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void window.plexo.openLogFolder()}
        >
          Open log folder
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={() => void window.plexo.clearLog().then(load)}
        >
          Clear
        </Button>
        <span role="status" className="ml-auto text-[12px] text-muted-foreground">
          {note}
        </span>
      </div>
    </>
  )
}
