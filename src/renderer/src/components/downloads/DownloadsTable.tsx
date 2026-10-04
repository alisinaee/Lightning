import { ArrowDown, ArrowUp, Columns3 } from 'lucide-react'
import { cn } from 'cn'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAppStore, type ColumnId } from '../../store/useAppStore'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuTrigger
} from '../ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { ACTIONS_WIDTH, COLUMNS, ColumnsContext, layoutColumns } from './columns'

const HIDEABLE = COLUMNS.filter((column) => column.canHide)

/** The downloads as a table: a header whose columns sort, resize and can be hidden, over rows
 * that share its grid. It never scrolls sideways; a narrow window drops columns instead. */
export function DownloadsTable({
  allSelected,
  someSelected,
  selectable,
  onSelectAll,
  children
}: {
  allSelected: boolean
  someSelected: boolean
  selectable: boolean
  onSelectAll: (on: boolean) => void
  children: React.ReactNode
}): React.JSX.Element {
  const tableLayout = useAppStore((store) => store.tableLayout)
  const sortBy = useAppStore((store) => store.sortBy)
  const setColumnWidth = useAppStore((store) => store.setColumnWidth)
  const toggleColumn = useAppStore((store) => store.toggleColumn)
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  // Widths while a drag is under way; written to the store only when it ends.
  const [dragging, setDragging] = useState<Partial<Record<ColumnId, number>>>({})

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const layout = useMemo(
    () => layoutColumns({ ...tableLayout, widths: { ...tableLayout.widths, ...dragging } }, width),
    [tableLayout, dragging, width]
  )

  const startResize = useCallback(
    (event: React.PointerEvent, id: ColumnId, inverse: ColumnId | null) => {
      event.preventDefault()
      event.stopPropagation()
      const target = inverse ?? id
      const startX = event.clientX
      const start = layout.widthOf(target)
      const sign = inverse ? -1 : 1
      let latest = start
      const move = (moveEvent: PointerEvent): void => {
        latest = start + sign * (moveEvent.clientX - startX)
        setDragging({ [target]: latest })
      }
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setDragging({})
        if (latest !== start) setColumnWidth(target, latest)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [layout, setColumnWidth]
  )

  const { sort } = tableLayout
  const header = (
    <div
      role="row"
      className="sticky top-0 z-10 grid h-8 shrink-0 items-center border-b-[0.5px] border-border bg-background text-[11px] font-medium text-muted-foreground [grid-template-columns:var(--cols)]"
    >
      <div role="columnheader" className="flex items-center justify-center">
        <Checkbox
          aria-label="Select all downloads"
          checked={allSelected}
          indeterminate={someSelected}
          disabled={!selectable}
          onCheckedChange={onSelectAll}
        />
      </div>
      {layout.visible.map((id, index) => {
        const column = COLUMNS.find((entry) => entry.id === id)!
        const active = sort.key === id
        const next = layout.visible[index + 1]
        const Arrow = sort.dir === 'asc' ? ArrowUp : ArrowDown
        return (
          <div
            key={id}
            role="columnheader"
            aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
            className={cn(
              'relative flex h-full min-w-0 items-center px-2',
              column.align === 'right' && 'justify-end'
            )}
          >
            <button
              type="button"
              onClick={() => sortBy(id)}
              className={cn(
                'group/sort flex min-w-0 items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                active && 'text-foreground'
              )}
            >
              <span className="truncate">{column.label}</span>
              <Arrow
                aria-hidden
                className={cn(
                  'size-3 shrink-0',
                  active ? 'opacity-100' : 'opacity-0 group-hover/sort:opacity-40'
                )}
              />
            </button>
            {(id !== 'name' || next) && (
              <span
                aria-hidden
                onPointerDown={(event) =>
                  startResize(event, id, id === 'name' ? (next ?? null) : null)
                }
                className="absolute inset-y-1 right-0 w-2 cursor-col-resize after:absolute after:inset-y-0 after:right-0.5 after:w-px after:bg-border hover:after:bg-primary"
              />
            )}
          </div>
        )
      })}
      <div role="columnheader" className="flex items-center justify-end px-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Choose columns"
                title="Choose columns"
                className="text-muted-foreground"
              />
            }
          >
            <Columns3 />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {HIDEABLE.map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={!tableLayout.hidden.includes(column.id)}
                onCheckedChange={() => toggleColumn(column.id)}
              >
                {column.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )

  return (
    <ColumnsContext.Provider value={layout.visible}>
      <div
        ref={ref}
        role="table"
        aria-label="Downloads"
        style={{ '--cols': layout.template, minWidth: ACTIONS_WIDTH } as React.CSSProperties}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        <ContextMenu>
          <ContextMenuTrigger render={header} />
          <ContextMenuContent className="w-44">
            {HIDEABLE.map((column) => (
              <ContextMenuCheckboxItem
                key={column.id}
                checked={!tableLayout.hidden.includes(column.id)}
                onCheckedChange={() => toggleColumn(column.id)}
              >
                {column.label}
              </ContextMenuCheckboxItem>
            ))}
          </ContextMenuContent>
        </ContextMenu>
        <div role="rowgroup" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          {children}
        </div>
      </div>
    </ColumnsContext.Provider>
  )
}
