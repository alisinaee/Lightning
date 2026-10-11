import { useMemo } from 'react'

/** The order the lists were last drawn in, by list: kept outside React so a list drawn again
 * (every progress update) can hold to it. */
const drawn = new Map<string, string[]>()

/** `computed` in the order it was drawn before, while `frozen`: rows already there keep their
 * place (those gone are dropped), new rows go last. Not frozen: `computed` as it is. A list that
 * re-sorts as downloads change state would otherwise move what someone is scrolled to. */
export function keepOrder<T>(
  computed: T[],
  key: (item: T) => string,
  previous: string[] | undefined,
  frozen: boolean
): T[] {
  if (!frozen || !previous) return computed
  const byKey = new Map(computed.map((item) => [key(item), item]))
  const known = new Set(previous)
  return [
    ...previous.flatMap((id) => {
      const item = byKey.get(id)
      return item === undefined ? [] : [item]
    }),
    ...computed.filter((item) => !known.has(key(item)))
  ]
}

/** `keepOrder` for a list drawn by a component, remembered under `scope`. */
export function useKeptOrder<T>(
  scope: string,
  computed: T[],
  key: (item: T) => string,
  frozen: boolean
): T[] {
  return useMemo(() => {
    const result = keepOrder(computed, key, drawn.get(scope), frozen)
    drawn.set(scope, result.map(key))
    return result
    // `key` is a plain function of the item and never changes what is drawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, computed, frozen])
}
