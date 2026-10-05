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
    width: 124,
    min: 84,
    max: 260,
    align: 'right',
    dropOrder: 3,
    canHide: true
  },
  { id: 'status', label: 'Status', width: 176, min: 112, max: 320, dropOrder: 0, canHide: false },
  {
    id: 'speed',
    label: 'Speed',
    width: 96,
    min: 80,
    max: 180,
    align: 'right',
    dropOrder: 2,
    canHide: true
  },
  {
    id: 'eta',
    label: 'Time left',
    width: 92,
    min: 88,
    max: 160,
    align: 'right',
    dropOrder: 4,
    canHide: true
  },
  { id: 'added', label: 'Added', width: 112, min: 84, max: 220, dropOrder: 5, canHide: true },
  {
    id: 'connections',
    label: 'Connections',
    width: 104,
    min: 100,
    max: 240,
    dropOrder: 6,
    canHide: true
  }
]

export const columnOf = (id: ColumnId): ColumnDef | undefined =>
  COLUMNS.find((def) => def.id === id)

export const SELECT_WIDTH = 30
/** Three icon buttons (say retry, fix link and the ⋯ menu): every action is an icon, so a row's
 * actions never need more, and the usual one or two leave little empty. */
export const ACTIONS_WIDTH = 100
/** What the name column keeps at least, before columns start to drop out. */
export const NAME_MIN = 220

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
    widthOf: (id) => {
      const def = columnOf(id)
      return def ? width(def) : 0
    }
  }
}

/** Which columns the rows lay out, handed down by the table around them. */
export const ColumnsContext = createContext<ColumnId[]>(COLUMNS.map((def) => def.id))
export const useColumns = (): ColumnId[] => useContext(ColumnsContext)
