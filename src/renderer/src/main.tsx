import './assets/main.css'

// Saved preferences (table layout, side panel) from when the app was called Plexo.
try {
  for (const key of Object.keys(localStorage)) {
    const next = key.replace(/^plexo\./, 'lightning.')
    if (next !== key && localStorage.getItem(next) === null) {
      localStorage.setItem(next, localStorage.getItem(key) ?? '')
    }
  }
} catch {
  // Storage unavailable: preferences start fresh.
}

import { IconContext } from '@phosphor-icons/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { SettingsWindow } from './components/SettingsWindow'
import { AppBoundary } from './components/AppBoundary'
import { LogsDialog } from './components/LogsDialog'
import { applyGlass } from './utils/syncSettings'
import './utils/errorLog'
import './utils/clickGuard'

// macOS windows are frosted glass: the surfaces turn translucent (see main.css).
if (window.lightning.platform === 'darwin') {
  document.documentElement.dataset.vibrancy = ''
  applyGlass(window.lightning.initialState.prefs.glassTransparency)
}

// Settings opens in a window of its own, which loads this same page at #settings.
const isSettingsWindow = window.location.hash.startsWith('#settings')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Default Phosphor weight for every icon; override per icon with the weight prop. */}
    <IconContext.Provider value={{ weight: 'regular' }}>
      <AppBoundary>{isSettingsWindow ? <SettingsWindow /> : <App />}</AppBoundary>
      {!isSettingsWindow && <LogsDialog />}
    </IconContext.Provider>
  </StrictMode>
)
