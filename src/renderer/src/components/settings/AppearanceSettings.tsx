import { Check } from '@phosphor-icons/react'
import type { AccentId, ThemeSource } from '@shared/types'
import { t } from '@shared/i18n/react'
import type { SettingsSectionProps } from './SettingsControls'

const SCALES = [
  { value: '0.9', label: 'Small' },
  { value: '1', label: 'Medium' },
  { value: '1.15', label: 'Large' },
  { value: '1.3', label: 'Larger' }
]

const ACCENTS: { id: AccentId; label: string; color: string }[] = [
  { id: 'amber', label: 'Amber', color: '#d97706' },
  { id: 'blue', label: 'Blue', color: '#2563eb' },
  { id: 'teal', label: 'Teal', color: '#0f766e' },
  { id: 'green', label: 'Green', color: '#15803d' },
  { id: 'violet', label: 'Violet', color: '#6d28d9' },
  { id: 'rose', label: 'Rose', color: '#be123c' }
]

/** Settings → Appearance: text size, theme, macOS window glass, and accent color. */
export function AppearanceSettings({
  prefs,
  save,
  theme,
  setTheme
}: SettingsSectionProps & {
  theme: ThemeSource
  setTheme: (source: ThemeSource) => void
}): React.JSX.Element {
  return (
    <>
      <div className="ios-title">{t('Text size')}</div>
      <div className="ios-row">
        <span className="ios-seg ms-auto w-full">
          {SCALES.map((scale) => (
            <button
              key={scale.value}
              type="button"
              aria-pressed={String(prefs.uiScale) === scale.value}
              onClick={() => save({ uiScale: Number(scale.value) })}
              className="flex-1"
            >
              {t(scale.label)}
            </button>
          ))}
        </span>
      </div>
      <div className="ios-title">{t('Theme')}</div>
      <div className="ios-row">
        <span className="ios-seg w-full">
          {(['dark', 'light'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={theme === mode}
              onClick={() => setTheme(mode)}
              className="flex-1"
            >
              {mode === 'dark' ? t('Dark') : t('Light')}
            </button>
          ))}
        </span>
      </div>
      {window.lightning.platform === 'darwin' && (
        <>
          <div className="ios-title">{t('Window glass')}</div>
          <div className="ios-row">
            <span className="ios-label">{t('Transparency')}</span>
            <input
              type="range"
              min={0}
              max={90}
              step={2}
              aria-label={t('Transparency')}
              value={prefs.glassTransparency}
              onChange={(event) => save({ glassTransparency: Number(event.target.value) })}
              className="w-40 accent-[var(--color-accent)]"
            />
            <span dir="ltr" className="w-9 text-end text-[12px] text-muted-foreground tabular-nums">
              {prefs.glassTransparency}%
            </span>
          </div>
          <div className="ios-row">
            <span className="ios-label">{t('Blur')}</span>
            <span className="ios-seg">
              {(
                [
                  ['off', 'Off'],
                  ['standard', 'Standard'],
                  ['strong', 'Strong']
                ] as const
              ).map(([level, text]) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={prefs.glassBlur === level}
                  onClick={() => save({ glassBlur: level })}
                >
                  {t(text)}
                </button>
              ))}
            </span>
          </div>
        </>
      )}
      <div className="ios-title">{t('Color')}</div>
      <div
        className="ios-row gap-2 !py-3"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}
      >
        {ACCENTS.map((accent) => {
          const chosen = prefs.accent === accent.id
          return (
            <button
              key={accent.id}
              type="button"
              aria-label={t(accent.label)}
              aria-pressed={chosen}
              onClick={() => save({ accent: accent.id })}
              // The look of the app's own buttons, filled with the colour it would take.
              className="flex h-9 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium text-white outline-none transition-transform active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
              style={{
                background: accent.color,
                boxShadow: chosen ? `0 0 0 2px var(--ios-card), 0 0 0 4px ${accent.color}` : 'none'
              }}
            >
              {chosen && <Check weight="bold" className="size-3.5" />}
              {t(accent.label)}
            </button>
          )
        })}
      </div>
    </>
  )
}
