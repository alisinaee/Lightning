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
import { AppBoundary } from './components/AppBoundary'
import { LogsDialog } from './components/LogsDialog'
import './utils/errorLog'
import './utils/clickGuard'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Default Phosphor weight for every icon; override per icon with the weight prop. */}
    <IconContext.Provider value={{ weight: 'regular' }}>
      <AppBoundary>
        <App />
      </AppBoundary>
      <LogsDialog />
    </IconContext.Provider>
  </StrictMode>
)
