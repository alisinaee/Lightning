import { useEffect, useRef } from 'react'

/**
 * Keyboard shortcuts for list selection: `Escape` clears when something is selected,
 * `Cmd/Ctrl+A` selects all current IDs, and optional `Cmd/Ctrl+F` focuses search.
 * Mutable inputs live in refs so the `window` listener stays attached across ticks.
 */
export function useSelectionShortcuts({
  ids,
  selectedCount,
  setSelected,
  onSearch
}: {
  ids: readonly string[]
  selectedCount: number
  setSelected: (next: Set<string>) => void
  onSearch?: () => void
}): void {
  const idsRef = useRef(ids)
  const selectedCountRef = useRef(selectedCount)
  const setSelectedRef = useRef(setSelected)
  const onSearchRef = useRef(onSearch)

  useEffect(() => {
    idsRef.current = ids
    selectedCountRef.current = selectedCount
    setSelectedRef.current = setSelected
    onSearchRef.current = onSearch
  })

  useEffect(() => {
    const mod = window.lightning.platform === 'darwin' ? 'metaKey' : 'ctrlKey'
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event[mod] && event.key.toLowerCase() === 'f' && onSearchRef.current) {
        event.preventDefault()
        onSearchRef.current()
        return
      }
      const target = event.target
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName))
      if (typing || document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      if (event.key === 'Escape') {
        if (selectedCountRef.current > 0) setSelectedRef.current(new Set())
      } else if (event[mod] && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSelectedRef.current(new Set(idsRef.current))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
