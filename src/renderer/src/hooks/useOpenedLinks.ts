import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import { acceptedLink } from '../utils/format'

/** Opens New download with a link the OS handed Lightning — a magnet link clicked, a .torrent opened
 * — for the user to look at and start (see main/openLinks.ts). */
export function useOpenedLinks(): void {
  const openNewDownload = useAppStore((store) => store.openNewDownload)

  useEffect(() => {
    const take = (): void => {
      void window.lightning
        .takePendingLink()
        .then((pending) => {
          if (pending) openNewDownload(pending.url, undefined, pending.extras)
        })
        .catch(() => {})
    }
    const unsubscribe = window.lightning.onLinkReceived(take)
    // One handed over before the window was ready to hear of it.
    take()
    return unsubscribe
  }, [openNewDownload])
}

const isMac = window.lightning.platform === 'darwin'

/** The ways into New download from anywhere in the window, as download managers have them:
 * pasting a link (outside a text field), ⌘N / Ctrl+N, and dropping a link or a .torrent. */
export function useNewDownloadShortcuts(): void {
  const openNewDownload = useAppStore((store) => store.openNewDownload)

  useEffect(() => {
    const busy = (target: EventTarget | null): boolean =>
      useAppStore.getState().newDownloadOpen ||
      (target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName)))

    const onPaste = (event: ClipboardEvent): void => {
      if (busy(event.target)) return
      const link = acceptedLink(event.clipboardData?.getData('text') ?? '')
      if (link) openNewDownload(link)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'n' || !(isMac ? event.metaKey : event.ctrlKey)) return
      if (useAppStore.getState().newDownloadOpen) return
      event.preventDefault()
      openNewDownload()
    }
    // Never let a drop navigate the window to what was dropped.
    const onDragOver = (event: DragEvent): void => event.preventDefault()
    const onDrop = (event: DragEvent): void => {
      event.preventDefault()
      const file = event.dataTransfer?.files[0]
      const link = file
        ? /\.torrent$/i.test(file.name)
          ? window.lightning.pathForFile(file)
          : null
        : acceptedLink(event.dataTransfer?.getData('text') ?? '')
      if (link) openNewDownload(link)
    }

    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [openNewDownload])
}
