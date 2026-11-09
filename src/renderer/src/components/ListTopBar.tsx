import {
  CaretDown as ChevronDown,
  CaretUp as ChevronUp,
  Pause,
  Play,
  Plus,
  ArrowClockwise as RotateCw,
  MagnifyingGlass as Search,
  Gear as Settings
} from '@phosphor-icons/react'
import type { ComponentType, RefObject } from 'react'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Input } from './ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { t } from '@shared/i18n/react'

/** The shared top bar of the Downloads, Telegram and YouTube lists: the same controls, in the same
 * places, so the three screens read as one system. */

/** The settings button at the right end of the top bar. */
export function SettingsButton({
  label = t('Settings'),
  onClick
}: {
  label?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button type="button" size="icon" variant="ghost" aria-label={label} onClick={onClick}>
            <Settings />
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Pauses every running download, or resumes the paused ones; the same button as on Downloads. */
export function PauseAllButton({
  pausing,
  resumeLabel,
  disabled,
  onPause,
  onResume,
  resumeIcon = 'play'
}: {
  /** True while something runs: the button then pauses it all. */
  pausing: boolean
  resumeLabel: string
  disabled: boolean
  onPause: () => void
  onResume: () => void
  /** Retry (a circular arrow) when only failures can be tried again, Play when paused work waits. */
  resumeIcon?: 'play' | 'retry'
}): React.JSX.Element {
  const label = pausing ? t('Pause all') : resumeLabel
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label={label}
            disabled={disabled}
            onClick={pausing ? onPause : onResume}
          >
            {pausing ? (
              <Pause className="fill-current" />
            ) : resumeIcon === 'retry' ? (
              <RotateCw />
            ) : (
              <Play className="fill-current" />
            )}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** The New menu: a plus button that opens the ways to add something to this list. */
export function NewMenu({
  label,
  items,
  disabled = false
}: {
  label: string
  items: { label: string; icon: ComponentType<{ className?: string }>; run: () => void }[]
  disabled?: boolean
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button type="button" size="icon" aria-label={label} disabled={disabled} />}
            >
              <Plus />
            </DropdownMenuTrigger>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <DropdownMenuItem key={item.label} onClick={item.run}>
              <Icon />
              {item.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The search box, with the count of matches and steps to the next and previous when the list
 * can count them (Downloads does; the others show the rows that match and no steps). */
export function SearchField({
  inputRef,
  label,
  value,
  onChange,
  disabled = false,
  matches,
  matchIndex = 0,
  onStep
}: {
  inputRef?: RefObject<HTMLInputElement | null>
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** The number of matches, when the list can step through them. */
  matches?: number
  matchIndex?: number
  onStep?: (dir: 1 | -1) => void
}): React.JSX.Element {
  const stepping = matches !== undefined && onStep !== undefined && value.trim() !== ''
  return (
    <div className="relative w-[260px] min-w-[140px] shrink">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 start-2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        ref={inputRef}
        type="search"
        disabled={disabled}
        aria-label={label}
        placeholder={t('Search')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onChange('')
            event.currentTarget.blur()
          } else if (event.key === 'Enter' && stepping) {
            event.preventDefault()
            onStep(event.shiftKey ? -1 : 1)
          }
        }}
        className={`h-8 ps-7 text-[12.5px] [&::-webkit-search-cancel-button]:hidden ${stepping ? 'pe-[92px]' : ''}`}
      />
      {stepping && (
        <span className="absolute top-1/2 end-1 flex -translate-y-1/2 items-center gap-0.5">
          <span className="px-1 font-mono text-[11px] tabular-nums text-muted-foreground">
            {matches === 0 ? '0/0' : `${matchIndex + 1}/${matches}`}
          </span>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={t('Previous result')}
            disabled={matches === 0}
            onClick={() => onStep(-1)}
          >
            <ChevronUp />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={t('Next result')}
            disabled={matches === 0}
            onClick={() => onStep(1)}
          >
            <ChevronDown />
          </Button>
        </span>
      )}
    </div>
  )
}
