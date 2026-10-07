import type { PanelAction, PanelState } from '@shared/trayPanel'

declare global {
  interface Window {
    /** The panel under the menu-bar icon: what main sends it and what it can ask for (preload/tray.ts). */
    trayPanel: {
      onState: (callback: (state: PanelState) => void) => () => void
      act: (action: PanelAction) => void
      resize: (height: number) => void
    }
  }
}

export {}
