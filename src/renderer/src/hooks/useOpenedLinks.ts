import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'

/** Puts a link the OS handed Plexo — a magnet link clicked, a .torrent opened — in the link field,
 * for the user to look at and start (see main/openLinks.ts). */
export function useOpenedLinks(): void {
  const setDraftUrl = useAppStore((store) => store.setDraftUrl)

  useEffect(() => {
    const take = (): void => {
      void window.plexo
        .takePendingLink()
        .then((link) => {
          if (link) setDraftUrl(link)
        })
        .catch(() => {})
    }
    const unsubscribe = window.plexo.onLinkReceived(take)
    // One handed over before the window was ready to hear of it.
    take()
    return unsubscribe
  }, [setDraftUrl])
}
