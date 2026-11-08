import { useAppStore } from '../store/useAppStore'

/** Reads the saved settings again and puts them in this window's store: Settings lives in its own
 * window, so a change there (or here) reaches the other window this way. */
/** How see-through the window's surfaces are: the page's surface colours take this much opacity. */
export function applyGlass(transparency: number): void {
  document.documentElement.style.setProperty('--glass-a', String(100 - transparency))
}

export function reloadSavedSettings(): void {
  const saved = window.lightning.readInitialState()
  useAppStore.setState({
    prefsSnapshot: saved.prefs,
    sidebarHidden: saved.prefs.sidebarHidden,
    showSourceHost: saved.prefs.showSourceHost,
    progressLine: saved.prefs.progressLine,
    statusBar: saved.prefs.statusBar,
    showLogs: saved.prefs.showLogs,
    showDebug: saved.prefs.showDebug,
    themeSource: saved.themeSource,
    downloadsAtOnce: saved.downloadsAtOnce,
    destinationDir: saved.destinationDir ?? saved.downloadsDir
  })
  window.lightning.setZoom(saved.prefs.uiScale)
  document.documentElement.dataset.accent = saved.prefs.accent
  applyGlass(saved.prefs.glassTransparency)
}
