import type { GroupMode, GroupRule } from '@shared/types'
import { useNetworkOptions } from '../hooks/useNetworkOptions'
import { ConnectionPicker } from './ConnectionPicker'
import { DnsPicker } from './DnsPicker'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

/** What a group's settings are, whether it is being made or edited. */
export interface GroupSettingsValue {
  mode: GroupMode
  rule: GroupRule
  /** The group's networks (and any VPN layer riding along). */
  interfaceIds: string[]
  /** How many files run at once; null leaves it to Lightning. */
  maxAtOnce: number | null
  /** A DNS profile id, 'system', or null to follow the app's default. */
  dnsId: string | null
}

const AT_ONCE_CHOICES = [1, 2, 3, 4, 5, 8]
const labelClass = 'w-24 shrink-0 text-[var(--text-secondary)]'

/** The settings every group has: how many files run at once, and how files get their networks.
 * Auto picks a network for each file; Manual takes either one rule for all the files (the
 * networks chosen here) or a choice on each file, and then only that choice counts. */
export function GroupSettings({
  value,
  onChange
}: {
  value: GroupSettingsValue
  onChange: (patch: Partial<GroupSettingsValue>) => void
}): React.JSX.Element {
  const options = useNetworkOptions()
  const manual = value.mode === 'manual'
  const perFile = manual && value.rule === 'perFile'

  // Networks outside the list (a VPN layer) are kept as they are when the real ones change.
  const setNetworks = (ids: string[]): void =>
    onChange({
      interfaceIds: [
        ...ids,
        ...value.interfaceIds.filter((id) => !options.some((option) => option.id === id))
      ]
    })

  const atOnce = value.maxAtOnce
  return (
    <div className="flex flex-col gap-2.5 text-[12.5px]">
      <div className="flex items-center gap-3">
        <span className={labelClass}>Files at once</span>
        <ToggleGroup
          aria-label="How many files download at once"
          value={[atOnce === null ? 'auto' : String(atOnce)]}
          onValueChange={(values) => {
            const next = values[0]
            if (next === undefined) return
            onChange({ maxAtOnce: next === 'auto' ? null : Number(next) })
          }}
          size="sm"
          spacing={0.5}
          className="bg-secondary p-0.5"
        >
          <ToggleGroupItem value="auto">Auto</ToggleGroupItem>
          {AT_ONCE_CHOICES.map((count) => (
            <ToggleGroupItem key={count} value={String(count)} className="min-w-7">
              {count}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          Other
          <input
            type="number"
            min={1}
            max={64}
            inputMode="numeric"
            aria-label="Files at once, other number"
            value={atOnce !== null && !AT_ONCE_CHOICES.includes(atOnce) ? atOnce : ''}
            placeholder="–"
            onChange={(event) => {
              const number = Math.floor(Number(event.target.value))
              if (Number.isFinite(number) && number >= 1)
                onChange({ maxAtOnce: Math.min(64, number) })
            }}
            className="h-7 w-14 rounded-md border border-input bg-[var(--input-bg)] px-2 text-center text-[12px] text-foreground outline-none"
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <span className={labelClass}>Connections</span>
        <ToggleGroup
          aria-label="How files are given networks"
          value={[value.mode]}
          onValueChange={(values) => {
            const next = values[0]
            if (next === 'auto' || next === 'manual') onChange({ mode: next })
          }}
          size="sm"
          spacing={0.5}
          className="bg-secondary p-0.5"
        >
          <ToggleGroupItem value="auto">Auto</ToggleGroupItem>
          <ToggleGroupItem value="manual">Manual</ToggleGroupItem>
        </ToggleGroup>
        <span className="min-w-0 flex-1 text-[11.5px] text-muted-foreground">
          {manual
            ? 'You decide which networks the files use.'
            : 'Each file gets a network, matched to how fast it is.'}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className={labelClass}>DNS</span>
        <DnsPicker
          value={value.dnsId}
          followLabel="App default"
          onChange={(id) => onChange({ dnsId: id })}
        />
        <span className="min-w-0 flex-1 text-[11.5px] text-muted-foreground">
          Every file of the group looks names up this way.
        </span>
      </div>

      {manual && (
        <div className="flex items-center gap-3">
          <span className={labelClass}>Rule</span>
          <ToggleGroup
            aria-label="Where the choice of networks is made"
            value={[value.rule]}
            onValueChange={(values) => {
              const next = values[0]
              if (next === 'general' || next === 'perFile') onChange({ rule: next })
            }}
            size="sm"
            spacing={0.5}
            className="bg-secondary p-0.5"
          >
            <ToggleGroupItem value="general">Same for all files</ToggleGroupItem>
            <ToggleGroupItem value="perFile">Each file on its own</ToggleGroupItem>
          </ToggleGroup>
          <span className="min-w-0 flex-1 text-[11.5px] text-muted-foreground">
            {perFile
              ? 'Only the choice made on each file counts.'
              : 'One choice below applies to every file.'}
          </span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <span className={labelClass}>Networks</span>
        <ConnectionPicker
          options={options}
          value={value.interfaceIds}
          label={perFile ? 'files not set yet' : 'the group'}
          onChange={setNetworks}
        />
        <span className="min-w-0 flex-1 text-[11.5px] text-muted-foreground">
          {manual
            ? perFile
              ? 'Used by files you have not set yet.'
              : 'Every file uses exactly these.'
            : 'Auto only uses these.'}
        </span>
      </div>
    </div>
  )
}
