import { Cable, ChevronDown } from 'lucide-react'
import type { NetworkOption } from '../hooks/useNetworkOptions'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

/** Which networks one file uses: all of them, or the ones ticked. At least one stays ticked.
 * `single`: a file that can't be split across networks, so it is one or the other. */
export function ConnectionPicker({
  options,
  value,
  onChange,
  single = false,
  disabled = false,
  label,
  auto,
  iconOnly = false
}: {
  options: NetworkOption[]
  value: string[]
  onChange: (ids: string[]) => void
  single?: boolean
  disabled?: boolean
  /** What the button is called for a screen reader, e.g. the file's name. */
  label: string
  /** In an Auto group: whether the user pinned this file, and how to give it back to Auto. */
  auto?: { pinned: boolean; onAuto: () => void }
  /** A small button with a network icon, for a row of actions. */
  iconOnly?: boolean
}): React.JSX.Element {
  const chosen = options.filter((option) => value.includes(option.id))
  const summary =
    chosen.length === 0
      ? 'No network'
      : chosen.length === options.length && options.length > 1
        ? 'All networks'
        : chosen.length === 1
          ? chosen[0].name
          : `${chosen[0].name} +${chosen.length - 1}`

  const toggle = (id: string, on: boolean): void => {
    if (single) onChange([id])
    else if (on) onChange([...value, id])
    else if (value.length > 1) onChange(value.filter((other) => other !== id))
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          iconOnly ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={disabled || options.length === 0}
              aria-label={`Networks for ${label}`}
              title={auto && !auto.pinned ? 'Choose connections (now Auto)' : 'Choose connections'}
              className={auto?.pinned ? 'text-primary' : 'text-muted-foreground'}
            >
              <Cable />
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={disabled || options.length === 0}
              aria-label={`Networks for ${label}`}
              className="max-w-[170px] shrink-0 justify-between"
            >
              <span className="truncate">{summary}</span>
              <ChevronDown data-icon="inline-end" />
            </Button>
          )
        }
      />
      <PopoverContent align="end" className="w-56 gap-1">
        {auto && (
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] font-medium hover:bg-muted">
            <Checkbox checked={!auto.pinned} onCheckedChange={(on) => on && auto.onAuto()} />
            Auto (Plexo decides)
          </label>
        )}
        {!single && options.length > 1 && (
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] font-medium hover:bg-muted">
            <Checkbox
              checked={chosen.length === options.length}
              onCheckedChange={(on) => on && onChange(options.map((option) => option.id))}
            />
            All networks
          </label>
        )}
        {options.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] hover:bg-muted"
          >
            <Checkbox
              checked={value.includes(option.id)}
              onCheckedChange={(on) => toggle(option.id, on)}
            />
            <span className="size-2 shrink-0 rounded-full" style={{ background: option.solid }} />
            <span className="truncate">{option.name}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  )
}
