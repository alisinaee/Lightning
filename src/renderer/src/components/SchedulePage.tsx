import { DEFAULT_SCHEDULE, type ScheduleRule, type ScheduleSettings } from '@shared/schedule'
import { Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { SpeedInput } from './LimitFields'

/** Monday first, as the week is read; the numbers are Date.getDay()'s. */
const DAYS: [number, string][] = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [0, 'Sun']
]
const DEFAULT_CAP = 1024 * 1024

const newRule = (): ScheduleRule => ({
  id: crypto.randomUUID(),
  days: [0, 1, 2, 3, 4, 5, 6],
  start: '02:00',
  end: '07:00',
  action: 'run'
})

/** The Schedule page of Settings: weekly windows in which downloads run, are held, or are slowed. */
export function SchedulePage({
  value,
  onChange
}: {
  value: ScheduleSettings
  onChange: (next: ScheduleSettings) => void
}): React.JSX.Element {
  const update = (id: string, patch: Partial<ScheduleRule>): void =>
    onChange({
      ...value,
      rules: value.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
    })
  const remove = (id: string): void =>
    onChange({ ...value, rules: value.rules.filter((rule) => rule.id !== id) })

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-start gap-3 py-1.5 text-[13px] leading-5">
        <Checkbox
          checked={value.enabled}
          onCheckedChange={(enabled) => onChange({ ...value, enabled: enabled === true })}
        />
        <span>Use a schedule for downloads</span>
      </label>
      <p className="text-[12px] leading-snug text-muted-foreground">
        With a <b>Run</b> window, downloads go only inside it (and wait in the queue outside). A{' '}
        <b>Pause</b> window holds them. A window may cross midnight, such as 22:00 to 06:00.
        Lightning has to be running: it holds a computer awake only while a download is going.
      </p>
      {value.rules.map((rule) => (
        <div
          key={rule.id}
          className={`flex flex-col gap-2 rounded-[9px] border-[0.5px] border-border p-3 ${
            value.enabled ? '' : 'opacity-60'
          }`}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {DAYS.map(([day, label]) => {
              const on = rule.days.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    update(rule.id, {
                      days: on ? rule.days.filter((d) => d !== day) : [...rule.days, day].sort()
                    })
                  }
                  className={`h-6 rounded-full border px-2 text-[12px] ${
                    on ? 'border-transparent bg-primary/15 font-medium' : 'border-border opacity-70'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <select
              aria-label="What this window does"
              value={rule.action}
              onChange={(event) =>
                update(rule.id, { action: event.target.value as 'run' | 'pause' })
              }
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-[13px]"
            >
              <option value="run">Run</option>
              <option value="pause">Pause</option>
            </select>
            <span className="text-muted-foreground">from</span>
            <input
              type="time"
              aria-label="Start time"
              value={rule.start}
              onChange={(event) =>
                event.target.value && update(rule.id, { start: event.target.value })
              }
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-[13px]"
            />
            <span className="text-muted-foreground">to</span>
            <input
              type="time"
              aria-label="End time"
              value={rule.end}
              onChange={(event) =>
                event.target.value && update(rule.id, { end: event.target.value })
              }
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-[13px]"
            />
            <div className="flex-1" />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove this window"
              onClick={() => remove(rule.id)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          {rule.action === 'run' && (
            <label className="flex items-center gap-2 text-[12.5px]">
              <Checkbox
                checked={rule.speedCap !== undefined}
                onCheckedChange={(on) =>
                  update(rule.id, { speedCap: on === true ? DEFAULT_CAP : undefined })
                }
              />
              <span className="text-muted-foreground">Limit speed to</span>
              {rule.speedCap !== undefined && (
                <SpeedInput
                  bytes={rule.speedCap}
                  label="Speed in this window"
                  onChange={(speedCap) => update(rule.id, { speedCap })}
                />
              )}
            </label>
          )}
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            onChange({ ...(value ?? DEFAULT_SCHEDULE), rules: [...value.rules, newRule()] })
          }
        >
          Add a window
        </Button>
      </div>
    </div>
  )
}
