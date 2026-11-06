import { LimitsDialog } from '../components/LimitsDialog'
import { useAppStore } from '../store/useAppStore'

/** Speed & data limits, opened from the networks menu or from Settings. The dialog's open state
 * and page live in the store, so Settings can open it from anywhere. Each screen renders the
 * returned element once. */
export function useLimitsDialog(): {
  openLimits: (page?: string | null) => void
  limitsDialog: React.JSX.Element
} {
  const open = useAppStore((store) => store.limitsDialogOpen)
  const page = useAppStore((store) => store.limitsDialogPage)
  const openLimitsDialog = useAppStore((store) => store.openLimitsDialog)
  const closeLimitsDialog = useAppStore((store) => store.closeLimitsDialog)
  return {
    openLimits: (next) => openLimitsDialog(next ?? null),
    limitsDialog: (
      <LimitsDialog
        open={open}
        onOpenChange={(next) => (next ? openLimitsDialog(page) : closeLimitsDialog())}
        page={page}
        onPageChange={(next) => useAppStore.setState({ limitsDialogPage: next })}
      />
    )
  }
}
