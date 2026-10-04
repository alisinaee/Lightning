import { createContext, useContext } from 'react'
import type { ColumnId, TableLayout } from '../../store/useAppStore'

export interface ColumnDef {
  id: ColumnId
  label: string
  /** Starting width in px; the name column has none, it takes what the others leave. */
  width: number
  min: number
  max: number
  align?: 'right'
  /** In a window too narrow for every column, the highest number goes first. */
  dropOrder: number
  canHide: boolean
}

export const COLUMNS: ColumnDef[] = [
  { id: 'name', label: 'Name', width: 0, min: 200, max: 0, dropOrder: 0, canHide: false },
  {
    id: 'size',
    label: 'Size',
    width: 132,
    min: 72,
    max: 260,
    align: 'right',
    dropOrder: 3,
    canHide: true
  },
  { id: 'status', label: 'Status', width: 176, min: 112, max: 320, dropOrder: 0, canHide: false },
  {
    id: 'speed',
    label: 'Speed',
    width: 92,
    min: 64,
    max: 180,
    align: 'right',
    dropOrder: 2,
    canHide: true
  },
  {
    id: 'eta',
    label: 'Time left',
    width: 84,
    min: 60,
    max: 160,
    align: 'right',
    dropOrder: 4,
    canHide: true
  },
  { id: 'added', label: 'Added', width: 116, min: 70, max: 220, dropOrder: 5, canHide: true },
  {
    id: 'connections',
    label: 'Connections',
    width: 108,
    min: 60,
    max: 240,
    dropOrder: 6,
    canHide: true
  }
]

const SELECT_WIDTH = 36
export const ACTIONS_WIDTH = 132
/** What the name column keeps at least, before columns start to drop out. */
const NAME_MIN = 220

export interface ColumnLayout {
  /** The columns shown, in order. */
  visible: ColumnId[]
  /** The grid-template-columns for every row, header included. */
  template: string
  widthOf: (id: ColumnId) => number
}

/** Works out which columns fit in `available` px (the user's hidden ones first, then the least
 * important until the name keeps its minimum) and the grid they share. The page never scrolls
 * sideways: a narrow window loses columns instead. */
export function layoutColumns(layout: TableLayout, available: number): ColumnLayout {
  const width = (def: ColumnDef): number =>
    Math.min(def.max || Infinity, Math.max(def.min, layout.widths[def.id] ?? def.width))
  const wanted = COLUMNS.filter((def) => !layout.hidden.includes(def.id))
  let shown = wanted
  const used = (list: ColumnDef[]): number =>
    SELECT_WIDTH +
    ACTIONS_WIDTH +
    list.reduce((sum, def) => sum + (def.id === 'name' ? NAME_MIN : width(def)), 0)
  while (available > 0 && used(shown) > available) {
    const drop = [...shown]
      .filter((def) => def.dropOrder > 0)
      .sort((a, b) => b.dropOrder - a.dropOrder)[0]
    if (!drop) break
    shown = shown.filter((def) => def !== drop)
  }
  const template = [
    `${SELECT_WIDTH}px`,
    ...shown.map((def) =>
      def.id === 'name' ? `minmax(${NAME_MIN - 20}px,1fr)` : `${width(def)}px`
    ),
    `${ACTIONS_WIDTH}px`
  ].join(' ')
  return {
    visible: shown.map((def) => def.id),
    template,
    widthOf: (id) => width(COLUMNS.find((def) => def.id === id)!)
  }
}

/** Which columns the rows lay out, handed down by the table around them. */
export const ColumnsContext = createContext<ColumnId[]>(COLUMNS.map((def) => def.id))
export const useColumns = (): ColumnId[] => useContext(ColumnsContext)
