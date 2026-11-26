import type { GrantPanelState } from '@shared/permissions'

declare global {
  interface Window {
    /** The panel over System Settings that asks for a permission (preload/grant.ts). */
    grantPanel: {
      onState: (callback: (state: GrantPanelState) => void) => () => void
      /** Starts dragging the app bundle, to drop into the System Settings list. */
      drag: () => void
      /** Opens the System Settings pane again. */
      reopen: () => void
      close: () => void
    }
  }
}

export {}
