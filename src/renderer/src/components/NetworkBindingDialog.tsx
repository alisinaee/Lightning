import { TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from './ui/alert-dialog'
import { Checkbox } from './ui/checkbox'

const HIDDEN_KEY = 'lightning.hideNetworkBindingWarning'

function hiddenForGood(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

/** Linux before 5.7 can't pin a connection to one network, so everything leaves through the
 * default route — only worth saying once there's a second network that won't get used. */
export function NetworkBindingDialog(): React.JSX.Element {
  const networkCount = useAppStore((store) => store.interfaces.length)
  const [supported, setSupported] = useState(true)
  const [dismissed, setDismissed] = useState(hiddenForGood)
  const [neverAgain, setNeverAgain] = useState(false)

  useEffect(() => {
    window.lightning.deviceBindingSupported().then(setSupported, () => {})
  }, [])

  const close = (): void => {
    if (neverAgain) {
      try {
        localStorage.setItem(HIDDEN_KEY, '1')
      } catch {
        // Asked again next time.
      }
    }
    setDismissed(true)
  }

  return (
    <AlertDialog
      open={!supported && !dismissed && networkCount > 1}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <AlertDialogContent className="flex w-[min(460px,calc(100%-2rem))] max-w-none flex-col gap-5 p-6 sm:max-w-none">
        <AlertDialogHeader className="gap-4">
          <div className="flex items-center gap-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
              <TriangleAlert aria-hidden className="size-5" />
            </span>
            <AlertDialogTitle className="text-[16px]">
              Extra networks won&apos;t add speed
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="flex flex-col gap-3 text-[13px] leading-relaxed">
            Your Linux kernel is older than 5.7, so Lightning can&apos;t send a download through a
            chosen network. Everything goes through your default network, and the others show no
            ping and add no speed.
            <span className="block rounded-lg bg-muted/50 px-3 py-2 text-[12.5px]">
              Updating the system to kernel 5.7 or newer fixes this.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label className="flex cursor-pointer items-center gap-2.5 border-t-[0.5px] border-border pt-4 text-[13px]">
          <Checkbox checked={neverAgain} onCheckedChange={(on) => setNeverAgain(on === true)} />
          Don&apos;t show this again
        </label>
        <AlertDialogFooter className="mt-0">
          <AlertDialogAction>Got it</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
