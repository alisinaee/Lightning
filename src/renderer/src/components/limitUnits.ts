import { createContext } from 'react'

export const KB = 1024
export const MB = 1024 ** 2
export const GB = 1024 ** 3

/** Lets a field tell the form around it that what is typed isn't a usable value yet, so the form
 * can hold its Save button. */
export const FieldValidityContext = createContext<(key: string, invalid: boolean) => void>(() => {})

/** What a typed number of `unitBytes` is as bytes, or null when it is empty, zero, negative or not
 * a number: those are not a limit. */
export function parseBytes(text: string, unitBytes: number): number | null {
  const value = Number(text.trim().replace(',', '.'))
  if (text.trim() === '' || !Number.isFinite(value) || value <= 0) return null
  const bytes = Math.round(value * unitBytes)
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null
}

export const SPEED_UNITS = [
  { name: 'KB/s', bytes: KB },
  { name: 'MB/s', bytes: MB }
]
export const DATA_UNITS = [
  { name: 'MB', bytes: MB },
  { name: 'GB', bytes: GB }
]
