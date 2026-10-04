import { Ellipsis, type LucideIcon } from 'lucide-react'
import { Button } from '../ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '../ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'

export interface RowAction {
  id: string
  label: string
  icon: LucideIcon
  run: () => void
  danger?: boolean
  disabled?: boolean
  /** A rule above it. */
  divider?: boolean
}

/** The ⋯ button at the end of a row: the same actions the right-click menu has. */
export function RowActionsMenu({
  label,
  actions
}: {
  label: string
  actions: RowAction[]
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`More actions for ${label}`}
            className="text-muted-foreground hover:text-foreground"
          />
        }
      >
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {actions.map((action) => (
          <MenuEntry key={action.id} action={action} kind="dropdown" />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MenuEntry({
  action,
  kind
}: {
  action: RowAction
  kind: 'dropdown' | 'context'
}): React.JSX.Element {
  const Icon = action.icon
  const Item = kind === 'dropdown' ? DropdownMenuItem : ContextMenuItem
  const Separator = kind === 'dropdown' ? DropdownMenuSeparator : ContextMenuSeparator
  return (
    <>
      {action.divider && <Separator />}
      <Item
        variant={action.danger ? 'destructive' : 'default'}
        disabled={action.disabled}
        onClick={action.run}
      >
        <Icon aria-hidden />
        {action.label}
      </Item>
    </>
  )
}

/** Wraps a row so a right-click opens its actions. `children` is the row's own element. */
export function RowContextMenu({
  actions,
  row
}: {
  actions: RowAction[]
  /** The element to render as the row, receiving the menu's trigger props. */
  row: React.ReactElement<Record<string, unknown>>
}): React.JSX.Element {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={row} />
      <ContextMenuContent className="w-52">
        {actions.map((action) => (
          <MenuEntry key={action.id} action={action} kind="context" />
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}
