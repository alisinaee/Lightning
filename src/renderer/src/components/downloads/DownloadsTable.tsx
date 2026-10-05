import { ArrowDown, ArrowUp, Columns3 } from 'lucide-react'
import { cn } from 'cn'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAppStore, type ColumnId } from '../../store/useAppStore'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '../ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import {
  ACTIONS_WIDTH,
  COLUMNS,
  NAME_MIN,
  SELECT_WIDTH,
  ColumnsContext,
  columnOf,
  layoutColumns
} from './columns'

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
  const setColumnWidths = useAppStore((store) => store.setColumnWidths)
  const toggleColumn = useAppStore((store) => store.toggleColumn)
  const setWrapNames = useAppStore((store) => store.setWrapNames)
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

  // A divider follows the pointer: the column on its left grows by what the one on its right
  // gives up (or the other way round), so the dividers beyond it stay where they are. Name takes
  // what is left, so a divider on its edge trades with the next column.
  const startResize = useCallback(
    (event: React.PointerEvent, id: ColumnId, next: ColumnId | null) => {
      event.preventDefault()
      event.stopPropagation()
      if (!next) return
      const left = columnOf(id)
      const right = columnOf(next)
      if (!left || !right) return
      const startX = event.clientX
      const startRight = layout.widthOf(next)
      const startLeft = layout.widthOf(id)
      // Name has no width of its own: dragging its divider only changes the next column.
      const nameOnLeft = id === 'name'
      // What Name has now beyond its minimum: the most the others may grow by without a column
      // being dropped for lack of room mid-drag.
      const fixed = layout.visible.reduce(
        (sum, other) => sum + (other === 'name' ? 0 : layout.widthOf(other)),
        0
      )
      const spare = Math.max(0, width - SELECT_WIDTH - ACTIONS_WIDTH - fixed - NAME_MIN)
      let latest: Partial<Record<ColumnId, number>> = {}
      const move = (moveEvent: PointerEvent): void => {
        const dx = moveEvent.clientX - startX
        if (nameOnLeft) {
          const grown = Math.min(right.max || Infinity, startRight + spare)
          const width = Math.min(grown, Math.max(right.min, startRight - dx))
          latest = { [next]: width }
        } else {
          // Both stay within their limits, and the pair keeps its total.
          const lowest = Math.max(left.min - startLeft, startRight - (right.max || Infinity))
          const highest = Math.min((left.max || Infinity) - startLeft, startRight - right.min)
          const change = Math.min(highest, Math.max(lowest, dx))
          latest = { [id]: startLeft + change, [next]: startRight - change }
        }
        setDragging(latest)
      }
      function up(): void {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        setDragging({})
        if (Object.keys(latest).length > 0) setColumnWidths(latest)
      }
      const previous = {
        cursor: document.body.style.cursor,
        select: document.body.style.userSelect
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      function end(): void {
        document.body.style.cursor = previous.cursor
        document.body.style.userSelect = previous.select
        up()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    },
    [layout, setColumnWidths, width]
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
        const column = columnOf(id)
        if (!column) return null
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
            {next && (
              <span
                aria-hidden
                onPointerDown={(event) => startResize(event, id, next)}
                className="absolute inset-y-1 right-0 w-2 cursor-col-resize after:absolute after:inset-y-0 after:right-0.5 after:w-px after:bg-border hover:after:bg-primary"
              />
            )}
          </div>
        )
      })}
      <div role="columnheader" className="flex items-center justify-end px-1.5">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Choose columns"
                      className="text-muted-foreground"
                    />
                  }
                >
                  <Columns3 />
                </DropdownMenuTrigger>
              }
            />
            <TooltipContent>Choose columns</TooltipContent>
          </Tooltip>
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
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={tableLayout.wrapNames}
              onCheckedChange={setWrapNames}
            >
              Show full file names
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )

  return (
    <ColumnsContext.Provider value={layout.visible}>
      <div
        role="table"
        aria-label="Downloads"
        style={{ '--cols': layout.template, minWidth: ACTIONS_WIDTH } as React.CSSProperties}
        data-wrap={tableLayout.wrapNames}
        className="group/table flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        <div ref={ref} role="rowgroup" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
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
              <ContextMenuSeparator />
              <ContextMenuCheckboxItem
                checked={tableLayout.wrapNames}
                onCheckedChange={setWrapNames}
              >
                Show full file names
              </ContextMenuCheckboxItem>
            </ContextMenuContent>
          </ContextMenu>
          {children}
        </div>
      </div>
    </ColumnsContext.Provider>
  )
}
