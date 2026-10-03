import type { DownloadState, FinishedDownload } from '@shared/types'
import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { ScreenFooter } from './ScreenFooter'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from './ui/alert-dialog'
import { Button, buttonVariants } from './ui/button'
import { Checkbox } from './ui/checkbox'

/** The bottom of a download's own screen: the way back to the list on the left; Delete… and
 * what the download can do next (`children`, the main action last) on the right. */
export function DetailFooter({
  download,
  children
}: {
  download: DownloadState | FinishedDownload
  children?: React.ReactNode
}): React.JSX.Element {
  const setView = useAppStore((store) => store.setView)

  return (
    <ScreenFooter className="gap-2">
      <button
        type="button"
        onClick={() => setView({ name: 'list' })}
        className="-ml-1.5 flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] text-[var(--text-secondary)] hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Downloads
      </button>
      <div className="flex-1" />
      <DeleteButton download={download} />
      {children}
    </ScreenFooter>
  )
}

/** Delete…, asked first. An unfinished download loses what it has; a finished one leaves the
 * list, and its file goes to the Trash only if asked — from where it can still be put back. */
function DeleteButton({
  download
}: {
  download: DownloadState | FinishedDownload
}): React.JSX.Element {
  const removeDownload = useAppStore((store) => store.removeDownload)
  const setView = useAppStore((store) => store.setView)
  const [trashFile, setTrashFile] = useState(false)
  const finished = 'unitsWritten' in download || download.status === 'completed'
  const missing = 'missing' in download && download.missing === true
  const trashName = window.plexo.platform === 'win32' ? 'Recycle Bin' : 'Trash'

  return (
    <AlertDialog onOpenChange={() => setTrashFile(false)}>
      <AlertDialogTrigger
        render={
          <Button type="button" variant="secondary" className="text-[var(--color-danger)]">
            Delete…
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {download.fileName}?</AlertDialogTitle>
          <AlertDialogDescription>
            {finished
              ? 'It’s removed from your downloads.'
              : 'What’s downloaded so far is deleted, and the download is removed.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {finished && !missing && (
          <label className="flex items-center gap-2.5 text-[13px]">
            <Checkbox checked={trashFile} onCheckedChange={setTrashFile} />
            Also move the {download.kind === 'torrent' && download.folder ? 'folder' : 'file'} to
            the {trashName}
          </label>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: 'destructive', size: 'sm' })}
            onClick={() => {
              setView({ name: 'list' })
              removeDownload(download.id, { trashFile })
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
