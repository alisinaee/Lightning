import { createContext, useContext, useEffect, useId, useState } from 'react'
import { Input } from './ui/input'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

export const KB = 1024
export const MB = 1024 ** 2
export const GB = 1024 ** 3

/** Lets a field tell the form around it that what is typed isn't a usable value yet, so the form
 * can hold its Save button. */
export const FieldValidityContext = createContext<(key: string, invalid: boolean) => void>(() => {})

/** What a typed number of `unitBytes` is as bytes, or null when it is empty, zero, negative or not
 * a number: those are not a limit. */
export function parseBytes(text: string, unitBytes: number): number | null {
  const value = Number(text.trim().replace(',', '.'))
  if (text.trim() === '' || !Number.isFinite(value) || value <= 0) return null
  const bytes = Math.round(value * unitBytes)
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null
}

function formatNumber(value: number): string {
  return String(Number(value.toFixed(3)))
}

/** A number of `unit`s typed in, as bytes. Anything that isn't a number above zero is flagged (it
 * isn't applied, and holds the form's Save) rather than silently ignored. */
export function NumberInput({
  bytes,
  unit,
  unitBytes,
  label,
  disabled = false,
  showUnit = true,
  onChange
}: {
  bytes: number
  unit: string
  unitBytes: number
  label: string
  disabled?: boolean
  showUnit?: boolean
  onChange: (bytes: number) => void
}): React.JSX.Element {
  // Keep the draft as typed; changing units remounts it using the same byte value.
  const [text, setText] = useState(() => formatNumber(bytes / unitBytes))
  const report = useContext(FieldValidityContext)
  const key = useId()
  const invalid = !disabled && parseBytes(text, unitBytes) === null
  useEffect(() => {
    report(key, invalid)
    return () => report(key, false)
  }, [report, key, invalid])
  return (
    <span className="flex items-center gap-2">
      <Input
        aria-label={label}
        aria-invalid={invalid || undefined}
        title={invalid ? 'Enter a number above 0, or choose No limit.' : undefined}
        inputMode="decimal"
        disabled={disabled}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          const converted = parseBytes(event.target.value, unitBytes)
          if (converted !== null) onChange(converted)
        }}
        className="w-20 text-right font-mono tabular-nums"
      />
      {showUnit && <span className="font-mono text-[12px] text-muted-foreground">{unit}</span>}
    </span>
  )
}

/** A size or speed: a number and a unit selector (e.g. KB/s | MB/s). */
export function UnitField({
  bytes,
  label,
  units,
  disabled = false,
  onChange
}: {
  bytes: number
  label: string
  units: { name: string; bytes: number }[]
  disabled?: boolean
  onChange: (bytes: number) => void
}): React.JSX.Element {
  const [unit, setUnit] = useState(
    () => [...units].reverse().find((entry) => bytes >= entry.bytes)?.name ?? units[0].name
  )
  const active = units.find((entry) => entry.name === unit) ?? units[0]
  return (
    <div className="flex items-center gap-2">
      <NumberInput
        key={active.name}
        bytes={bytes}
        unit={active.name}
        unitBytes={active.bytes}
        label={`${label}, in ${active.name}`}
        disabled={disabled}
        showUnit={false}
        onChange={onChange}
      />
      <ToggleGroup
        aria-label={`${label} unit`}
        value={[active.name]}
        disabled={disabled}
        onValueChange={(values) => {
          if (values[0]) setUnit(values[0])
        }}
        size="sm"
        spacing={0.5}
        className="bg-secondary p-0.5"
      >
        {units.map((entry) => (
          <ToggleGroupItem key={entry.name} value={entry.name}>
            {entry.name}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

export const SPEED_UNITS = [
  { name: 'KB/s', bytes: KB },
  { name: 'MB/s', bytes: MB }
]
export const DATA_UNITS = [
  { name: 'MB', bytes: MB },
  { name: 'GB', bytes: GB }
]

export function SpeedInput(props: {
  bytes: number
  label: string
  disabled?: boolean
  onChange: (bytes: number) => void
}): React.JSX.Element {
  return <UnitField {...props} units={SPEED_UNITS} />
}
