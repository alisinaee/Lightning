import type { DnsProfile } from '@shared/types'
import { Check, ChevronDown, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { DNS_SUGGESTIONS, dnsLabel, useDns } from '../hooks/useDns'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

/** Choosing the DNS to look names up with: the system's, a saved one, or a new one to add. The
 * choice made is remembered by name, most recent first. `value` null means "follow what is
 * above" (the group's, then the app's default); pass `followLabel` to offer it. */
export function DnsPicker({
  value,
  onChange,
  followLabel,
  label = 'DNS',
  className
}: {
  value: string | null | undefined
  onChange: (id: string | null) => void
  /** Offers a first choice that leaves it to what is above, named like this. */
  followLabel?: string
  label?: string
  className?: string
}): React.JSX.Element {
  const { profiles, defaultId } = useDns()
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [servers, setServers] = useState('')
  const [error, setError] = useState<string | null>(null)

  const choose = (id: string | null): void => {
    onChange(id)
    setOpen(false)
  }
  const saveAndChoose = async (input: {
    name: string
    servers: string | string[]
  }): Promise<void> => {
    try {
      const profile = await window.lightning.saveDns(input)
      setError(null)
      setAdding(false)
      setName('')
      setServers('')
      choose(profile.id)
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message.replace(/^Error invoking.*?: /, '')
          : 'Could not save'
      )
    }
  }
  const unsaved = DNS_SUGGESTIONS.filter(
    (suggestion) =>
      !profiles.some((profile) => profile.servers.join() === suggestion.servers.join())
  )
  const text = followLabel && !value ? followLabel : dnsLabel(value, profiles, defaultId)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={label}
            className={`max-w-[200px] shrink-0 justify-between ${className ?? ''}`}
          />
        }
      >
        <span className="truncate">{text}</span>
        <ChevronDown data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] gap-0 p-1.5">
        <div className="max-h-[320px] overflow-y-auto">
          {followLabel && (
            <Row selected={!value} title={followLabel} onClick={() => choose(null)} />
          )}
          <Row
            selected={value === 'system'}
            title="System DNS"
            hint="What your computer uses"
            onClick={() => choose('system')}
          />
          {profiles.map((profile) => (
            <Row
              key={profile.id}
              selected={value === profile.id}
              title={profile.name}
              hint={profile.servers.join(', ')}
              onClick={() => choose(profile.id)}
              onRemove={() => void window.lightning.removeDns(profile.id)}
            />
          ))}
          {unsaved.length > 0 && (
            <div className="px-2 pt-2 pb-1 text-[11px] text-muted-foreground">Well-known</div>
          )}
          {unsaved.map((suggestion) => (
            <Row
              key={suggestion.name}
              selected={false}
              title={suggestion.name}
              hint={suggestion.servers.join(', ')}
              onClick={() => void saveAndChoose(suggestion)}
            />
          ))}
        </div>
        <div className="mt-1 border-t-[0.5px] border-border pt-1.5">
          {adding ? (
            <form
              className="flex flex-col gap-2 p-1.5"
              onSubmit={(event) => {
                event.preventDefault()
                void saveAndChoose({ name, servers })
              }}
            >
              <Input
                autoFocus
                aria-label="DNS name"
                placeholder="Name, e.g. Office"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <Input
                aria-label="DNS servers"
                placeholder="Servers, e.g. 1.1.1.1, 1.0.0.1"
                value={servers}
                onChange={(event) => setServers(event.target.value)}
                className="font-mono text-[12px]"
              />
              {error && <div className="text-[11.5px] text-destructive">{error}</div>}
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  Save and use
                </Button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[12.5px] text-[var(--text-secondary)] outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus aria-hidden className="size-3.5" />
              Add a DNS…
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Row({
  selected,
  title,
  hint,
  onClick,
  onRemove
}: {
  selected: boolean
  title: string
  hint?: string
  onClick: () => void
  onRemove?: () => void
}): React.JSX.Element {
  return (
    <div className="group/row flex items-center rounded-md hover:bg-secondary">
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="size-4 shrink-0">
          {selected && <Check aria-hidden className="size-4 text-primary" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13px] leading-none font-medium">{title}</span>
          {hint && (
            <span className="truncate font-mono text-[11px] leading-none text-muted-foreground">
              {hint}
            </span>
          )}
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          aria-label={`Forget ${title}`}
          onClick={onRemove}
          className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none group-hover/row:opacity-100 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Trash2 aria-hidden className="size-3.5" />
        </button>
      )}
    </div>
  )
}

export type { DnsProfile }
