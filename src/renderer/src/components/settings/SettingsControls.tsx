import type { AppPrefs, ResolvedPrefs } from '@shared/types'
import { t } from '@shared/i18n/react'
import { Switch } from '../ui/switch'

export interface SettingsSectionProps {
  prefs: ResolvedPrefs
  save: (patch: Partial<AppPrefs>) => void
}

export function Row({
  checked,
  onChange,
  label,
  hint,
  disabled = false
}: {
  checked: boolean
  onChange: (on: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label className={`ios-row ${disabled ? 'opacity-50' : ''}`} data-setting={label}>
      <span className="ios-label">
        {t(label)}
        {hint && <span className="ios-hint">{t(hint)}</span>}
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={t(label)}
      />
    </label>
  )
}

export function NumberField({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}): React.JSX.Element {
  return (
    <label className="ios-row" data-setting={label}>
      <span className="ios-label">{t(label)}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const count = Math.floor(Number(event.target.value))
          if (count >= min && count <= max) onChange(count)
        }}
        className="ios-input w-16"
      />
    </label>
  )
}
